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
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 h

  await query(
    `UPDATE profiles SET reset_token_hash = $1, reset_token_expires = $2 WHERE lower(email) = lower($3)`,
    [tokenHash, expires, email]
  );

  const siteUrl = getSiteUrl(request);

  await sendEmail({
    to: email,
    subject: "Recuperá tu contraseña",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#4f46e5">Recuperación de contraseña</h1>
        <p>Recibimos un pedido para restablecer tu contraseña.</p>
        <p><a href="${siteUrl}/reset-password?token=${token}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Restablecer contraseña</a></p>
        <p style="color:#666;font-size:14px">El enlace expira en 1 hora. Si no lo pediste vos, ignorá este correo.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">Portal 659 — El centro comercial de tu barrio</p>
      </div>
    `,
  });

  return NextResponse.json({ ok: true });
}, { maxRequests: 10 });