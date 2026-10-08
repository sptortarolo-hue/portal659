import { NextResponse } from "next/server";
import { query, queryMany, queryOne, withTransaction } from "@/lib/db";
import { getAuthUser, hashPassword } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { canManageConfig, canManageUsers } from "@/lib/staff-gate";
import { generateLinkCode } from "@/lib/link-code";
import { toE164, phoneMatchCandidates } from "@/lib/phone";

type StaffRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  status: string;
  phone: string | null;
  invite_code: string | null;
  created_at: string;
  /** Perfil vinculado (null = aún no aceptó la invitación). */
  profile_id: string | null;
  /** Usuarios del local (role='staff'; null en repartidores). */
  username: string | null;
  display_name: string | null;
  staff_level: string | null;
};

const USERNAME_RE = /^[a-z0-9._-]{3,20}$/;
const STAFF_LEVELS = ["admin", "empleado"] as const;

function missingMigration(e: unknown): boolean {
  const msg = String((e as Error)?.message || "");
  return msg.includes("username") || msg.includes("staff_level") || msg.includes("display_name");
}

function syntheticEmail(vendorId: string, username: string): string {
  const short = String(vendorId).replace(/-/g, "").slice(0, 8);
  return `equipo_${short}__${username}@staff.portal659.local`;
}

// Lista el equipo del comercio: repartidores + usuarios del local.
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const resolved = await getVendorByRequest(request);
  const { vendor } = resolved;
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  let staff: StaffRow[] = [];
  try {
    staff = await queryMany<StaffRow>(
      `SELECT vs.id, p.full_name, p.email, vs.role, vs.status, vs.phone, vs.invite_code, vs.created_at,
              vs.profile_id, vs.username, vs.display_name, vs.staff_level
       FROM vendor_staff vs
       LEFT JOIN profiles p ON p.id = vs.profile_id
       WHERE vs.vendor_id = $1
       ORDER BY vs.created_at ASC`,
      [vendor.id]
    );
  } catch {
    // Migración de usuarios sin aplicar: lista legacy (repartidores).
    const legacy = await queryMany<Omit<StaffRow, "username" | "display_name" | "staff_level">>(
      `SELECT vs.id, p.full_name, p.email, vs.role, vs.status, vs.phone, vs.invite_code, vs.created_at,
              vs.profile_id
       FROM vendor_staff vs
       LEFT JOIN profiles p ON p.id = vs.profile_id
       WHERE vs.vendor_id = $1
       ORDER BY vs.created_at ASC`,
      [vendor.id]
    );
    staff = (legacy || []).map((r) => ({ ...r, username: null, display_name: null, staff_level: null }));
  }

  // El email sintético de los usuarios del local nunca sale a la UI.
  const clean = (staff || []).map((s) => (s.role === "staff" ? { ...s, email: null } : s));

  return NextResponse.json({
    staff: clean,
    usersSupported: true,
    canManageUsers: canManageUsers({
      staffRole: resolved.staffRole,
      staffLevel: resolved.staffLevel,
      previewSession: resolved.previewSession,
    }),
  });
}

// POST repartidores: { action: "add" } / { action: "regenerate", id }.
// POST usuarios: { action: "add_user", name, username, level, password }
//   { action: "set_password", id, password } / { action: "set_level", id, level }
//   { action: "set_name", id, name }.
export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const resolved = await getVendorByRequest(request);
  const { vendor } = resolved;
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const role = { staffRole: resolved.staffRole, staffLevel: resolved.staffLevel, previewSession: resolved.previewSession };

  const body = await request.json().catch(() => ({}));
  const action = body.action ?? "add";

  // ---- Usuarios del local: SOLO el dueño (ni el Encargado). ----
  if (action === "add_user" || action === "set_password" || action === "set_level" || action === "set_name") {
    if (!canManageUsers(role)) {
      return NextResponse.json({ error: "Solo el dueño puede gestionar usuarios" }, { status: 403 });
    }
    try {
      if (action === "add_user") {
        const name = String(body.name ?? "").trim().slice(0, 40);
        const username = String(body.username ?? "").trim().toLowerCase();
        const level = String(body.level ?? "empleado");
        const password = String(body.password ?? "");
        if (name.length < 2) return NextResponse.json({ error: "Ingresá el nombre de la persona" }, { status: 400 });
        if (!USERNAME_RE.test(username)) {
          return NextResponse.json({ error: "Usuario inválido: 3 a 20 caracteres (letras, números, . _ -)" }, { status: 400 });
        }
        if (!STAFF_LEVELS.includes(level as (typeof STAFF_LEVELS)[number])) {
          return NextResponse.json({ error: "Nivel inválido" }, { status: 400 });
        }
        if (password.length < 6 || password.length > 72) {
          return NextResponse.json({ error: "La contraseña debe tener entre 6 y 72 caracteres" }, { status: 400 });
        }

        const password_hash = await hashPassword(password);
        const out = await withTransaction(async (tx) => {
          // ¿Re-contratación? Si el usuario existe revocado, se reactiva.
          const prev = await tx.queryOne<{ id: string; profile_id: string | null; status: string }>(
            `SELECT id, profile_id, status FROM vendor_staff WHERE vendor_id = $1 AND lower(username) = $2 LIMIT 1`,
            [vendor.id, username]
          );
          if (prev && prev.status !== "revoked") {
            throw Object.assign(new Error("Ese usuario ya existe en tu local"), { status: 409 });
          }
          if (prev && prev.profile_id) {
            await tx.queryVoid(
              `UPDATE profiles SET password_hash = $1, full_name = $2, token_version = token_version + 1 WHERE id = $3`,
              [password_hash, name, prev.profile_id]
            );
            const row = await tx.queryOne(
              `UPDATE vendor_staff SET display_name = $1, staff_level = $2, status = 'active' WHERE id = $3 RETURNING id, username, display_name, staff_level, status`,
              [name, level, prev.id]
            );
            return { reactivated: true, row };
          }
          const profile = await tx.queryOne<{ id: string }>(
            `INSERT INTO profiles (email, password_hash, full_name, role, email_confirmed, verified)
             VALUES ($1, $2, $3, 'vendor', true, true) RETURNING id`,
            [syntheticEmail(vendor.id, username), password_hash, name]
          );
          const profileId = profile?.id;
          if (!profileId) throw new Error("No se pudo crear el perfil");
          await tx.queryVoid(
            `INSERT INTO vendor_staff (vendor_id, profile_id, role, staff_level, username, display_name, status)
             VALUES ($1, $2, 'staff', $3, $4, $5, 'active')`,
            [vendor.id, profileId, level, username, name]
          );
          return { reactivated: false, row: { username, display_name: name, staff_level: level, status: "active" } };
        });
        return NextResponse.json({ ok: true, user: out.row, reactivated: (out as { reactivated?: boolean }).reactivated === true });
      }

      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
      const target = await queryOne<{ id: string; profile_id: string | null; role: string }>(
        `SELECT id, profile_id, role FROM vendor_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [id, vendor.id]
      );
      if (!target || target.role !== "staff" || !target.profile_id) {
        return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
      }

      if (action === "set_password") {
        const password = String(body.password ?? "");
        if (password.length < 6 || password.length > 72) {
          return NextResponse.json({ error: "La contraseña debe tener entre 6 y 72 caracteres" }, { status: 400 });
        }
        await query(
          `UPDATE profiles SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
          [await hashPassword(password), target.profile_id]
        );
        return NextResponse.json({ ok: true });
      }

      if (action === "set_level") {
        const level = String(body.level ?? "");
        if (!STAFF_LEVELS.includes(level as (typeof STAFF_LEVELS)[number])) {
          return NextResponse.json({ error: "Nivel inválido" }, { status: 400 });
        }
        await query(`UPDATE vendor_staff SET staff_level = $1 WHERE id = $2`, [level, id]);
        return NextResponse.json({ ok: true });
      }

      // set_name
      const name = String(body.name ?? "").trim().slice(0, 40);
      if (name.length < 2) return NextResponse.json({ error: "Ingresá el nombre" }, { status: 400 });
      await query(`UPDATE vendor_staff SET display_name = $1 WHERE id = $2`, [name, id]);
      await query(`UPDATE profiles SET full_name = $1 WHERE id = $2`, [name, target.profile_id]);
      return NextResponse.json({ ok: true });
    } catch (e) {
      if (missingMigration(e)) {
        return NextResponse.json(
          { error: "Falta aplicar la migración migrate-vendor-users.sql en la base de datos", code: "migration_missing" },
          { status: 503 }
        );
      }
      const status = (e as { status?: number }).status || 500;
      return NextResponse.json({ error: (e as Error).message || "No se pudo guardar" }, { status });
    }
  }

  // ---- Repartidores (flujo existente): dueño + Encargado. ----
  if (!canManageConfig(role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  if (action === "add") {
    // E.164 (sin 0 ni 15): es lo que necesita el link wa.me de invitación y
    // lo que espera /vincular. toE164 también acepta el formato viejo con
    // 0/15 y lo convierte, así que nada se rompe si lo escriben así.
    const phone = toE164(String(body.phone ?? ""));
    const name = String(body.name ?? "").trim();
    if (!phone) {
      return NextResponse.json(
        { error: "Ingresá un celular válido sin 0 ni 15 (ej: 221 555 1234)" },
        { status: 400 }
      );
    }

    // Evitar duplicar repartidores activos/pendientes con el mismo teléfono
    // (matchea cualquier formato guardado: E.164 nuevo o dígitos legacy).
    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM vendor_staff
       WHERE vendor_id = $1 AND phone = ANY($2) AND status <> 'revoked' LIMIT 1`,
      [vendor.id, phoneMatchCandidates(phone)]
    );
    if (dup) {
      return NextResponse.json({ error: "Ese teléfono ya tiene un repartidor activo/pendiente" }, { status: 409 });
    }

    const code = generateLinkCode();
    const row = await queryOne<{ id: string; invite_code: string; phone: string }>(
      `INSERT INTO vendor_staff (vendor_id, role, invite_code, phone, status)
       VALUES ($1, 'delivery', $2, $3, 'pending')
       RETURNING id, invite_code, phone`,
      [vendor.id, code, phone]
    );

    // Perfil opcional: nombre para mostrarlo mientras no se vincule.
    // (el profile real se crea cuando el repartidor elige contraseña)
    return NextResponse.json({ ok: true, staff: { id: row?.id, invite_code: row?.invite_code, phone: row?.phone, status: "pending" }, name });
  }

  if (action === "regenerate") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const code = generateLinkCode();
    await query(
      `UPDATE vendor_staff SET invite_code = $1, status = 'pending' WHERE id = $2 AND vendor_id = $3`,
      [code, id, vendor.id]
    );
    return NextResponse.json({ ok: true, id, inviteCode: code });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}

// DELETE ?id= → revoca (pierde acceso + se matan sus sesiones).
export async function DELETE(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const resolved = await getVendorByRequest(request);
  const { vendor } = resolved;
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const url = new URL(request.url);
  const staffId = url.searchParams.get("id") ?? "";
  if (!staffId) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  const target = await queryOne<{ role: string; profile_id: string | null }>(
    `SELECT role, profile_id FROM vendor_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [staffId, vendor.id]
  );
  if (!target) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const role = { staffRole: resolved.staffRole, staffLevel: resolved.staffLevel, previewSession: resolved.previewSession };
  // Usuarios del local: solo el dueño. Repartidores: dueño + Encargado.
  const allowed = target.role === "staff" ? canManageUsers(role) : canManageConfig(role);
  if (!allowed) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  await query(`UPDATE vendor_staff SET status = 'revoked', invite_code = NULL WHERE id = $1 AND vendor_id = $2`, [staffId, vendor.id]);
  if (target.profile_id) {
    await query(`UPDATE profiles SET token_version = token_version + 1 WHERE id = $1`, [target.profile_id]);
  }
  return NextResponse.json({ ok: true });
}
