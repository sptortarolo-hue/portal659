/**
 * WSFEv1 — Solicitud de CAE para Factura C (cbte tipo 11, Concepto 1
 * productos, receptor consumidor final Doc 99/0).
 *
 * v1 del módulo: solo Factura C de monotributo. Los importes van con 2
 * decimales; en C el neto = total (sin IVA discriminado).
 */
import { ArcaError, dropWsaaTicket, getWsaaTicket, type ArcaEnv } from "./wsaa";

export const CBTE_FACTURA_C = 11;

const WSFE_URL: Record<ArcaEnv, string> = {
  homo: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  prod: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

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
      if (!res.ok) throw new ArcaError(`WSFE HTTP ${res.status}`, text.slice(0, 500));
      return text;
    })
    .finally(() => clearTimeout(timeout));
}

function tag(xml: string, name: string): string | null {
  return xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1]?.trim() ?? null;
}

/** Extrae errores ARCA `<Err><Code>x</Code><Msg>y</Msg></Err>`. */
export function parseArcaErrors(xml: string): { code: string; msg: string }[] {
  const out: { code: string; msg: string }[] = [];
  const re = /<Err>\s*<Code>([\s\S]*?)<\/Code>\s*<Msg>([\s\S]*?)<\/Msg>\s*<\/Err>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push({ code: m[1].trim(), msg: m[2].trim() });
  return out;
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
      dropWsaaTicket(auth.env, auth.cuit);
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
      `xmlns:dif="http://ar.gov.afip.dif.FEV1/"><soap:Header/><soap:Body>` +
      `<dif:FECompUltimoAutorizado>${authBlock(token, sign, auth.cuit)}` +
      `<dif:PtoVta>${ptoVta}</dif:PtoVta><dif:CbteTipo>${cbteTipo}</dif:CbteTipo>` +
      `</dif:FECompUltimoAutorizado></soap:Body></soap:Envelope>`;
    const xml = await soapFetch(
      WSFE_URL[auth.env],
      body,
      "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado"
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
      `xmlns:dif="http://ar.gov.afip.dif.FEV1/"><soap:Header/><soap:Body>` +
      `<dif:FECAESolicitar>${authBlock(token, sign, auth.cuit)}` +
      `<dif:FeCAEReq><dif:FeCabReq><dif:CantReg>1</dif:CantReg>` +
      `<dif:PtoVta>${input.ptoVta}</dif:PtoVta><dif:CbteTipo>${CBTE_FACTURA_C}</dif:CbteTipo>` +
      `</dif:FeCabReq><dif:FeDetReq>${det}</dif:FeDetReq></dif:FeCAEReq>` +
      `</dif:FECAESolicitar></soap:Body></soap:Envelope>`;
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
      const obs = [...xml.matchAll(/<Obs>\s*<Code>[\s\S]*?<\/Code>\s*<Msg>([\s\S]*?)<\/Msg>\s*<\/Obs>/g)].map((m) => m[1].trim());
      throw new ArcaError(`ARCA rechazó el comprobante${obs[0] ? `: ${obs[0]}` : ""}`, xml.slice(0, 500));
    }
    const cae = tag(xml, "CAE");
    const caeVto = tag(xml, "CAEFchVto");
    const cbte = tag(xml, "CbteDesde");
    if (!cae || !caeVto) throw new ArcaError("ARCA no devolvió CAE", xml.slice(0, 500));
    const observaciones = [...xml.matchAll(/<Obs>\s*<Code>[\s\S]*?<\/Code>\s*<Msg>([\s\S]*?)<\/Msg>\s*<\/Obs>/g)].map((m) => m[1].trim());
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
      `xmlns:dif="http://ar.gov.afip.dif.FEV1/"><soap:Header/><soap:Body>` +
      `<dif:FECompConsultar>${authBlock(token, sign, auth.cuit)}` +
      `<dif:FeCompConsReq><dif:PtoVta>${ptoVta}</dif:PtoVta>` +
      `<dif:CbteTipo>${CBTE_FACTURA_C}</dif:CbteTipo><dif:CbteNro>${cbteNro}</dif:CbteNro>` +
      `</dif:FeCompConsReq></dif:FECompConsultar></soap:Body></soap:Envelope>`;
    const xml = await soapFetch(
      WSFE_URL[auth.env],
      body,
      "http://ar.gov.afip.dif.FEV1/FECompConsultar"
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
