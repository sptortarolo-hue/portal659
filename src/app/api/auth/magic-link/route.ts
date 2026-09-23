import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { query } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";
import { withRateLimit } from "@/lib/api-wrapper";

export const POST = withRateLimit(async (request: Request) => {
  const { email } = await request.json();
  if (!email) {
    return NextResponse.json({ error: "Email es requerido" }, { status: 400 });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  await query(
    `UPDATE profiles SET magic_token_hash = $1, magic_token_expires = $2 WHERE lower(email) = lower($3)`,
    [tokenHash, expires, email]
  );

  const siteUrl = getSiteUrl(request);
  const link = `${siteUrl}/auth/callback?token=${token}&type=magic`;

  await sendEmail({
    to: email,
    subject: "Tu acceso a Portal 659",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#4f46e5">Iniciá sesión</h1>
        <p>Hacé clic en el siguiente enlace para entrar a Portal 659:</p>
        <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Entrar</a></p>
        <p style="color:#666;font-size:14px">El enlace expira en 30 minutos.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">Portal 659 — El centro comercial de tu barrio</p>
      </div>
    `,
  });

  return NextResponse.json({ ok: true });
}, { maxRequests: 10 });