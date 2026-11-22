// Cloudflare Email Worker para conciliación bancaria
// Recibe emails a *@portal659.com.ar y los reenvía al webhook del portal.
//
// Setup:
// 1. Crear Worker en Cloudflare Dashboard → Workers & Pages → Create Worker
// 2. Pegar este código
// 3. Deploy
// 4. Email Routing → Catch-all → Send to Worker → seleccionar este Worker
//
// Para usar postal-mime (mejor parsing), agregar como dependencia:
//   wrangler.toml → [dependencies] postal-mime = "*"
// y descomentar el import de abajo.

// import PostalMime from "postal-mime";

export default {
  async email(message, env, ctx) {
    const rawEmail = await new Response(message.raw).text();

    let textBody = "";
    let subject = message.headers.get("subject") || "";

    // Intentar parsear con postal-mime si está disponible
    try {
      // Si postal-mime está instalado, descomentar:
      // const parser = new PostalMime();
      // const parsed = await parser.parse(rawEmail);
      // textBody = parsed.text || parsed.html || "";
      // subject = parsed.subject || subject;
    } catch (e) {
      // Fallback: extraer body manualmente
    }

    // Fallback manual: extraer body después de los headers
    if (!textBody) {
      const parts = rawEmail.split(/\r?\n\r?\n/);
      if (parts.length > 1) {
        textBody = parts.slice(1).join("\n\n");
      } else {
        textBody = rawEmail;
      }
    }

    // Limpiar quoted-printable básico
    textBody = textBody
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    const payload = {
      from: message.from || "",
      subject: subject,
      text: textBody,
      to: message.to || "",
      date: new Date().toISOString(),
    };

    try {
      const response = await fetch("https://www.portal659.com.ar/api/webhooks/bank-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error("Webhook failed:", response.status);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
  },
};
