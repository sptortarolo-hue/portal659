import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { query } from "@/lib/db";
import { sendEmail, confirmEmailEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";

export async function POST(request: Request) {
  const { email } = await request.json();
  if (!email) {
    return NextResponse.json({ error: "Email es requerido" }, { status: 400 });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48 h

  await query(
    `UPDATE profiles SET confirm_token_hash = $1, confirm_token_expires = $2 WHERE lower(email) = lower($3) AND email_confirmed = false`,
    [tokenHash, expires, email]
  );

  // El mail solo se envía si la cuenta sigue sin confirmar; devolvemos ok
  // siempre para no revelar si el email existe o ya está confirmado.
  const siteUrl = getSiteUrl(request);
  const confirmUrl = `${siteUrl}/auth/callback?token=${token}&type=signup`;
  const { subject, html } = confirmEmailEmail(confirmUrl);
  await sendEmail({ to: email, subject, html });

  return NextResponse.json({ ok: true });
}
