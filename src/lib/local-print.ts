"use client";

/**
 * Impresión local offline (Track Impresión F1).
 *
 * Contrato único para los dos listeners (F2/F3 los implementan):
 *   POST http://127.0.0.1:{8792 agente PC | 8793 app Android}/local-print
 *   { token, payload: base64(ESC/POS), printerIp?, printerPort? }
 *   → { ok: true } | { ok: false, error }
 *
 * 127.0.0.1 es origen trustworthy: el fetch desde la PWA HTTPS está
 * permitido (el mixed content solo bloquea IPs LAN). Sin listener, el
 * trabajo queda en `prints` (IndexedDB) y se ofrece reimpresión manual —
 * NUNCA automática al sincronizar (una comanda vieja reimpresa sola
 * duplicaría producción en cocina).
 */
import {
  getFixedPrinterIp,
  getVendorSnapshot,
  idmapGet,
  printsList,
  printsPatch,
  printsRemove,
  setFixedPrinterIp,
  type PrintJob,
} from "./offline-db";
import { buildContingencyBytes, bytesToBase64, type ContingencyDoc } from "./offline-print";

export const LOCAL_PRINT_PORTS = [8792, 8793];

/**
 * Traduce errores técnicos de impresión a lenguaje operativo (P0).
 * Los mensajes crudos (EHOSTUNREACH, timeouts TCP) no le dicen al comercio
 * qué hacer; estos sí: IP/DHCP, Wi-Fi, papel, token.
 */
export function describePrintError(
  raw: unknown,
  ctx?: { ip?: string | null; port?: number | null }
): string {
  const msg = String(raw ?? "").trim();
  const where = ctx?.ip ? ` (${ctx.ip}${ctx?.port ? `:${ctx.port}` : ""})` : "";
  if (!msg) return "La impresora no respondió. Verificá que esté prendida y en el mismo Wi-Fi.";
  // El celu y la impresora en subredes distintas (ej. celu 192.168.0.x vs
  // impresora 192.168.100.x): el celu se conectó a otro Wi-Fi/router.
  // Ni el auto-fix llega ahí (escanea su propia /24): hay que mover el celu.
  const src24 = msg.match(/from\s+\/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/);
  const dst24 =
    (ctx?.ip || "").split(".").slice(0, 3).join(".") ||
    (msg.match(/to\s+\/(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}/)?.[1] ?? "");
  if (src24?.[1] && dst24 && src24[1] !== dst24) {
    return (
      `El celu está en otra red Wi-Fi (${src24[1]}.x) que la impresora (${dst24}.x): ` +
      "conectalo al Wi-Fi del local, el mismo donde está la impresora. Después tocá Buscar si cambió la IP."
    );
  }
  if (/No route to host|EHOSTUNREACH/i.test(msg)) {
    return (
      `La impresora no responde en la red${where}: ` +
      "verificá que esté prendida, conectada al mismo Wi-Fi y que la IP siga siendo la misma " +
      "(el DHCP las cambia; en la app/agente usá Buscar para re-detectarla)."
    );
  }
  if (/ECONNREFUSED|Connection refused/i.test(msg)) {
    return (
      `Algo responde en esa IP pero el puerto está cerrado${where}: ` +
      "verificá que la IP sea la de la impresora térmica (puerto 9100) y no otro equipo."
    );
  }
  if (/timed? ?out|ETIMEDOUT|abort/i.test(msg)) {
    return (
      `La impresora no contestó a tiempo${where}: ` +
      "revisá señal de Wi-Fi, que esté en la misma red y con papel."
    );
  }
  if (/token inválido|sin token|missing-token|agente sin token/i.test(msg)) {
    return "Token inválido: copiá el token actual del dashboard (Configuración → Impresora) y pegalo en la app/agente.";
  }
  if (/sin IP de impresora|missing-printer-ip/i.test(msg)) {
    return "Falta la IP de la impresora: cargala en la app/agente (o usá Buscar).";
  }
  if (/cola llena|máx 100/i.test(msg)) {
    return "Cola de impresión llena: la app no está entregando (verificá IP/papel) o hay trabajos viejos atascados (vaciala).";
  }
  if (/failed to fetch|fetch failed|network ?error|load failed|offline/i.test(msg)) {
    return "Se cortó la conexión con el servidor: el ticket quedó en cola; se imprime al reconectar (o usá Imprimir ahora).";
  }
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

export type LocalListener = { port: number; service: string };
/**
 * Detecta listeners locales (agente PC :8792 / app Android :8793) en este
 * equipo. Funciona SIN internet (es localhost): sirve para el chequeo de
 * contingencia del comercio.
 */
export async function probeLocalListeners(timeoutMs = 2500): Promise<LocalListener[]> {
  const out: LocalListener[] = [];
  for (const port of LOCAL_PRINT_PORTS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/local-status`, { signal: ctrl.signal });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; service?: string } | null;
      if (data?.ok === true) out.push({ port, service: String(data.service || "local") });
    } catch {
      /* sin listener en este puerto */
    } finally {
      clearTimeout(t);
    }
  }
  return out;
}

export type VendorPrintCtx = {
  storeName: string;
  token: string | null;
  ip: string | null;
  port: number;
};

export async function getVendorPrintCtx(vendorId: string): Promise<VendorPrintCtx | null> {
  const snap = await getVendorSnapshot(vendorId).catch(() => null);
  const v = snap?.vendor as Record<string, any> | undefined;
  if (!v) return null;
  return {
    storeName: String(v.store_name || "Mi comercio"),
    token: (v.print_token as string) ?? null,
    ip: (v.printer_ip as string) ?? null,
    port: Number(v.printer_port) || 9100,
  };
}

type PostResult = { reached: boolean; ok: boolean; error?: string; data?: any };

async function postLocal(port: number, body: Record<string, any>, timeoutMs: number): Promise<PostResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/local-print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as any;
    if (data?.ok === true) return { reached: true, ok: true, data };
    return { reached: true, ok: false, error: String(data?.error || `listener ${port} rechazó`), data };
  } catch {
    return { reached: false, ok: false };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Intenta imprimir bytes ya renderizados en un listener local.
 * null = no hay ningún listener (agente/app no corre en este equipo).
 */
export async function tryLocalPrint(
  token: string,
  payloadB64: string,
  dest?: { ip?: string; port?: number }
): Promise<
  | { ok: true; via: string; printerIpUsed?: string; autoFixed?: boolean }
  | { ok: false; error: string }
  | null
> {
  let reachedAny = false;
  let lastError = "sin listener local";
  for (const port of LOCAL_PRINT_PORTS) {
    const r = await postLocal(
      port,
      {
        token,
        payload: payloadB64,
        ...(dest?.ip ? { printerIp: dest.ip } : {}),
        ...(dest?.port ? { printerPort: dest.port } : {}),
      },
      4000
    );
    if (!r.reached) continue;
    reachedAny = true;
    if (r.ok) {
      const used =
        typeof r.data?.printerIpUsed === "string" && r.data.printerIpUsed ? r.data.printerIpUsed : undefined;
      return {
        ok: true,
        via: `127.0.0.1:${port}`,
        ...(used ? { printerIpUsed: used } : {}),
        ...(r.data?.autoFixed === true ? { autoFixed: true as const } : {}),
      };
    }
    lastError = r.error || lastError;
  }
  if (!reachedAny) return null;
  return { ok: false, error: lastError };
}

/**
 * Despacha un documento de contingencia: render + listener local.
 * Completa storeName/token/destino desde el snapshot del vendor, prefiriendo
 * la última IP que realmente imprimió (anti-envenenamiento DHCP: no manda la
 * IP vieja del snapshot que pisaría la config ya corregida del listener).
 */
export async function dispatchOfflinePrint(
  vendorId: string,
  doc: Omit<ContingencyDoc, "storeName"> & { storeName?: string }
): Promise<{ printed: boolean; via?: string; error?: string; printerIpUsed?: string; autoFixed?: boolean }> {
  const ctx = await getVendorPrintCtx(vendorId).catch(() => null);
  if (!ctx?.token) return { printed: false, error: "sin token de impresión local" };
  const fixedIp = await getFixedPrinterIp(vendorId).catch(() => null);
  const bytes = buildContingencyBytes({ ...doc, storeName: doc.storeName || ctx.storeName });
  const b64 = bytesToBase64(bytes);
  if (!b64) return { printed: false, error: "render vacío" };
  const r = await tryLocalPrint(ctx.token, b64, {
    ...(fixedIp || ctx.ip ? { ip: (fixedIp || ctx.ip) as string } : {}),
    port: ctx.port,
  });
  if (!r) return { printed: false, error: "sin listener local en este equipo" };
  if (!r.ok) return { printed: false, error: r.error };
  if (r.autoFixed && r.printerIpUsed) {
    await setFixedPrinterIp(vendorId, r.printerIpUsed).catch(() => {});
  }
  return {
    printed: true,
    via: r.via,
    ...(r.printerIpUsed ? { printerIpUsed: r.printerIpUsed } : {}),
    ...(r.autoFixed ? { autoFixed: true as const } : {}),
  };
}

/** Marca impresos los trabajos de un localId (evita reimpresión al sincronizar). */
export async function markPrintsDone(vendorId: string, orderLocalId: string): Promise<void> {
  try {
    const jobs = (await printsList(vendorId)).filter(
      (j) => j.orderLocalId === orderLocalId && !j.printed && j.id != null
    );
    for (const j of jobs) await printsPatch(j.id as number, { printed: true });
  } catch {
    /* noop */
  }
}

const PRINT_TYPE: Record<string, string> = {
  comanda: "comanda",
  ticket: "ticket",
  retiro: "retiro",
  despacho: "despacho",
};

export type FlushResult = { printed: number; failed: number; errors: string[] };

/**
 * Reimpresión MANUAL de pendientes (vía servidor, full-fidelity). Se llama
 * desde UI ("Imprimir pendientes"), nunca automática en el sync: resuelve
 * localId→orderId real vía idmap; precuenta usa su payload guardado.
 * Purga impresos de +7 días.
 */
export async function flushPendingPrints(vendorId: string): Promise<FlushResult> {
  const out: FlushResult = { printed: 0, failed: 0, errors: [] };
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let jobs: PrintJob[] = [];
  try {
    jobs = await printsList(vendorId);
  } catch {
  return out;
  }
  const idmap = await idmapGet(vendorId).catch(() => ({} as Record<string, { orderId: string }>));
  for (const job of jobs) {
    if (job.id == null) continue;
    if (job.printed) {
      if (job.createdAt < weekAgo) {
        try {
          await printsRemove(job.id);
        } catch {
          /* noop */
        }
      }
      continue;
    }
    try {
      let body: Record<string, any> | null = null;
      if (job.doc === "precuenta") {
        const p = (job.payload || {}) as Record<string, any>;
        if (!Array.isArray(p.items) || p.items.length === 0) {
          await printsPatch(job.id, { printed: true });
          continue;
        }
        body = {
          type: "precuenta",
          tableName: p.tableName,
          items: p.items,
          total: p.total,
          cashPct: p.cashPct || 0,
          cashTotal: p.cashTotal || 0,
        };
      } else {
        const ref = idmap[job.orderLocalId];
        if (!ref?.orderId) continue; // aún no sincronizado: queda para después
        body = { orderId: ref.orderId, type: PRINT_TYPE[job.doc] || "comanda" };
      }
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data as any)?.ok) {
        await printsPatch(job.id, { printed: true });
        out.printed++;
      } else {
        await printsPatch(job.id, { attempts: (job.attempts || 0) + 1 });
        out.failed++;
        if (out.errors.length < 2) out.errors.push(String((data as any)?.error || (data as any)?.reason || "impresora no disponible"));
      }
    } catch {
      out.failed++;
    }
  }
  try {
    window.dispatchEvent(new Event("portal:outbox-changed"));
  } catch {
    /* noop */
  }
  return out;
}

export type LocalScanResult = { port: number; service: string; hosts: string[] };

/**
 * Escanea la LAN desde los listeners locales (Buscar desde la web).
 * Requiere el token del vendor (lo saca del snapshot). Funciona SIN
 * internet. Devuelve por listener los hosts con el puerto abierto.
 */
export async function scanLocalPrinters(
  vendorId: string,
  port = 9100,
  timeoutMs = 30000
): Promise<{ listeners: LocalScanResult[]; error?: string }> {
  const ctx = await getVendorPrintCtx(vendorId).catch(() => null);
  const token = ctx?.token;
  if (!token) return { listeners: [], error: "sin token de impresión local" };
  const scanned = await Promise.all(
    LOCAL_PRINT_PORTS.map(async (lp): Promise<LocalScanResult | null> => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(
          `http://127.0.0.1:${lp}/local-scan?token=${encodeURIComponent(token)}&port=${port}`,
          { signal: ctrl.signal }
        );
        const data = (await res.json().catch(() => null)) as { ok?: boolean; hosts?: string[] } | null;
        if (data?.ok !== true) return null;
        return {
          port: lp,
          service: lp === 8792 ? "agente PC" : "app Android",
          hosts: Array.isArray(data.hosts) ? data.hosts.map(String) : [],
        };
      } catch {
        return null;
      } finally {
        clearTimeout(t);
      }
    })
  );
  const listeners = scanned.filter((s): s is LocalScanResult => s !== null);
  if (listeners.length === 0) {
    return { listeners, error: "sin listener local en este equipo (abrí el agente o la app acá)" };
  }
  return { listeners };
}

/**
 * Fija la IP elegida en el listener local (además del vendor). Así lo
 * elegido en la web queda también en la app/agente de este equipo.
 */
export async function pushLocalPrinterIp(
  vendorId: string,
  listenerPort: number,
  ip: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getVendorPrintCtx(vendorId).catch(() => null);
  const token = ctx?.token;
  if (!token) return { ok: false, error: "sin token de impresión local" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`http://127.0.0.1:${listenerPort}/local-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, printerIp: ip }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (data?.ok === true) return { ok: true };
    return { ok: false, error: String(data?.error || "no se pudo guardar") };
  } catch {
    return { ok: false, error: "sin respuesta del listener local" };
  } finally {
    clearTimeout(t);
  }
}
