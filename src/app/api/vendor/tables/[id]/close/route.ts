import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, queryMany, withTransaction } from "@/lib/db";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";
import { resolveOrderPricing, PricingError, type IncomingOrderItem, type ResolvedPricing } from "@/lib/pricing";
import { getOpenShift } from "@/lib/cash-closing";
import {
  claimSyncKey,
  findMissingSyncKeys,
  getOfflineSyncCaps,
  normalizeClientKey,
  releaseSyncKey,
  storeSyncResult,
} from "@/lib/sync-idempotency";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json({ error: "Las mesas forman parte del plan Gestión integral" }, { status: 403 });
  }
  // vendorId capturado: el narrowing del gate no entra a funciones anidadas.
  const vendorId = gate.vendor.id;

  // Switch "exigir caja abierta": sin turno abierto no se cobra la mesa
  // (cargar consumiciones sigue permitido; solo el cobro exige turno).
  if (gate.vendor.require_open_shift === true) {
    const shift = await getOpenShift(gate.vendor.id);
    if (!shift) {
      return NextResponse.json(
        { error: "Abrí la caja para cobrar la mesa", code: "shift_required" },
        { status: 409 }
      );
    }
  }

  const { id } = await params;
  const body = await request.json();
  const paymentMethod = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp"].includes(body?.paymentMethod)
    ? body.paymentMethod
    : "efectivo";

  // Descuento manual al cobrar ($ o % con motivo). Si no viene, se conserva
  // el ya guardado en cada cuenta (recalculado sobre la cuenta final).
  type ManualDiscountIn = { kind: "amount" | "percent"; value: number; reason: string | null };
  let closeManualIn: ManualDiscountIn | null = null;
  const mdRaw = (body as any)?.manualDiscount;
  if (mdRaw != null && typeof mdRaw === "object") {
    const kind = mdRaw.kind === "percent" ? "percent" : mdRaw.kind === "amount" ? "amount" : null;
    const value = Number(mdRaw.value);
    const reason = String(mdRaw.reason || "").trim().slice(0, 120) || null;
    if (kind && Number.isFinite(value) && value > 0) {
      if (kind === "percent" && value > 100) {
        return NextResponse.json({ error: "El porcentaje no puede superar el 100%" }, { status: 400 });
      }
      closeManualIn = { kind, value, reason };
    } else {
      return NextResponse.json({ error: "Descuento manual inválido" }, { status: 400 });
    }
  }

  // Idempotencia del sync offline (Fase 0) + gate causal: el cierre solo es
  // válido si las consumiciones previas ya están sincronizadas. El cliente
  // offline manda expected_keys (client_keys de lo cargado en la mesa); si
  // falta alguna, responde 409 `sync_pending` para que las sincronice primero.
  const caps = await getOfflineSyncCaps();
  const clientKey = caps.syncTable ? normalizeClientKey(body?.client_key) : null;
  const expectedKeys =
    caps.syncTable && caps.ordersClientKey && Array.isArray(body?.expected_keys)
      ? (body.expected_keys as unknown[])
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim().slice(0, 64))
          .filter(Boolean)
          .slice(0, 100)
      : [];

  if (clientKey) {
    const claimed = await withTransaction(async (tx) =>
      claimSyncKey(tx, gate.vendor.id, clientKey, "table_close")
    );
    if (!claimed.fresh) {
      if (claimed.inProgress || !claimed.result) {
        return NextResponse.json(
          { error: "Sincronización en curso, reintentá en unos segundos", code: "sync_in_progress" },
          { status: 409 }
        );
      }
      return NextResponse.json({ ...(claimed.result as Record<string, unknown>), dedup: true });
    }
  }
  const abortClaim = async () => {
    if (!clientKey) return;
    try {
      await withTransaction(async (tx) => releaseSyncKey(tx, gate.vendor.id, clientKey));
    } catch {
      /* best-effort */
    }
  };

  const table = await queryOne<Record<string, any>>(
    `SELECT id, name, status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );

  if (!table) { await abortClaim(); return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 }); }
  if (table.status !== "ocupada") {
    await abortClaim();
    return NextResponse.json({ error: "La mesa está libre" }, { status: 400 });
  }

  if (expectedKeys.length > 0) {
    const missing = await findMissingSyncKeys(gate.vendor.id, expectedKeys);
    if (missing.length > 0) {
      await abortClaim();
      return NextResponse.json(
        {
          error: "Hay consumiciones sin sincronizar en esta mesa. Sincronizalas antes de cerrar.",
          code: "sync_pending",
          missing,
        },
        { status: 409 }
      );
    }
  }

  const orders = await queryMany<Record<string, any>>(
    `SELECT id, total, status, paid_at, items FROM orders WHERE vendor_id = $1 AND table_id = $2 AND status NOT IN ('cancelled', 'completed')`,
    [gate.vendor.id, table.id]
  );

  const list = orders || [];

  // Al cerrar se re-resuelve cada cuenta con la misma regla que el canal
  // app (precios de DB + volumen + cash sobre neto con combine_cash). Si una
  // cuenta no resuelve (ej: producto dado de baja a mitad del servicio), esa
  // cuenta cae al cálculo legacy (cash sobre lo guardado) sin frenar el cierre.
  const cashPct = paymentMethod === "efectivo" ? normalizeCashPct((gate.vendor as any).cash_discount_pct) : 0;
  let cashDiscountTotal = 0;
  let volumeDiscountTotal = 0;
  let manualDiscountTotal = 0;
  type ManualApplied = { amount: number; kind: string | null; reason: string | null; value: number | null };
  const perOrder = new Map<string, { cashPct: number; cashDiscount: number; total: number; items: unknown[]; volumeDiscount: number; manual: ManualApplied }>();
  const noManual: ManualApplied = { amount: 0, kind: null, reason: null, value: null };

  let hasVolumeCol = false;
  try {
    const vc = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'orders' AND column_name = 'volume_discount'
       ) AS exists`
    );
    hasVolumeCol = vc?.exists === true;
  } catch {
    hasVolumeCol = false;
  }

  let hasManualCol = false;
  try {
    const mc = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'orders' AND column_name = 'manual_discount'
       ) AS exists`
    );
    hasManualCol = mc?.exists === true;
  } catch {
    hasManualCol = false;
  }
  // Descuento manual guardado por cuenta (para conservarlo si el cierre no
  // trae uno nuevo). Tolerante a migración sin aplicar.
  const storedManual = new Map<string, ManualDiscountIn & { amount: number }>();
  if (hasManualCol && list.length > 0) {
    try {
      const mrows = await queryMany<{ id: string; manual_discount: unknown; manual_discount_kind: unknown; manual_discount_value: unknown; manual_discount_reason: unknown }>(
        `SELECT id, manual_discount, manual_discount_kind, manual_discount_value, manual_discount_reason FROM orders WHERE id = ANY($1)`,
        [list.map((o) => o.id)]
      );
      for (const m of mrows || []) {
        const sk = m?.manual_discount_kind === "percent" ? "percent" : m?.manual_discount_kind === "amount" ? "amount" : null;
        const sv = Number(m?.manual_discount_value);
        if (sk && Number.isFinite(sv) && sv > 0) {
          storedManual.set(String(m.id), {
            kind: sk,
            value: sv,
            reason: m?.manual_discount_reason != null ? String(m.manual_discount_reason) : null,
            amount: Number(m?.manual_discount) || 0,
          });
        }
      }
    } catch {
      /* sin columnas: sin descuento guardado */
    }
  }

  const isUuid = (s: unknown): s is string =>
    typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // pricing solo lee: basta un querier sobre el pool.
  const poolTx = {
    query: async <T extends Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> =>
      queryMany<T>(sql, params),
  };

  // Legacy (cash sobre lo guardado) para la cuenta que no re-resuelva.
  // Conserva el descuento manual ya guardado; si el cierre trae uno nuevo se
  // aplica sobre el total guardado (caso raro: pricing falló igual).
  async function legacyCash(orderId: string, stored: any[], storedTotal: number): Promise<void> {
    const sm = storedManual.get(orderId);
    const md = closeManualIn ?? sm ?? null;
    const mdNew = md !== null && md !== sm;
    const base = Math.max(0, storedTotal);
    const mdAmount = !mdNew || !md ? 0 : md.kind === "percent" ? Math.min(base, round2((base * md.value) / 100)) : Math.min(base, round2(md.value));
    const keptManual: ManualApplied = mdNew && md
      ? { amount: mdAmount, kind: md.kind, reason: md.reason, value: md.value }
      : sm ? { amount: sm.amount, kind: sm.kind, reason: sm.reason, value: sm.value } : noManual;
    const keptTotal = mdNew ? Math.max(0, round2(storedTotal - mdAmount)) : storedTotal;
    if (cashPct <= 0) {
      perOrder.set(orderId, {
        cashPct: 0, cashDiscount: 0, total: keptTotal, items: stored, volumeDiscount: 0,
        manual: keptManual,
      });
      if (keptManual.amount > 0) manualDiscountTotal += keptManual.amount;
      return;
    }
    const ids = new Set<string>();
    for (const i of stored) {
      if (isUuid(i?.product_id)) ids.add(i.product_id);
    }
    const prows = ids.size
      ? await queryMany<{ id: string; promo_price: number | null; cash_discount_excluded: boolean | null }>(
          `SELECT id, promo_price, cash_discount_excluded FROM products WHERE vendor_id = $1 AND id = ANY($2)`,
          [vendorId, [...ids]]
        )
      : [];
    const pmap = new Map((prows || []).map((p) => [p.id, p]));
    const { cashDiscount } = cashDiscountForItems(
      stored.map((i: any) => {
        const p = i?.product_id ? pmap.get(String(i.product_id)) : undefined;
        const pack = Math.floor(Number(i?.pack_size || 0));
        return {
          unitPrice: Number(i?.price) || 0,
          qty: pack >= 2 ? Number(i.qty) / pack : Number(i?.qty) || 1,
          hasPromo: p ? p.promo_price != null : false,
          excluded: p?.cash_discount_excluded ?? null,
        };
      }),
      cashPct
    );
    const newTotal = Math.max(0, Math.round((keptTotal - cashDiscount) * 100) / 100);
    perOrder.set(orderId, {
      cashPct, cashDiscount, total: newTotal, items: stored, volumeDiscount: 0,
      manual: keptManual,
    });
    cashDiscountTotal += cashDiscount;
    if (keptManual.amount > 0) manualDiscountTotal += keptManual.amount;
  }

  type ResolvedOne = {
    o: Record<string, any>;
    pricing: ResolvedPricing;
    manualTotal: number;
    cashManual: number;
    items: Record<string, any>[];
    pricedPrep: boolean[];
  };
  const resolvedList: ResolvedOne[] = [];
  for (const o of list) {
    const stored: any[] = Array.isArray(o.items) ? o.items : [];
    const storedTotal = Number(o.total) || 0;
    try {
      const priced: IncomingOrderItem[] = [];
      const pricedPrep: boolean[] = [];
      const passthrough: any[] = [];
      for (const i of stored) {
        if (isUuid(i?.product_id)) {
          priced.push({ offerId: String(i.product_id), variantId: isUuid(i?.variant_id) ? String(i.variant_id) : undefined, qty: Number(i?.qty) || 1, modifiers: i?.modifiers });
          pricedPrep.push((i as any)?.requires_prep !== false);
        } else {
          passthrough.push(i);
        }
      }
      if (priced.length === 0) {
        await legacyCash(o.id, stored, storedTotal);
        continue;
      }
      const pricing = await resolveOrderPricing({
        tx: poolTx,
        vendorId,
        items: priced,
        method: "pickup",
        paymentMethod,
        cashDiscountPct: (gate.vendor as any)?.cash_discount_pct,
      });
      pricing.items.forEach((it, idx) => {
        (it as any).requires_prep = pricedPrep[idx] !== false;
      });
      const manualTotal = round2(
        passthrough.reduce((s, i) => s + (Number(i?.price) || 0) * (Number(i?.qty) || 1), 0)
      );
      const cashManual =
        paymentMethod === "efectivo"
          ? cashDiscountForItems(
              passthrough.map((i: any) => ({ unitPrice: Number(i?.price) || 0, qty: Number(i?.qty) || 1, hasPromo: false, excluded: null })),
              (gate.vendor as any)?.cash_discount_pct
            ).cashDiscount
          : 0;
      const items = [...(pricing.items as unknown as Record<string, any>[]), ...passthrough];
      resolvedList.push({ o, pricing, manualTotal, cashManual, items, pricedPrep });
    } catch (e) {
      if (!(e instanceof PricingError)) throw e;
      await legacyCash(o.id, stored, storedTotal);
    }
  }

  // Descuento manual: el del cierre se prorratea entre las cuentas según su
  // base (un monto fijo no se multiplica por cuenta); si no vino, cada cuenta
  // conserva el suyo recalculado sobre su base final.
  const bases = resolvedList.map((r) => Math.max(0, round2(r.pricing.subtotal - r.pricing.volumeDiscount + r.manualTotal)));
  const totalBase = round2(bases.reduce((s, b) => s + b, 0));
  let remaining = closeManualIn?.kind === "amount" ? round2(closeManualIn.value) : 0;
  resolvedList.forEach((r, idx) => {
    const isLast = idx === resolvedList.length - 1;
    const base = bases[idx];
    const md = closeManualIn ?? storedManual.get(r.o.id) ?? null;
    let mdAmount = 0;
    if (md) {
      if (closeManualIn && md.kind === "amount") {
        mdAmount = isLast
          ? Math.max(0, Math.min(base, remaining))
          : totalBase > 0 ? Math.min(base, round2((closeManualIn.value * base) / totalBase)) : 0;
        remaining = round2(remaining - mdAmount);
      } else if (md.kind === "percent") {
        mdAmount = Math.min(base, round2((base * md.value) / 100));
      } else {
        mdAmount = Math.min(base, round2(md.value));
      }
    }
    const total = Math.max(0, round2(r.pricing.total + r.manualTotal - r.cashManual - mdAmount));
    const cashDiscount = round2(r.pricing.cashDiscount + r.cashManual);
    const manual: ManualApplied = md
      ? { amount: mdAmount, kind: md.kind, reason: md.reason, value: md.value }
      : noManual;
    perOrder.set(r.o.id, { cashPct: r.pricing.cashPct, cashDiscount, total, items: r.items, volumeDiscount: r.pricing.volumeDiscount, manual });
    cashDiscountTotal += cashDiscount;
    volumeDiscountTotal += r.pricing.volumeDiscount;
    manualDiscountTotal += mdAmount;
  });

  // Total a cobrar: suma de las cuentas re-resueltas.
  const total = [...perOrder.values()].reduce((s, d) => s + d.total, 0);
  const now = new Date().toISOString();

  await withTransaction(async (tx) => {
    // Descuento por orden primero (items re-resueltos + cash_pct/cash_discount/
    // volume_discount/manual_discount + total real cobrado), después el cierre:
    // todo en la misma transacción.
    for (const [orderId, d] of perOrder) {
      if (hasVolumeCol && hasManualCol) {
        await tx.query(
          `UPDATE orders SET cash_pct = $1, cash_discount = $2, total = $3, items = $4, volume_discount = $5, manual_discount = $6, manual_discount_kind = $7, manual_discount_reason = $8, manual_discount_value = $9 WHERE id = $10`,
          [d.cashPct, d.cashDiscount, d.total, JSON.stringify(d.items), d.volumeDiscount, d.manual.amount, d.manual.kind, d.manual.reason, d.manual.value, orderId]
        );
      } else if (hasVolumeCol) {
        await tx.query(
          `UPDATE orders SET cash_pct = $1, cash_discount = $2, total = $3, items = $4, volume_discount = $5 WHERE id = $6`,
          [d.cashPct, d.cashDiscount, d.total, JSON.stringify(d.items), d.volumeDiscount, orderId]
        );
      } else {
        await tx.query(
          `UPDATE orders SET cash_pct = $1, cash_discount = $2, total = $3, items = $4 WHERE id = $5`,
          [d.cashPct, d.cashDiscount, d.total, JSON.stringify(d.items), orderId]
        );
      }
    }

    const toUpdate = list.filter((o) => o.status !== "completed");
    if (toUpdate.length > 0) {
      await tx.query(
        `UPDATE orders SET status = 'completed', paid_at = $1, closed_at = $1 WHERE id = ANY($2)`,
        [now, toUpdate.map((o) => o.id)]
      );
    } else {
      // ya estaban completadas: solo registrar el cierre de la mesa
      await tx.query(
        `UPDATE orders SET paid_at = $1 WHERE table_id = $2 AND id = ANY($3)`,
        [now, table.id, list.map((o) => o.id)]
      );
    }

    await tx.query(`UPDATE tables SET status = 'libre' WHERE id = $1`, [table.id]);
  });

  const result = {
    ok: true,
    table: { ...table, status: "libre" },
    total: Math.round(total * 100) / 100,
    cashDiscount: cashDiscountTotal > 0 ? Math.round(cashDiscountTotal * 100) / 100 : 0,
    cashPct: cashPct || 0,
    volumeDiscount: volumeDiscountTotal > 0 ? Math.round(volumeDiscountTotal * 100) / 100 : 0,
    manualDiscount: manualDiscountTotal > 0 ? Math.round(manualDiscountTotal * 100) / 100 : 0,
    ordersClosed: list.length,
    paymentMethod,
  };
  if (clientKey) {
    try {
      await withTransaction(async (tx) =>
        storeSyncResult(tx, gate.vendor.id, clientKey, null, result)
      );
    } catch {
      /* el cierre ya se aplicó: no fallar el request por el log */
    }
  }
  return NextResponse.json(result);
}