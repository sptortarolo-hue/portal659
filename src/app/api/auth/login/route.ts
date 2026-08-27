import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyPassword, signAccessToken } from "@/lib/auth";

export async function POST(request: Request) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email y contraseña son requeridos" },
      { status: 400 }
    );
  }

  const user = await queryOne<{
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    password_hash: string;
  }>(
    `SELECT id, email, full_name, role, password_hash FROM profiles WHERE lower(email) = lower($1)`,
    [email]
  );

  if (!user || !user.password_hash) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const accessToken = await signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.json({
    ok: true,
    session: { access_token: accessToken, refresh_token: accessToken },
    user: {
      id: user.id,
      email: user.email,
      name: user.full_name || user.email,
    },
  });

  const isLocal = process.env.NODE_ENV === "development";
  const cookieOpts = {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
  response.cookies.set("sb-access-token", accessToken, cookieOpts);
  response.cookies.set("sb-refresh-token", accessToken, cookieOpts);

  return response;
}