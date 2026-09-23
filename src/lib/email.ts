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
  } catch (e) {
    console.error("[Email] Error al enviar email:", e);
    return false;
  }
}

export function orderConfirmationEmail(vendorName: string, items: any[], total: number): { subject: string; html: string } {
  const itemRows = items
    .map((i) => {
      // Pack-aware (i.pack_size + price = paquete): la línea nunca se computa
      // como unidad×qty para no arrastrar decimales.
      const pack = Math.floor(Number(i.pack_size || 0));
      const lineTotal = pack >= 2 ? i.price * (i.qty / pack) : i.price * i.qty;
      return `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.qty}x ${i.name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${lineTotal.toLocaleString("es-AR")}</td></tr>`;
    })
    .join("");

  return {
    subject: `Pedido confirmado en ${vendorName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#4f46e5">Tu pedido fue confirmado</h1>
        <p>Estamos preparando tu pedido en <strong>${vendorName}</strong>.</p>
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

/**
 * Email al COMERCIO por pedido nuevo (web/app/bot) o pago aprobado por MP.
 * Se manda al email del perfil del dueño (canal de respaldo del dashboard/push).
 */
export function newOrderVendorEmail(params: {
  storeName: string;
  orderNumber: number | null;
  customerName: string;
  customerPhone: string;
  paymentLabel: string;
  items: { name: string; qty: number; price: number; pack_size?: number }[];
  total: number;
  method: string | null;
  address?: string | null;
}): { subject: string; html: string } {
  const { storeName, orderNumber, customerName, customerPhone, paymentLabel, items, total, method, address } = params;
  const numTxt = orderNumber ? `#${orderNumber}` : "nuevo";
  const itemRows = items
    .map((i) => {
      // Pack-aware (pack_size + price = paquete): la línea = price × (qty/pack).
      const pack = Math.floor(Number(i.pack_size || 0));
      const lineTotal = pack >= 2 ? i.price * (i.qty / pack) : i.price * i.qty;
      return `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.qty}x ${i.name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${lineTotal.toLocaleString("es-AR")}</td></tr>`;
    })
    .join("");

  return {
    subject: `🔔 Pedido ${numTxt} en ${storeName} — $${Number(total).toLocaleString("es-AR")}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#4f46e5">Tenés un pedido nuevo</h1>
        <p><strong>${storeName}</strong> · Pedido ${numTxt}</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          ${itemRows}
          <tr><td style="padding:8px;font-weight:bold;border-top:2px solid #4f46e5">Total</td><td style="padding:8px;font-weight:bold;text-align:right;border-top:2px solid #4f46e5">$${Number(total).toLocaleString("es-AR")}</td></tr>
        </table>
        <p style="font-size:14px">
          Cliente: <strong>${customerName}</strong> (${customerPhone})<br>
          Entrega: ${method === "pickup" ? "Retiro en el local" : `Envío${address ? ` — ${address}` : ""}`}<br>
          Pago: ${paymentLabel}
        </p>
        <p style="margin-top:16px">
          <a href="https://www.portal659.com.ar/vendor/dashboard" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir el panel</a>
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">Portal 659 — El centro comercial de tu barrio</p>
      </div>
    `,
  };
}

export function welcomeEmail(storeName: string, micrositeUrl: string): { subject: string; html: string } {
  return {
    subject: `¡Bienvenido/a a Portal 659, ${storeName}!`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#4f46e5">¡Tu vidriera está lista! 🎉</h1>
        <p>Hola <strong>${storeName}</strong>, ya sos parte de Portal 659, el centro comercial de tu barrio.</p>
        <p style="color:#666;font-size:14px">Tu micrositio ya está publicado. Compartí este link con tus clientes o mostrá tu QR:</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${micrositeUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
            Ver mi micrositio
          </a>
        </p>
        <p style="color:#666;font-size:14px">Completá tu perfil, subí tus fotos y empezá a recibir pedidos directo por WhatsApp.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">Portal 659 — El centro comercial de tu barrio · 0% comisión</p>
      </div>
    `,
  };
}

export function confirmEmailEmail(confirmUrl: string): { subject: string; html: string } {
  return {
    subject: "Confirmá tu email en Portal 659",
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#4f46e5">Confirmá tu email</h1>
        <p>Te registraste en <strong>Portal 659</strong>, el centro comercial de tu barrio.</p>
        <p>Para terminar de crear tu cuenta, confirmá tu dirección de email:</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${confirmUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
            Confirmar email
          </a>
        </p>
        <p style="color:#666;font-size:14px">El enlace expira en 48 horas. Si no te registraste vos, podés ignorar este correo.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">Portal 659 — El centro comercial de tu barrio · 0% comisión</p>
      </div>
    `,
  };
}

export function reviewRequestEmail(vendorName: string, reviewUrl: string): { subject: string; html: string } {
  return {
    subject: `¿Cómo estuvo tu pedido en ${vendorName}?`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h1 style="color:#10b981">¿Cómo estuvo tu pedido? ⭐</h1>
        <p>Tu pedido en <strong>${vendorName}</strong> fue entregado. Tu opinión ayuda a que el barrio elija mejor.</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${reviewUrl}" style="background:#10b981;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
            Dejar una reseña
          </a>
        </p>
        <p style="color:#999;font-size:12px">Si tuviste algún problema, escribile al comercio por WhatsApp primero.</p>
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
