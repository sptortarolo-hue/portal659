/**
 * Enviar el comprobante (PNG) al chat del cliente desde el panel.
 *
 * Tres caminos, en este orden:
 *  1. Bot de WhatsApp conectado → el SERVER manda la imagen + el texto solo
 *     (eso lo hace la API; acá no intervene).
 *  2. El navegador puede compartir archivos (Android/Chrome) → Web Share API
 *     con la imagen ADJUNTA: el usuario elige WhatsApp y el chat del cliente.
 *  3. No puede (desktop / iOS) → se abre el chat del cliente (wa.me) con el
 *     COMPROBANTE ESCRITO (como los pedidos del bot) y se descarga el PNG por
 *     si quieren adjuntarlo.
 *
 * Importante: en el camino 3 la ventana se abre SINCRÓNICAMENTE (dentro del
 * gesto del click). Si se abriera después de un `await`, el navegador la
 * bloquea como popup y no pasa nada — que era el bug.
 */
import { toE164 } from "@/lib/phone";

export type ShareOutcome = {
  ok: boolean;
  /** share = imagen adjunta (Web Share) · wa = chat abierto con el texto escrito
   *  · download = sólo se descargó el PNG · cancelled = el usuario canceló
   *  · error = no se pudo. */
  mode: "share" | "wa" | "download" | "cancelled" | "error";
  message?: string;
  /** Chat de WhatsApp del cliente (ya armado por el server). */
  waUrl?: string;
};

export type ShareReceiptOpts = {
  /** URL del PNG (ya generado por el server). */
  url: string;
  filename: string;
  title: string;
  /** Texto corto que acompaña a la imagen. */
  text: string;
  /** Comprobante escrito (fallback cuando no se puede adjuntar la imagen). */
  receiptText?: string | null;
  /** Chat del cliente ya armado por el server (wa.me con E.164). */
  waUrl?: string | null;
  /** Fallback para armar el wa.me si el server no lo pasó. */
  phone?: string | null;
};

/** Arma el link del chat de WhatsApp (E.164). Sin teléfono → selector de contactos. */
export function buildWaUrl(phone?: string | null, text?: string | null): string {
  const e = toE164(phone);
  const t = encodeURIComponent(String(text || ""));
  return e ? `https://wa.me/${e}?text=${t}` : `https://wa.me/?text=${t}`;
}

/** PNG 1×1 real (para el probe de canShare: mira el tipo MIME, no el contenido). */
const PNG_1X1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
  8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 252, 207,
  192, 80, 15, 0, 4, 133, 1, 128, 132, 169, 140, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130,
]);

/**
 * ¿El navegador puede compartir archivos?
 * Decisión SINCRÓNICA (sin red) para poder abrir el chat dentro del gesto del
 * click si la respuesta es no.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (typeof File === "undefined") return false;
  if (typeof navigator.canShare !== "function") return true;
  try {
    const probe = new File([PNG_1X1], "comprobante.png", { type: "image/png" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Abre el chat de WhatsApp. Devuelve false si el navegador lo bloqueó. */
function openWa(waUrl: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const w = window.open(waUrl, "_blank");
    if (w) {
      try {
        w.opener = null;
      } catch {
        /*noop*/
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function downloadImage(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo leer la imagen");
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

/**
 * Comparte el comprobante con el cliente.
 * - Si el navegador puede adjuntar archivos → imagen adjunta (Web Share).
 * - Si no → chat del cliente con el comprobante escrito + PNG descargado.
 */
export async function shareReceiptImage(opts: ShareReceiptOpts): Promise<ShareOutcome> {
  const waText = opts.receiptText || opts.text;
  const waUrl = opts.waUrl || buildWaUrl(opts.phone, waText);

  if (!canShareFiles()) {
    // Sin imagen adjunta posible: chat del cliente con el comprobante escrito.
    // El window.open va ANTES de cualquier await → no lo bloquea el popup.
    const opened = openWa(waUrl);
    try {
      await downloadImage(opts.url, opts.filename);
    } catch {
      /* sin descarga: igual abrimos el chat */
    }
    return {
      ok: true,
      mode: opened ? "wa" : "download",
      waUrl,
      message: opened
        ? "Se abrió el chat de WhatsApp con el comprobante escrito: revisá y apretá enviar."
        : "Se descargó el comprobante: adjuntalo en el chat de WhatsApp del cliente.",
    };
  }

  // Con imagen adjunta (Android/Chrome): Web Share API.
  try {
    const res = await fetch(opts.url);
    if (!res.ok) throw new Error("No se pudo leer la imagen");
    const blob = await res.blob();
    const file = new File([blob], opts.filename, { type: blob.type || "image/png" });
    await navigator.share({ files: [file], title: opts.title, text: opts.text });
    return { ok: true, mode: "share", waUrl };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { ok: false, mode: "cancelled", waUrl };
    }
    // El share falló (navegador, permiso, etc.) → chat del cliente + descarga.
    const opened = openWa(waUrl);
    try {
      await downloadImage(opts.url, opts.filename);
    } catch {
      /*noop*/
    }
    return {
      ok: true,
      mode: opened ? "wa" : "download",
      waUrl,
      message: opened
        ? "Se abrió el chat de WhatsApp con el comprobante escrito: revisá y apretá enviar."
        : "Se descargó el comprobante: adjuntalo en el chat de WhatsApp del cliente.",
    };
  }
}

/** Mensaje para el panel según el resultado. */
export function shareOutcomeMessage(r: ShareOutcome): string | null {
  switch (r.mode) {
    case "share":
      return "✅ Comprobante compartido con la imagen";
    case "wa":
      return r.message || "Se abrió el chat de WhatsApp";
    case "download":
      return r.message || "⬇️ Se descargó el comprobante";
    case "cancelled":
      return null;
    default:
      return r.message || "No se pudo compartir el comprobante";
  }
}
