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
  getVendorSnapshot,
  idmapGet,
  printsList,
  printsPatch,
  printsRemove,
  type PrintJob,
} from "./offline-db";
import { buildContingencyBytes, bytesToBase64, type ContingencyDoc } from "./offline-print";

export const LOCAL_PRINT_PORTS = [8792, 8793];

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

type PostResult = { reached: boolean; ok: boolean; error?: string };

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
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (data?.ok === true) return { reached: true, ok: true };
    return { reached: true, ok: false, error: String(data?.error || `listener ${port} rechazó`) };
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
): Promise<{ ok: true; via: string } | { ok: false; error: string } | null> {
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
    if (r.ok) return { ok: true, via: `127.0.0.1:${port}` };
    lastError = r.error || lastError;
  }
  if (!reachedAny) return null;
  return { ok: false, error: lastError };
}

/**
 * Despacha un documento de contingencia: render + listener local.
 * Completa storeName/token/destino desde el snapshot del vendor.
 */
export async function dispatchOfflinePrint(
  vendorId: string,
  doc: Omit<ContingencyDoc, "storeName"> & { storeName?: string }
): Promise<{ printed: boolean; via?: string; error?: string }> {
  const ctx = await getVendorPrintCtx(vendorId).catch(() => null);
  if (!ctx?.token) return { printed: false, error: "sin token de impresión local" };
  const bytes = buildContingencyBytes({ ...doc, storeName: doc.storeName || ctx.storeName });
  const b64 = bytesToBase64(bytes);
  if (!b64) return { printed: false, error: "render vacío" };
  const r = await tryLocalPrint(ctx.token, b64, {
    ...(ctx.ip ? { ip: ctx.ip } : {}),
    port: ctx.port,
  });
  if (!r) return { printed: false, error: "sin listener local en este equipo" };
  if (!r.ok) return { printed: false, error: r.error };
  return { printed: true, via: r.via };
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
