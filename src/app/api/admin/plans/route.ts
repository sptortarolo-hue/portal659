import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, query } from "@/lib/db";
import type { Plan } from "@/types/database";

export const dynamic = "force-dynamic";

const ALLOWED = [
  "name",
  "description",
  "price_monthly",
  "max_products",
  "badge",
  "popular",
  "sort",
  "promo_price",
  "promo_months",
  "promo_ends_at",
  "promo_label",
];

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`);
  return NextResponse.json({ plans });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { id, data } = body;
  if (!id || !data || typeof data !== "object") {
    return NextResponse.json({ error: "id y data son requeridos" }, { status: 400 });
  }

  const clean: Record<string, unknown> = {};

  for (const k of Object.keys(data)) {
    if (!ALLOWED.includes(k)) continue;
    let v = data[k];

    if (v === "" || v === null || v === undefined) {
      if (["promo_price", "promo_months", "promo_ends_at", "promo_label"].includes(k)) {
        clean[k] = null;
      } else if (["description", "badge"].includes(k)) {
        clean[k] = null;
      }
      continue;
    }

    if (["price_monthly", "promo_price"].includes(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      clean[k] = n;
    } else if (["max_products", "promo_months", "sort"].includes(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) continue;
      clean[k] = n;
    } else if (k === "popular") {
      clean[k] = Boolean(v);
    } else if (k === "promo_ends_at") {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) continue;
      clean[k] = d.toISOString();
    } else {
      clean[k] = String(v);
    }
  }

  const cols = Object.keys(clean);
  if (cols.length === 0) return NextResponse.json({ ok: true });

  const plans = await queryMany<Plan>(`SELECT * FROM plans WHERE id = $1`, [id]);
  const plan = plans?.[0];
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  const priceMonthly = Number(clean.price_monthly ?? plan.price_monthly ?? 0);
  const promoPrice = Number(clean.promo_price ?? plan.promo_price ?? 0);
  const promoMonths = Math.floor(Number(clean.promo_months ?? plan.promo_months ?? 0));

  if (promoPrice > 0 && promoPrice >= priceMonthly) {
    return NextResponse.json(
      { error: "El precio promocional debe ser menor al precio mensual" },
      { status: 400 }
    );
  }
  if (promoPrice > 0 && promoMonths <= 0) {
    return NextResponse.json(
      { error: "Indicá la cantidad de meses de la promoción" },
      { status: 400 }
    );
  }

  const setClauses = cols.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await query(
    `UPDATE plans SET ${setClauses} WHERE id = $1`,
    [id, ...Object.values(clean)]
  );

  return NextResponse.json({ ok: true });
}
