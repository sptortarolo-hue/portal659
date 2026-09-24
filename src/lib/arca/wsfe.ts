/**
 * WSFEv1 — Solicitud de CAE para Factura C (cbte tipo 11, Concepto 1
 * productos, receptor consumidor final Doc 99/0).
 *
 * v1 del módulo: solo Factura C de monotributo. Los importes van con 2
 * decimales; en C el neto = total (sin IVA discriminado).
 */
import { ArcaError, dropWsaaTicket, getWsaaTicket, redactXml, type ArcaEnv } from "./wsaa";

export const CBTE_FACTURA_C = 11;

const WSFE_URL: Record<ArcaEnv, string> = {
  homo: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  prod: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

function soapFetch(
  url: string,
  body: string,
  action: string,
  opts: { retryNetwork?: boolean } = {}
): Promise<string> {
  // Ver wsaa.ts: 15s por llamada + conexión fresca (reelige backend) +
  // reintento ante xml.bad (el XML no se procesó: seguro repetir).
  // `retryNetwork`: solo en lecturas (último/consultar). En solicitar NO:
  // un timeout con resultado ambiguo + retry podría duplicar el CAE
  // (para eso ya existe el recupero 10016 + consultar).
  const MAX_ATTEMPTS = 2;
  const retryNetwork = opts.retryNetwork === true;
  const run = (attempt: number): Promise<string> => {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 15000);
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: action,
        Connection: "close",
      },
      body,
      signal: ac.signal,
    })
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1]?.trim().slice(0, 200);
          const err = new ArcaError(`WSFE HTTP ${res.status}${fault ? `: ${fault}` : ""}`, redactXml(text).slice(0, 1500));
          (err as { xmlBad?: boolean }).xmlBad = text.includes("xml.bad");
          throw err;
        }
        return text;
      })
      .catch((e: unknown) => {
        const retryable =
          e instanceof ArcaError
            ? (e as { xmlBad?: boolean }).xmlBad === true
            : retryNetwork;
        if (retryable && attempt < MAX_ATTEMPTS) return run(attempt + 1);
        if (e instanceof ArcaError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(msg))) {
          throw new ArcaError("ARCA no respondió en 15s (facturación)");
        }
        throw new ArcaError(`Sin conexión a ARCA (${msg.slice(0, 120)})`);
      })
      .finally(() => clearTimeout(timeout));
  };
  return run(1);
}

/** Tag tolerante a namespaces/prefijos (<ns:Tag>, <Tag x=...>). */
function tag(xml: string, name: string): string | null {
  return (
    xml
      .match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`))?.[1]
      ?.trim() ?? null
  );
}

/** Extrae errores ARCA `<Err><Code>x</Code><Msg>y</Msg></Err>` (tolera prefijos). */
export function parseArcaErrors(xml: string): { code: string; msg: string }[] {
  const out: { code: string; msg: string }[] = [];
  const t = (n: string) => `(?:<\\w+:)?${n}(?:\\s[^>]*)?>`;
  const c = (n: string) => `<\\/(?:\\w+:)?${n}>`;
  const re = new RegExp(`${t("Err")}\\s*${t("Code")}([\\s\\S]*?)${c("Code")}\\s*${t("Msg")}([\\s\\S]*?)${c("Msg")}\\s*${c("Err")}`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push({ code: m[1].trim(), msg: m[2].trim() });
  return out;
}

/** Extrae observaciones `<Obs><Code>x</Code><Msg>y</Msg></Obs>` (tolera prefijos). */
function parseArcaObs(xml: string): string[] {
  const t = (n: string) => `(?:<\\w+:)?${n}(?:\\s[^>]*)?>`;
  const c = (n: string) => `<\\/(?:\\w+:)?${n}>`;
  const re = new RegExp(`${t("Obs")}\\s*${t("Code")}[\\s\\S]*?${c("Code")}\\s*${t("Msg")}([\\s\\S]*?)${c("Msg")}\\s*${c("Obs")}`, "g");
  return [...xml.matchAll(re)].map((m) => m[1].trim());
}

function authBlock(token: string, sign: string, cuit: string): string {
  return (
    `<Auth><Token>${token}</Token><Sign>${sign}</Sign>` +
    `<Cuit>${cuit}</Cuit></Auth>`
  );
}

export type WsfeAuth = {
  env: ArcaEnv;
  cuit: string;
  certPem: string;
  keyPem: string;
};

async function withTicket<T>(
  auth: WsfeAuth,
  fn: (token: string, sign: string) => Promise<T>
): Promise<T> {
  const t = await getWsaaTicket(auth.env, auth.cuit, auth.certPem, auth.keyPem);
  try {
    return await fn(t.token, t.sign);
  } catch (e) {
    // Si el token estaba vencido del lado de ARCA, se invalida y se reintenta 1 vez.
    if (e instanceof ArcaError && /ta\.expir|token|sign/i.test(e.message + (e.detail || ""))) {
      await dropWsaaTicket(auth.env, auth.cuit);
      const t2 = await getWsaaTicket(auth.env, auth.cuit, auth.certPem, auth.keyPem);
      return fn(t2.token, t2.sign);
    }
    throw e;
  }
}

/** Último comprobante autorizado para (ptoVta, tipo). El próximo es +1. */
export async function ultimoAutorizado(
  auth: WsfeAuth,
  ptoVta: number,
  cbteTipo: number
): Promise<number> {
  return withTicket(auth, async (token, sign) => {
    const body =
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `><soap:Header/><soap:Body>` +
      `<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">${authBlock(token, sign, auth.cuit)}` +
      `<PtoVta>${ptoVta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo>` +
      `</FECompUltimoAutorizado></soap:Body></soap:Envelope>`;
    const xml = await soapFetch(
      WSFE_URL[auth.env],
      body,
      "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado",
      { retryNetwork: true }
    );
    const errs = parseArcaErrors(xml);
    if (errs.length > 0) throw new ArcaError(`ARCA: ${errs[0].msg}`, `code ${errs[0].code}`);
    const nro = tag(xml, "CbteNro");
    if (nro == null || !/^\d+$/.test(nro)) throw new ArcaError("ARCA no devolvió último comprobante", xml.slice(0, 300));
    return Number(nro);
  });
}

export type SolicitarCaeInput = {
  ptoVta: number;
  cbteNro: number;
  /** Total del comprobante (se redondea a 2 decimales). */
  total: number;
  /** Fecha del comprobante (default: hoy). */
  fecha?: Date;
};

export type SolicitarCaeResult = {
  cbteNro: number;
  cae: string;
  caeVto: string; // YYYYMMDD
  resultado: "A" | "R";
  observaciones: string[];
};

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const yyyymmdd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/** Pide CAE para una Factura C concreta. Lanza ArcaError si es rechazada. */
export async function solicitarCaeC(
  auth: WsfeAuth,
  input: SolicitarCaeInput
): Promise<SolicitarCaeResult> {
  if (!Number.isFinite(input.total) || input.total <= 0) {
    throw new ArcaError("Total inválido para facturar");
  }
  const imp = money(input.total);
  const fch = yyyymmdd(input.fecha ?? new Date());

  return withTicket(auth, async (token, sign) => {
    const det =
      `<FECAEDetRequest><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>` +
      `<CbteDesde>${input.cbteNro}</CbteDesde><CbteHasta>${input.cbteNro}</CbteHasta>` +
      `<CbteFch>${fch}</CbteFch><ImpTotal>${imp}</ImpTotal><ImpTotConc>0</ImpTotConc>` +
      `<ImpNeto>${imp}</ImpNeto><ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>0</ImpIVA>` +
      `<MonId>PES</MonId><MonCotiz>1</MonCotiz></FECAEDetRequest>`;
    const body =
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `><soap:Header/><soap:Body>` +
      `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">${authBlock(token, sign, auth.cuit)}` +
      `<FeCAEReq><FeCabReq><CantReg>1</CantReg>` +
      `<PtoVta>${input.ptoVta}</PtoVta><CbteTipo>${CBTE_FACTURA_C}</CbteTipo>` +
      `</FeCabReq><FeDetReq>${det}</FeDetReq></FeCAEReq>` +
      `</FECAESolicitar></soap:Body></soap:Envelope>`;
    const xml = await soapFetch(
      WSFE_URL[auth.env],
      body,
      "http://ar.gov.afip.dif.FEV1/FECAESolicitar"
    );

    const errs = parseArcaErrors(xml);
    if (errs.length > 0) {
      const dup = errs.find((e) => e.code === "10016");
      const err = new ArcaError(`ARCA: ${errs[0].msg}`, `code ${errs[0].code}`);
      (err as { arcaCode?: string }).arcaCode = errs[0].code;
      if (dup) (err as { duplicate?: boolean }).duplicate = true;
      throw err;
    }
    const resultado = tag(xml, "Resultado");
    if (resultado === "R") {
      const obs = parseArcaObs(xml);
      throw new ArcaError(`ARCA rechazó el comprobante${obs[0] ? `: ${obs[0]}` : ""}`, redactXml(xml).slice(0, 1500));
    }
    const cae = tag(xml, "CAE");
    const caeVto = tag(xml, "CAEFchVto");
    const cbte = tag(xml, "CbteDesde");
    if (!cae || !caeVto) throw new ArcaError("ARCA no devolvió CAE", redactXml(xml).slice(0, 1500));
    const observaciones = parseArcaObs(xml);
    return {
      cbteNro: cbte ? Number(cbte) : input.cbteNro,
      cae,
      caeVto,
      resultado: (resultado === "A" ? "A" : "R") as "A" | "R",
      observaciones,
    };
  });
}

export type ConsultarResult = {
  cbteNro: number;
  cae: string;
  caeVto: string;
} | null;

/**
 * Recupera el CAE de un comprobante ya autorizado (idempotencia: si el
 * pedido de CAE se cortó a mitad de camino o el número ya estaba usado,
 * ARCA lo devuelve acá en vez de duplicar).
 */
export async function consultarComprobante(
  auth: WsfeAuth,
  ptoVta: number,
  cbteNro: number
): Promise<ConsultarResult> {
  return withTicket(auth, async (token, sign) => {
    const body =
      `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `><soap:Header/><soap:Body>` +
      `<FECompConsultar xmlns="http://ar.gov.afip.dif.FEV1/">${authBlock(token, sign, auth.cuit)}` +
      `<FeCompConsReq><PtoVta>${ptoVta}</PtoVta>` +
      `<CbteTipo>${CBTE_FACTURA_C}</CbteTipo><CbteNro>${cbteNro}</CbteNro>` +
      `</FeCompConsReq></FECompConsultar></soap:Body></soap:Envelope>`;
    const xml = await soapFetch(
      WSFE_URL[auth.env],
      body,
      "http://ar.gov.afip.dif.FEV1/FECompConsultar",
      { retryNetwork: true }
    );
    const errs = parseArcaErrors(xml);
    if (errs.length > 0) return null;
    const cae = tag(xml, "CodAutorizacion");
    const caeVto = tag(xml, "FchVto");
    const nro = tag(xml, "CbteDesde");
    if (!cae || !caeVto) return null;
    return { cbteNro: nro ? Number(nro) : cbteNro, cae, caeVto };
  });
}
