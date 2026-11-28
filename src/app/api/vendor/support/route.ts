import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chat de soporte liviano (v1, sin tabla nueva): el mensaje llega por mail a
 * soporte@portal659.com.ar con el contexto del comercio / admin.
 *
 * Ruta NUEVA. Si no existe o falla el mail, el panel sigue igual y la UI
 * muestra el fallback de WhatsApp / mail.
 */

const SUPPORT_TO = process.env.SUPPORT_EMAIL || "soporte@portal659.com.ar";
const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LIMIT_MAX = 5;
const hits = new Map<string, number[]>();

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(request: Request) {
  let who: { email: string; name: string; area: string; vendorName?: string } | null = null;

  const user = await getAuthUser(request).catch(() => null);
  if (user) {
    who = {
      email: user.email,
      name: user.full_name || user.email,
      area: user.is_admin ? "admin" : "vendor",
    };
  } else {
    try {
      const { vendor } = await getVendorByRequest(request);
      if (vendor) {
        who = {
          email: String((vendor as any).contact_email || ""),
          name: String((vendor as any).store_name || "Comercio"),
          area: "vendor",
          vendorName: String((vendor as any).store_name || ""),
        };
      }
    } catch {
      /* sin sesión: 401 abajo */
    }
  }

  if (!who) {
    return NextResponse.json({ ok: false, error: "Ingresá para escribir a soporte" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const subject = String(body.subject || "Consulta desde el panel").trim().slice(0, 120);
  const message = String(body.message || "").trim();
  if (message.length < 10 || message.length > 2000) {
    return NextResponse.json(
      { ok: false, error: "Escribí entre 10 y 2000 caracteres" },
      { status: 400 }
    );
  }

  const key = who.email || who.name;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < LIMIT_WINDOW_MS);
  if (recent.length >= LIMIT_MAX) {
    return NextResponse.json(
      { ok: false, error: "Demasiados mensajes. Esperá unos minutos o escribinos por WhatsApp." },
      { status: 429 }
    );
  }
  recent.push(now);
  hits.set(key, recent);

  const emailed = await sendEmail({
    to: SUPPORT_TO,
    subject: `[Portal 659][${who.area}] ${subject}`,
    html: [
      `<p><strong>De:</strong> ${escapeHtml(who.name)} &lt;${escapeHtml(who.email || "sin email")}&gt;</p>`,
      who.vendorName ? `<p><strong>Comercio:</strong> ${escapeHtml(who.vendorName)}</p>` : "",
      `<p><strong>Asunto:</strong> ${escapeHtml(subject)}</p>`,
      `<p><strong>Mensaje:</strong></p><p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`,
      `<hr/><p style="color:#888;font-size:12px">Enviado desde el panel · ${new Date().toISOString()}</p>`,
    ].join(""),
  });

  return NextResponse.json({
    ok: true,
    emailed,
    fallback: emailed ? null : "https://wa.me/549112010898",
  });
}
