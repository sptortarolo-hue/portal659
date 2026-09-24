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

/** Diagnóstico de red: IPs que resuelve el host (nunca frena la llamada). */
async function resolvedIps(hostname: string): Promise<string> {
  try {
    const dns = await import("node:dns/promises");
    const recs = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise<null>((r) => setTimeout(() => r(null), 2000)),
    ]);
    if (!recs) return "?";
    return (recs as { address: string }[]).map((r) => r.address).join(",");
  } catch {
    return "?";
  }
}

/** Log de wire-diagnóstico: longitudes + prefijos (SIN secretos: del CMS
 *  solo los primeros 40 chars = headers ASN.1, sin key ni cert). */
function wireLog(url: string, body: string, ips: string): void {
  try {
    const in0 = body.indexOf("<in0>");
    const head = in0 >= 0 ? body.slice(0, Math.min(in0, 300)) : body.slice(0, 300);
    const cms = in0 >= 0 ? body.slice(in0 + 5, body.indexOf("</in0>")) : "";
    // Un CMS válido es base64 puro (alfabeto A-Za-z0-9+/=). Cualquier otro
    // char rompería el parseo XML del lado de ARCA: se detecta acá.
    const cmsB64 = /^[A-Za-z0-9+/=]+$/.test(cms);
    console.log(
      `[fiscal] wire host=${new URL(url).hostname} ips=${ips} ` +
        `env-bytes=${body.length} cms-len=${cms.length} cms-b64=${cmsB64} cms-head=${cms.slice(0, 40)} head=${head.replace(/\s+/g, " ").slice(0, 220)}`
    );
  } catch {
    /* diagnóstico best-effort */
  }
}

/** Fault de schema (el XML no se procesó: seguro reintentar con otra conexión). */
function isXmlBad(text: string): boolean {
  return text.includes("xml.bad");
}

function soapFetch(url: string, body: string, action: string): Promise<string> {
  // 15s por llamada. `Connection: close` fuerza conexión fresca por intento:
  // ARCA balancea entre varios backends (wsaaext0, wsaaext1...) y el pool
  // keep-alive puede dejar clavado un backend roto; cada intento reelige.
  // Reintentos (máx 2): xml.bad (no se procesó nada) y fallos de red/timeout.
  // Para login es seguro: en el peor caso ARCA responde "ya posee TA" y se
  // informa sin loopear.
  const MAX_ATTEMPTS = 2;
  const run = (attempt: number): Promise<string> => {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 15000);
    return resolvedIps(new URL(url).hostname)
      .then((ips) => {
        wireLog(url, body, `${ips} att=${attempt}`);
        return fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: action,
            Connection: "close",
          },
          body,
          signal: ac.signal,
        });
      })
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          // El faultstring dice el motivo real (cert no asociado, TRA
          // vencido, CMS inválido...). Va en el mensaje para que salga en
          // los logs [fiscal]; no contiene secretos. El cuerpo se redacta
          // (sin token/sign) para diagnóstico completo.
          const fault = faultString(text)?.slice(0, 200);
          const err = new ArcaError(
            `WSAA HTTP ${res.status}${fault ? `: ${fault}` : ""}`,
            redactXml(text).slice(0, 1500)
          );
          (err as { xmlBad?: boolean }).xmlBad = isXmlBad(text);
          throw err;
        }
        return text;
      })
      .catch((e: unknown) => {
        const retryable =
          e instanceof ArcaError
            ? (e as { xmlBad?: boolean }).xmlBad === true
            : true; // red/timeout: reintentar (login no duplica nada)
        if (retryable && attempt < MAX_ATTEMPTS) {
          const host =
            e instanceof ArcaError
              ? (e.detail || "").match(/hostname[^>]*>([^<]*)</)?.[1] || "?"
              : "?";
          console.log(`[fiscal] wsaa att=${attempt} backend=${host} reintenta`);
          return run(attempt + 1);
        }
        if (e instanceof ArcaError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(msg))) {
          throw new ArcaError(`ARCA no respondió en 15s (login ${action})`);
        }
        throw new ArcaError(`Sin conexión a ARCA (${msg.slice(0, 120)})`);
      })
      .finally(() => clearTimeout(timeout));
  };
  return run(1);
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
  // Segundos (10 dígitos), como pyafipws y el manual oficial. NO usar ms ni
  // azar: el TRA tiene schema propio en ARCA y el uniqueId largo (16
  // dígitos) gatilla "No se ha podido interpretar el XML contra el SCHEMA".
  // La colisión mismo-segundo la maneja WSAA con coe.alreadyAuthenticated.
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

/** Des-escapa entidades XML (&lt; &gt; &quot; &apos; &amp;, en ese orden). */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseLoginResponse(xml: string): { token: string; sign: string } {
  // WSAA devuelve el TA escapado como entidades dentro de loginCmsReturn
  // (&lt;credentials&gt;&lt;token&gt;...): se des-escapa primero o el token
  // nunca matchea ("ARCA no devolvió token" fantasma). Tolerante además a
  // namespaces (<ns:token>) y atributos: un TA perdido acá deja a WSAA
  // negando nuevos por 12 h.
  const clean = unescapeXml(xml);
  const token = clean.match(/<(?:\w+:)?token(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?token>/)?.[1]?.trim();
  const sign = clean.match(/<(?:\w+:)?sign(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?sign>/)?.[1]?.trim();
  if (!token || !sign) {
    const fault = faultString(clean);
    if (fault?.includes("coe.alreadyAuthenticated")) {
      throw new ArcaError("ARCA: login duplicado en curso (reintentá en unos segundos)", fault);
    }
    // Cuerpo redactado sobre el texto des-escapado (un token escapado
    // también se tapa: nunca filtrar credenciales al log).
    throw new ArcaError("ARCA no devolvió token (¿certificado asociado al WS?)", fault || redactXml(clean).slice(0, 1500));
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

  // Namespace = URL del servicio (por entorno): es la forma del único
  // request con TA exitoso capturado byte a byte (pyafipws cassette
  // test_login_cms.yaml, 2021-06-19, HTTP 200): prolog + prefijo ser: con
  // la URL del servicio + <in0> sin calificar. Ni el tns1 del WSDL ni el
  // histórico dgr validan de forma estable en homo.
  const WSAA_OP_NS: Record<ArcaEnv, string> = {
    homo: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    prod: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
  };

  const job = (async (): Promise<WsaaTicket> => {
    const tra = buildTra("wsfe");
    const cms = signTra(tra, certPem, keyPem);
    const envelope =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `xmlns:ser="${WSAA_OP_NS[env]}">` +
      `<soapenv:Header/><soapenv:Body>` +
      `<ser:loginCms><in0>${cms}</in0></ser:loginCms>` +
      `</soapenv:Body></soapenv:Envelope>`;
    const xml = await soapFetch(WSAA_URL[env], envelope, "loginCms");
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
