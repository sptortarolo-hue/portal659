/**
 * Compartir el comprobante (PNG) por WhatsApp desde el panel.
 *
 * - Android/Chrome: Web Share API con archivos → abre el selector de apps con
 *   WhatsApp y la imagen YA adjunta (un toque y listo).
 * - iOS/desktop (no soportan compartir archivos): fallback → descarga el PNG
 *   con nombre y abre el chat de WhatsApp con el texto ya escrito (el usuario
 *   adjunta la imagen descargada).
 */
export type ShareOutcome = {
  ok: boolean;
  mode: "share" | "download" | "cancelled" | "error";
  message?: string;
};

export async function shareReceiptImage(opts: {
  url: string;
  filename: string;
  title: string;
  text: string;
  phone?: string | null;
}): Promise<ShareOutcome> {
  try {
    const res = await fetch(opts.url);
    if (!res.ok) return { ok: false, mode: "error", message: "No se pudo leer la imagen" };
    const blob = await res.blob();
    const file = new File([blob], opts.filename, { type: blob.type || "image/png" });

    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (nav && typeof nav.share === "function") {
      const canFiles = typeof nav.canShare !== "function" || nav.canShare({ files: [file] });
      if (canFiles) {
        try {
          await nav.share({ files: [file], title: opts.title, text: opts.text });
          return { ok: true, mode: "share" };
        } catch (e: any) {
          if (e?.name === "AbortError") return { ok: false, mode: "cancelled" };
          // cualquier otro error → fallback
        }
      }
    }

    // Fallback: descargar + abrir WhatsApp con el texto.
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = opts.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);

    const phone = String(opts.phone || "").replace(/\D/g, "");
    if (phone) {
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(opts.text)}`,
        "_blank",
        "noopener,noreferrer"
      );
    }
    return {
      ok: true,
      mode: "download",
      message: "Se descargó la imagen: adjuntala en el chat de WhatsApp.",
    };
  } catch {
    return { ok: false, mode: "error", message: "No se pudo compartir el comprobante" };
  }
}
