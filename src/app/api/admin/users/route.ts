import { isAdmin } from "@/lib/admin-utils";
import { hashPassword } from "@/lib/auth";
import { queryMany, queryOne, query, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const perPage = Math.max(1, parseInt(url.searchParams.get("per_page") || "50"));
  const search = url.searchParams.get("search") || "";

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(p.email ILIKE $${params.length} OR p.full_name ILIKE $${params.length} OR p.whatsapp ILIKE $${params.length})`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await queryOne<{ c: number }>(
    `SELECT count(*)::int AS c FROM profiles p ${whereClause}`,
    params
  );

  params.push(perPage, (page - 1) * perPage);
  const rows = await queryMany<Record<string, unknown>>(
    `SELECT p.id, p.email, p.full_name, p.whatsapp, p.role,
            p.email_confirmed, p.created_at,
            v.store_name, v.vertical, v.is_admin
     FROM profiles p
     LEFT JOIN vendors v ON v.user_id = p.id
     ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const users = rows.map((r) => {
    const fullName = (r.full_name as string) || "";
    const parts = fullName.split(" ").filter(Boolean);
    return {
      id: r.id,
      email: r.email,
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" "),
      full_name: fullName || r.email,
      whatsapp: r.whatsapp || "",
      role: r.role || "vendor",
      vertical: r.vertical || "",
      email_confirmed: !!r.email_confirmed,
      created_at: r.created_at,
    };
  });

  return NextResponse.json({
    users,
    total: countRow?.c || users.length,
    page,
    perPage,
  });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { email, password, firstName, lastName, whatsapp, role, vertical } = await request.json();

  if (!email || !password || !firstName || !lastName) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const fullName = `${firstName} ${lastName}`;

  const user = await withTransaction(async (tx) => {
    const created = await tx.queryOne<{ id: string; email: string }>(
      `INSERT INTO profiles (email, password_hash, full_name, whatsapp, role, email_confirmed)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email`,
      [email, passwordHash, fullName, whatsapp || "", role || "vendor"]
    );
    if (!created) throw new Error("No se pudo crear el usuario");

    await tx.queryVoid(
      `INSERT INTO vendors (user_id, store_name, vertical, verified, is_admin)
       VALUES ($1, $2, $3, true, false)`,
      [created.id, firstName, vertical || "gastronomia"]
    );
    return created;
  });

  return NextResponse.json({ ok: true, user: { id: user.id, email: user.email } });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { userId, firstName, lastName, whatsapp, role, vertical } = await request.json();

  if (!userId) {
    return NextResponse.json({ error: "userId requerido" }, { status: 400 });
  }

  const profileUpdates: Record<string, unknown> = {};
  if (firstName !== undefined || lastName !== undefined) {
    profileUpdates.full_name = `${firstName || ""} ${lastName || ""}`.trim();
  }
  if (whatsapp !== undefined) profileUpdates.whatsapp = whatsapp;
  if (role !== undefined) profileUpdates.role = role;

  await withTransaction(async (tx) => {
    if (Object.keys(profileUpdates).length > 0) {
      const setClauses = Object.keys(profileUpdates)
        .map((k, i) => `${k} = $${i + 2}`)
        .join(", ");
      await tx.queryVoid(
        `UPDATE profiles SET ${setClauses} WHERE id = $1`,
        [userId, ...Object.values(profileUpdates)]
      );
    }
    if (vertical !== undefined) {
      await tx.queryVoid(
        `UPDATE vendors SET vertical = $2 WHERE user_id = $1`,
        [userId, vertical]
      );
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { userId } = await request.json();

  if (!userId) {
    return NextResponse.json({ error: "userId requerido" }, { status: 400 });
  }

  await withTransaction(async (tx) => {
    await tx.queryVoid(`DELETE FROM vendors WHERE user_id = $1`, [userId]);
    await tx.queryVoid(`DELETE FROM profiles WHERE id = $1`, [userId]);
  });

  return NextResponse.json({ ok: true });
}