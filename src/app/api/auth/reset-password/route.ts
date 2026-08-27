import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { queryOne, query } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const { token, password } = await request.json();

  if (!token || !password) {
    return NextResponse.json({ error: "token y password son requeridos" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const profile = await queryOne<{ id: string }>(
    `SELECT id FROM profiles WHERE reset_token_hash = $1 AND reset_token_expires > now() LIMIT 1`,
    [tokenHash]
  );
  if (!profile) {
    return NextResponse.json({ error: "El link de recuperación es inválido o expiró." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  await query(
    `UPDATE profiles SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2`,
    [passwordHash, profile.id]
  );

  return NextResponse.json({ ok: true });
}