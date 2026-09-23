/**
 * WSAA — Autenticación contra ARCA (loginCms).
 *
 * 1. Arma el TRA (loginTicketRequest) con ventana de ±10 min.
 * 2. Lo firma en CMS/PKCS#7 con el certificado + clave del comercio
 *    (node-forge, sin binarios externos).
 * 3. POST SOAP a LoginCms (homo o prod) y extrae token + sign.
 *
 * El token dura ~12h: se cachea en memoria por (env, cuit) y se renueva
 * con 5 min de margen. WSAA rechaza logins duplicados concurrentes con
 * `coe.alreadyAuthenticated`: los intentos para el mismo par se
 * coalescen en una sola llamada en vuelo.
 */
import forge from "node-forge";

export type ArcaEnv = "homo" | "prod";

const WSAA_URL: Record<ArcaEnv, string> = {
  homo: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  prod: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};

export type WsaaTicket = { token: string; sign: string; expiresAtMs: number };

const ticketCache = new Map<string, WsaaTicket>();
const inflight = new Map<string, Promise<WsaaTicket>>();

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function soapFetch(url: string, body: string, action: string): Promise<string> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 25000);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: action,
    },
    body,
    signal: ac.signal,
  })
    .then(async (res) => {
      const text = await res.text();
      if (!res.ok) throw new ArcaError(`WSAA HTTP ${res.status}`, text.slice(0, 500));
      return text;
    })
    .finally(() => clearTimeout(timeout));
}

export class ArcaError extends Error {
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "ArcaError";
    this.detail = detail;
  }
}

function buildTra(service: string): string {
  const now = Date.now();
  const gen = new Date(now - 10 * 60 * 1000);
  const exp = new Date(now + 10 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "-03:00");
  const uniqueId = Math.floor(now / 1000);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header><uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${fmt(gen)}</generationTime>` +
    `<expirationTime>${fmt(exp)}</expirationTime></header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  );
}

/**
 * Valida el par certificado/clave (parseo + vigencia). Devuelve datos
 * para mostrar (sujeto y vencimiento) o lanza ArcaError legible.
 */
export function validateCertKeyPair(
  certPem: string,
  keyPem: string
): { subject: string; notAfter: string } {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new ArcaError("Certificado ARCA inválido (no es un PEM X.509 válido)");
  }
  let key: forge.pki.PrivateKey;
  try {
    key = forge.pki.privateKeyFromPem(keyPem);
  } catch {
    throw new ArcaError("Clave privada ARCA inválida (no es un PEM válido)");
  }
  // La clave tiene que ser la pareja del certificado (si no, ARCA rechaza
  // el login recién al facturar). Se comparan las claves públicas.
  try {
    const rsa = key as unknown as { n?: unknown; e?: unknown };
    if (!rsa.n || !rsa.e) throw new Error("no-rsa");
    const fromKey = forge.pki.publicKeyToPem(
      forge.pki.setRsaPublicKey(rsa.n as never, rsa.e as never)
    );
    const fromCert = forge.pki.publicKeyToPem(cert.publicKey);
    if (fromKey !== fromCert) {
      throw new ArcaError("El certificado no corresponde a esa clave privada");
    }
  } catch (e) {
    if (e instanceof ArcaError) throw e;
    // Claves no-RSA: no se bloquea.
  }
  if (cert.validity.notAfter.getTime() < Date.now()) {
    throw new ArcaError("El certificado ARCA está vencido (generá uno nuevo con clave fiscal)");
  }
  const cn =
    cert.subject.attributes.find((a) => a.shortName === "CN")?.value?.toString() ||
    cert.subject.toString();
  return { subject: cn, notAfter: cert.validity.notAfter.toISOString() };
}

/** Firma CMS (PKCS#7 attached) del TRA. Lanza si el par cert/key no parsea. */
export function signTra(tra: string, certPem: string, keyPem: string): string {
  let cert: forge.pki.Certificate;
  let key: forge.pki.PrivateKey;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new ArcaError("Certificado ARCA inválido (no es un PEM X.509 válido)");
  }
  try {
    key = forge.pki.privateKeyFromPem(keyPem);
  } catch {
    throw new ArcaError("Clave privada ARCA inválida (no es un PEM válido)");
  }
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // node-forge codifica el Date como UTCTime (el tipado pide string).
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, "binary").toString("base64");
}

function parseLoginResponse(xml: string): { token: string; sign: string } {
  const token = xml.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim();
  const sign = xml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim();
  if (!token || !sign) {
    const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1]?.trim();
    if (fault?.includes("coe.alreadyAuthenticated")) {
      throw new ArcaError("ARCA: login duplicado en curso (reintentá en unos segundos)", fault);
    }
    throw new ArcaError("ARCA no devolvió token (¿certificado asociado al WS?)", fault || xml.slice(0, 500));
  }
  return { token, sign };
}

/**
 * Token WSAA para el servicio `wsfe`, con cache + coalescencia.
 * `certPem`/`keyPem` van DESCIFRADOS (nunca viajan a logs).
 */
export async function getWsaaTicket(
  env: ArcaEnv,
  cuit: string,
  certPem: string,
  keyPem: string
): Promise<WsaaTicket> {
  const cacheKey = `${env}:${cuit}`;
  const cached = ticketCache.get(cacheKey);
  if (cached && cached.expiresAtMs - Date.now() > REFRESH_BUFFER_MS) return cached;

  const running = inflight.get(cacheKey);
  if (running) return running;

  const job = (async (): Promise<WsaaTicket> => {
    const tra = buildTra("wsfe");
    const cms = signTra(tra, certPem, keyPem);
    const envelope =
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:wsaa="http://wsaa.view.sua.dvadac.dgr.afip.gov">` +
      `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0>` +
      `</wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
    const xml = await soapFetch(WSAA_URL[env], envelope, "loginCms");
    const { token, sign } = parseLoginResponse(xml);
    const ticket: WsaaTicket = { token, sign, expiresAtMs: Date.now() + TOKEN_TTL_MS };
    ticketCache.set(cacheKey, ticket);
    return ticket;
  })();

  inflight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    inflight.delete(cacheKey);
  }
}

/** Invalida el token cacheado (ej. si WSFE lo rechaza por vencido). */
export function dropWsaaTicket(env: ArcaEnv, cuit: string): void {
  ticketCache.delete(`${env}:${cuit}`);
}
