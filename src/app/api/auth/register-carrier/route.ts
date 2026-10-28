import { NextResponse } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import { hashPassword, signAccessToken } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { toE164Plus, checkArgPhone, phoneVariantsAR } from "@/lib/phone";

/**
 * Registro de logística partner (autoservicio con aprobación del admin).
 *
 * Crea en una transacción: `profiles` (role `carrier`) + `carriers`
 * (`active=false`, `self_registered=true`) + `carrier_operators`
 * (`active=false`). Sesión inmediata para que vea el estado "en revisión";
 * el panel operario queda en pausa hasta que el admin lo active en
 * /admin/logisticas (fetchOperatorCarriers exige carriers.active).
 *
 * Es el patrón más usado en marketplaces B2B (tipo Moova: alta propia,
 * validación del equipo antes de operar).
 */
export const POST = withRateLimit(async (request: Request) => {
  const {
    email,
    password,
    name,
    whatsapp,
    kind,
    businessName,
    coverage,
    vehicle,
  } = await request.json().catch(() => ({}));

  if (!email || !password || !name || !whatsapp) {
    return NextResponse.json(
      { error: "Completá nombre, email, WhatsApp y contraseña" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
  }
  const emailLower = String(email).toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }
  const phoneCheck = checkArgPhone(String(whatsapp || ""));
  if (!phoneCheck.ok) {
    return NextResponse.json(
      { error: "Ingresá un WhatsApp válido (celular argentino)" },
      { status: 400 }
    );
  }
  const phoneE164 = toE164Plus(whatsapp);
  // "individuo" | "flota" (cómo opera la logística).
  const kindNorm = String(kind ?? "").trim() === "flota" ? "flota" : "individuo";
  const business =
    typeof businessName === "string" && businessName.trim() ? businessName.trim().slice(0, 120) : null;
  const coverageText =
    typeof coverage === "string" && coverage.trim() ? coverage.trim().slice(0, 300) : null;
  const vehicleText =
    typeof vehicle === "string" && vehicle.trim() ? vehicle.trim().slice(0, 60) : null;

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE lower(email) = lower($1) LIMIT 1`,
    [emailLower]
  );
  if (existing) {
    return NextResponse.json({ error: "El email ya está registrado" }, { status: 409 });
  }
  const phoneVariants = phoneVariantsAR(whatsapp);
  const existingPhone = await queryOne<{ id: string }>(
    `SELECT id FROM profiles
     WHERE regexp_replace(whatsapp, '[^0-9]', '', 'g') = ANY($1)
        OR regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1)
     LIMIT 1`,
    [phoneVariants]
  );
  if (existingPhone) {
    return NextResponse.json({ error: "Ese WhatsApp ya está registrado" }, { status: 409 });
  }

  // ¿Migración aplicada? (columnas de autoregistro en carriers)
  try {
    await queryOne(`SELECT self_registered FROM carriers LIMIT 1`);
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-shipment-carrier-fee.sql en la base" },
      { status: 503 }
    );
  }

  const passwordHash = await hashPassword(password);
  const fullName = String(name).trim().slice(0, 120);
  const carrierName = business || fullName;
  const notes = [
    kindNorm === "flota" ? "Flota" : "Individual",
    coverageText ? `Cobertura: ${coverageText}` : null,
    vehicleText ? `Vehículo: ${vehicleText}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  try {
    const result = await withTransaction(async (tx) => {
      const profile = await tx.queryOne<{
        id: string;
        email: string;
        full_name: string | null;
        role: string;
        token_version: number;
      }>(
        `INSERT INTO profiles (email, password_hash, full_name, phone, whatsapp, role, email_confirmed, verified)
         VALUES ($1, $2, $3, $4, $4, 'carrier', true, true)
         RETURNING id, email, full_name, role, token_version`,
        [emailLower, passwordHash, fullName, phoneE164]
      );
      if (!profile) throw new Error("No se pudo crear la cuenta");
      const carrier = await tx.queryOne<{ id: string }>(
        `INSERT INTO carriers (name, phone, email, contact_name, coverage, vehicle, notes, active, self_registered)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, true)
         RETURNING id`,
        [
          carrierName.slice(0, 120),
          phoneE164,
          emailLower,
          fullName,
          coverageText,
          vehicleText,
          notes.slice(0, 500) || null,
        ]
      );
      if (!carrier) throw new Error("No se pudo crear la logística");
      // Operador dueño de la logística (inactivo hasta la aprobación).
      await tx.queryVoid(
        `INSERT INTO carrier_operators (carrier_id, profile_id, display_name, active)
         VALUES ($1, $2, $3, false)`,
        [carrier.id, profile.id, fullName]
      );
      return profile;
    });

    const accessToken = await signAccessToken({
      id: result.id,
      email: result.email,
      role: result.role,
      tokenVersion: result.token_version,
    });

    const response = NextResponse.json({
      ok: true,
      pending: true,
      user: { id: result.id, email: result.email, name: result.full_name || result.email, role: result.role },
    });

    const isLocal = process.env.NODE_ENV === "development";
    const cookieOpts = {
      httpOnly: true,
      secure: !isLocal,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      ...(!isLocal && { domain: ".portal659.com.ar" }),
    };
    response.cookies.set("sb-access-token", accessToken, cookieOpts);
    response.cookies.set("sb-refresh-token", accessToken, cookieOpts);

    return response;
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo registrar la logística: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }
}, { maxRequests: 10 });
