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
  // 15s por llamada (3 SOAP secuenciales = 45s peor caso, debajo del
  // proxy_read_timeout de 90s de nginx). Un abort se mapea a error legible.
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 15000);
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
      if (!res.ok) {
        // El faultstring dice el motivo real (cert no asociado, TRA
        // vencido, CMS inválido...). Va en el mensaje para que salga en
        // los logs [fiscal]; no contiene secretos. El cuerpo se redacta
        // (sin token/sign) para diagnóstico completo.
        const fault = faultString(text)?.slice(0, 200);
        throw new ArcaError(`WSAA HTTP ${res.status}${fault ? `: ${fault}` : ""}`, redactXml(text).slice(0, 1500));
      }
      return text;
    })
    .catch((e: unknown) => {
      if (e instanceof ArcaError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(msg))) {
        throw new ArcaError(`ARCA no respondió en 15s (login ${action})`);
      }
      throw new ArcaError(`Sin conexión a ARCA (${msg.slice(0, 120)})`);
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

/**
 * Redacta credenciales de un XML de ARCA (contenido de token/sign) para
 * poder loguearlo sin filtrar secretos. Estructura intacta para diagnóstico.
 */
export function redactXml(xml: string): string {
  return xml.replace(
    /<(?:\w+:)?(token|sign)(?:\s[^>]*)?>[\s\S]*?<\/(?:\w+:)?\1>/gi,
    "<$1>···</$1>"
  );
}

/** faultstring tolerante a prefijos de namespace. */
export function faultString(xml: string): string | null {
  return (
    xml
      .match(/<(?:\w+:)?faultstring(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?faultstring>/)?.[1]
      ?.trim() ?? null
  );
}

function buildTra(service: string): string {
  const now = Date.now();
  const gen = new Date(now - 10 * 60 * 1000);
  const exp = new Date(now + 10 * 60 * 1000);
  // El server corre en UTC: hay que expresar el instante en hora ART
  // (UTC-3, sin DST desde 2009). Antes se etiquetaba el UTC como -03:00
  // y el TRA quedaba 3h en el futuro → WSAA lo rechazaba con HTTP 500.
  const fmt = (d: Date) =>
    new Date(d.getTime() - 3 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "-03:00");
  // Único por llamada (ms + azar): dos logins en el mismo segundo con el
  // mismo uniqueId pueden leerse como replay del lado de ARCA.
  const uniqueId = `${now}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
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
): { subject: string; issuer: string; notAfter: string } {
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
  // Emisor: sirve para detectar entorno equivocado (cert de prod en homo o viceversa).
  const issuer =
    cert.issuer.attributes.find((a) => a.shortName === "CN")?.value?.toString() ||
    cert.issuer.toString();
  return { subject: cn, issuer, notAfter: cert.validity.notAfter.toISOString() };
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
  // Tolerante a namespaces (<ns:token>) y atributos (<token xsi:type=...>):
  // un TA válido perdido acá deja a WSAA negando nuevos por 12 h.
  const token = xml.match(/<(?:\w+:)?token(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?token>/)?.[1]?.trim();
  const sign = xml.match(/<(?:\w+:)?sign(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?sign>/)?.[1]?.trim();
  if (!token || !sign) {
    const fault = faultString(xml);
    if (fault?.includes("coe.alreadyAuthenticated")) {
      throw new ArcaError("ARCA: login duplicado en curso (reintentá en unos segundos)", fault);
    }
    // Cuerpo redactado (sin credenciales aunque el formato sea inesperado).
    throw new ArcaError("ARCA no devolvió token (¿certificado asociado al WS?)", fault || redactXml(xml).slice(0, 1500));
  }
  return { token, sign };
}

/**
 * Cache persistente del TA (token+sign cifrados) en `fiscal_ta_cache`.
 * Sin esto, cada deploy/reinicio pierde el ticket y WSAA rechaza el nuevo
 * con "El CEE ya posee un TA valido" hasta su vencimiento (12 h).
 * Tolerante a tabla sin migrar: cae a solo-memoria.
 */
async function loadPersistedTicket(env: ArcaEnv, cuit: string): Promise<WsaaTicket | null> {
  try {
    const { queryOne } = await import("@/lib/db");
    const { decryptFiscalSecret } = await import("@/lib/arca/crypto");
    const row = await queryOne<{ token: string; sign: string; expires_at: string }>(
      `SELECT token, sign, expires_at FROM fiscal_ta_cache
        WHERE env = $1 AND cuit = $2 AND service = 'wsfe' LIMIT 1`,
      [env, cuit]
    );
    if (!row) return null;
    const expiresAtMs = new Date(row.expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() <= REFRESH_BUFFER_MS) return null;
    const ticket: WsaaTicket = {
      token: decryptFiscalSecret(row.token),
      sign: decryptFiscalSecret(row.sign),
      expiresAtMs,
    };
    ticketCache.set(`${env}:${cuit}`, ticket);
    return ticket;
  } catch {
    return null;
  }
}

async function savePersistedTicket(env: ArcaEnv, cuit: string, ticket: WsaaTicket): Promise<void> {
  try {
    const { query } = await import("@/lib/db");
    const { encryptFiscalSecret } = await import("@/lib/arca/crypto");
    await query(
      `INSERT INTO fiscal_ta_cache (env, cuit, service, token, sign, expires_at, updated_at)
       VALUES ($1, $2, 'wsfe', $3, $4, $5, now())
       ON CONFLICT (env, cuit, service) DO UPDATE SET
         token = EXCLUDED.token, sign = EXCLUDED.sign,
         expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [env, cuit, encryptFiscalSecret(ticket.token), encryptFiscalSecret(ticket.sign), new Date(ticket.expiresAtMs).toISOString()]
    );
  } catch {
    /* sin tabla: el cache queda solo en memoria */
  }
}

/**
 * Token WSAA para el servicio `wsfe`, con cache (memoria + DB) y coalescencia.
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

  const persisted = await loadPersistedTicket(env, cuit);
  if (persisted) return persisted;

  const running = inflight.get(cacheKey);
  if (running) return running;

  const job = (async (): Promise<WsaaTicket> => {
    const tra = buildTra("wsfe");
    const cms = signTra(tra, certPem, keyPem);
    // Namespace EXACTO del WSDL oficial (wsaahomo...?wsdl): con el viejo
    // (...dvadac.dgr...) WSAA responde "no se ha podido interpretar el XML
    // contra el SCHEMA". Estilo default-ns como los ejemplos publicados.
    const envelope =
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
      `<soapenv:Header/><soapenv:Body>` +
      `<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
      `<in0>${cms}</in0></loginCms>` +
      `</soapenv:Body></soapenv:Envelope>`;
    // El WSDL declara soapAction="" para loginCms.
    const xml = await soapFetch(WSAA_URL[env], envelope, "");
    const { token, sign } = parseLoginResponse(xml);
    const ticket: WsaaTicket = { token, sign, expiresAtMs: Date.now() + TOKEN_TTL_MS };
    ticketCache.set(cacheKey, ticket);
    await savePersistedTicket(env, cuit, ticket);
    return ticket;
  })();

  inflight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    inflight.delete(cacheKey);
  }
}

/** Invalida el token cacheado en memoria y DB (ej. si WSFE lo rechaza). */
export async function dropWsaaTicket(env: ArcaEnv, cuit: string): Promise<void> {
  ticketCache.delete(`${env}:${cuit}`);
  try {
    const { query } = await import("@/lib/db");
    await query(
      `DELETE FROM fiscal_ta_cache WHERE env = $1 AND cuit = $2 AND service = 'wsfe'`,
      [env, cuit]
    );
  } catch {
    /* sin tabla: nada que borrar */
  }
}
