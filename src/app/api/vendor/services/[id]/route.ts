import { gateRequest } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/** Editar / activar / borrar un servicio del centro de estética. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const vendor = gate.vendor;
  if (vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const sets: string[] = [];
  const vals: unknown[] = [vendor.id, id];
  let idx = 3;
  if (body.name !== undefined) {
    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
    sets.push(`name = $${idx++}`);
    vals.push(name);
  }
  if (body.description !== undefined) {
    sets.push(`description = $${idx++}`);
    vals.push(String(body.description || "").trim().slice(0, 500) || null);
  }
  if (body.duration_min !== undefined) {
    const n = Math.min(480, Math.max(15, Math.floor(Number(body.duration_min) || 60)));
    sets.push(`duration_min = $${idx++}`);
    vals.push(n);
  }
  if (body.buffer_min !== undefined) {
    const n = Math.min(120, Math.max(0, Math.floor(Number(body.buffer_min) || 0)));
    sets.push(`buffer_min = $${idx++}`);
    vals.push(n);
  }
  if (body.deposit_amount !== undefined) {
    const raw = body.deposit_amount;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      return NextResponse.json({ error: "La seña debe ser un monto válido" }, { status: 400 });
    }
    sets.push(`deposit_amount = $${idx++}`);
    vals.push(n);
  }
  if (body.price !== undefined) {
    const raw = body.price;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      return NextResponse.json({ error: "El precio debe ser un monto válido" }, { status: 400 });
    }
    sets.push(`price = $${idx++}`);
    vals.push(n);
  }
  // Precio "desde" (banda opcional "Desde X – Hasta Y"). Mutuamente
  // excluyente con el fijo: si se setea "desde", `price` queda NULL.
  let priceFromVal: number | null | undefined;
  let priceToVal: number | null | undefined;
  if (body.price_from !== undefined) {
    const raw = body.price_from;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      return NextResponse.json({ error: "El precio 'desde' debe ser un monto válido" }, { status: 400 });
    }
    priceFromVal = n;
  }
  if (body.price_to !== undefined) {
    const raw = body.price_to;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && !Number.isFinite(n)) {
      return NextResponse.json({ error: "El precio 'hasta' debe ser un monto válido" }, { status: 400 });
    }
    priceToVal = n;
  }
  if (priceFromVal !== undefined || priceToVal !== undefined) {
    // Sin las columnas (migración sin aplicar) no se puede persistir "desde".
    // Si el panel pide un valor real, avisar con la migración correcta; si
    // sólo limpia, la edición sigue sin tocar esas columnas.
    const hasFromCols = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'services' AND column_name = 'price_from'
       ) AS exists`
    );
    if (hasFromCols?.exists !== true) {
      if (priceFromVal != null || priceToVal != null) {
        return NextResponse.json(
          { error: "Falta aplicar la migración migrate-service-price-from.sql en la base" },
          { status: 503 }
        );
      }
    } else {
      let baseFrom = priceFromVal;
      if (baseFrom === undefined) {
        const cur = await queryOne<{ price_from: number | null }>(
          `SELECT price_from FROM services WHERE vendor_id = $1 AND id = $2 LIMIT 1`,
          [vendor.id, id]
        ).catch(() => null);
        baseFrom = cur?.price_from != null ? Number(cur.price_from) : null;
      }
      if (priceToVal != null && (baseFrom == null || priceToVal <= baseFrom)) {
        return NextResponse.json(
          { error: baseFrom == null ? "Para la banda cargá primero el 'desde'" : "El precio 'hasta' debe ser mayor que el 'desde'" },
          { status: 400 }
        );
      }
      if (priceFromVal !== undefined) {
        sets.push(`price_from = $${idx++}`);
        vals.push(priceFromVal);
        if (priceFromVal !== null) {
          // El fijo y el "desde" son excluyentes.
          sets.push(`price = NULL`);
          if (priceToVal === undefined) sets.push(`price_to = NULL`);
        } else {
          // Sin "desde": limpia también la banda.
          sets.push(`price_to = NULL`);
        }
      }
      if (priceToVal !== undefined && priceFromVal === undefined) {
        sets.push(`price_to = $${idx++}`);
        vals.push(priceToVal);
      }
    }
  }
  if (body.commission_pct !== undefined) {
    const raw = body.commission_pct;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
      return NextResponse.json({ error: "La comisión debe estar entre 0 y 100" }, { status: 400 });
    }
    sets.push(`commission_pct = $${idx++}`);
    vals.push(n);
  }
  if (body.active !== undefined) {
    sets.push(`active = $${idx++}`);
    vals.push(body.active !== false);
  }
  if (body.require_deposit !== undefined) {
    if (body.require_deposit === true) {
      // Exigir seña requiere monto: el que viene o el ya guardado.
      let amount: number | null = null;
      if (body.deposit_amount !== undefined) {
        const raw = body.deposit_amount;
        amount = raw == null || raw === "" ? null : Number(raw);
      } else {
        const cur = await queryOne<{ deposit_amount: number | null }>(
          `SELECT deposit_amount FROM services WHERE vendor_id = $1 AND id = $2 LIMIT 1`,
          [vendor.id, id]
        ).catch(() => null);
        amount = cur?.deposit_amount != null ? Number(cur.deposit_amount) : null;
      }
      if (!(amount != null && amount > 0)) {
        return NextResponse.json({ error: "Para exigir seña poné primero el monto" }, { status: 400 });
      }
    }
    sets.push(`require_deposit = $${idx++}`);
    vals.push(body.require_deposit === true);
  }
  if (body.deposit_hours !== undefined) {
    const n = body.deposit_hours == null || body.deposit_hours === "" ? 24 : Math.round(Number(body.deposit_hours));
    if (!Number.isFinite(n) || n < 1 || n > 168) {
      return NextResponse.json({ error: "Las horas para pagar deben estar entre 1 y 168" }, { status: 400 });
    }
    sets.push(`deposit_hours = $${idx++}`);
    vals.push(n);
  }
  if (body.image_url !== undefined) {
    const raw = typeof body.image_url === "string" ? body.image_url.trim().slice(0, 500) : "";
    const url = raw && (raw.startsWith("/uploads/") || raw.includes("/uploads/")) ? raw : null;
    sets.push(`image_url = $${idx++}`);
    vals.push(url);
  }
  if (body.category !== undefined) {
    const raw = typeof body.category === "string" ? body.category.trim().slice(0, 60) : "";
    sets.push(`category = $${idx++}`);
    vals.push(raw || null);
  }
  if (body.location_id !== undefined) {
    const raw = typeof body.location_id === "string" && body.location_id ? body.location_id : null;
    if (raw) {
      try {
        const loc = await queryOne<{ id: string }>(
          `SELECT id FROM estetica_locations WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [raw, vendor.id]
        );
        if (!loc) return NextResponse.json({ error: "Sede no encontrada" }, { status: 404 });
      } catch {
        return NextResponse.json(
          { error: "Falta aplicar la migración migrate-estetica-locations.sql en la base" },
          { status: 503 }
        );
      }
    }
    sets.push(`location_id = $${idx++}`);
    vals.push(raw);
  }
  if (sets.length === 0) return NextResponse.json({ error: "Sin cambios" }, { status: 400 });

  try {
    const row = await queryOne<Record<string, unknown>>(
      `UPDATE services SET ${sets.join(", ")} WHERE vendor_id = $1 AND id = $2 RETURNING *`,
      vals
    );
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ service: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar una migración en la base: migrate-estetica.sql, o alguna de migrate-estetica-commissions.sql (precio/comisión), migrate-estetica-require-deposit.sql (seña obligatoria), migrate-estetica-service-photo.sql (foto), migrate-estetica-service-menu.sql (categoría) o migrate-service-price-from.sql (precio 'desde')" },
      { status: 503 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const vendor = gate.vendor;
  if (vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  try {
    // Los turnos viejos quedan con service_id en null (SET NULL).
    await queryOne(`DELETE FROM services WHERE vendor_id = $1 AND id = $2`, [vendor.id, id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
