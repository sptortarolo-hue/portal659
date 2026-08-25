// Email transaccional con Resend
// Requiere: RESEND_API_KEY en .env.local
// Docs: https://resend.com/docs/introduction

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "Portal 659 <noreply@portal659.com>";

type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log("[Email] RESEND_API_KEY no configurado, email no enviado:", subject);
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });

    return res.ok;
  } catch {
    console.log("[Email] Error al enviar email");
    return false;
  }
}

export function orderConfirmationEmail(vendorName: string, items: any[], total: number): { subject: string; html: string } {
  const itemRows = items
    .map((i) => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.qty}x ${i.name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${(i.price * i.qty).toLocaleString("es-AR")}</td></tr>`)
    .join("");

  return {
    subject: `Pedido confirmado en ${vendorName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#4f46e5">Tu pedido fue confirmado</h1>
        <p>Hacemos tu pedido en <strong>${vendorName}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          ${itemRows}
          <tr><td style="padding:8px;font-weight:bold;border-top:2px solid #4f46e5">Total</td><td style="padding:8px;font-weight:bold;text-align:right;border-top:2px solid #4f46e5">$${total.toLocaleString("es-AR")}</td></tr>
        </table>
        <p style="color:#666;font-size:14px">Te vamos a avisar cuando tu pedido esté listo.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">Portal 659 — El centro comercial de tu barrio</p>
      </div>
    `,
  };
}

export function orderReadyEmail(vendorName: string, total: number): { subject: string; html: string } {
  return {
    subject: `¡Tu pedido de ${vendorName} está listo!`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#10b981">¡Tu pedido está listo!</h1>
        <p>Tu pedido de <strong>${vendorName}</strong> por <strong>$${total.toLocaleString("es-AR")}</strong> está listo para retirar o enviar.</p>
        <p style="color:#666;font-size:14px">Si tenés alguna consulta, escribile al local por WhatsApp.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">Portal 659 — El centro comercial de tu barrio</p>
      </div>
    `,
  };
}
