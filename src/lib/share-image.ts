/**
 * Helpers de imagen para las tarjetas OG (WhatsApp / redes).
 *
 * Por qué existe este módulo (3 problemas reales que hacían que la foto del
 * local "no saliera" en la preview de WhatsApp):
 *
 *  1. **resvg (el motor de next/og) NO dibuja WebP ni AVIF**: los deja en
 *     blanco SIN dar error (probado con el mismo motor: JPEG ✅, PNG ✅,
 *     WebP ❌ plano). Como `upload-file.ts` conserva el formato original cuando
 *     es PNG/WebP (y también AVIF/GIF), una portada en .webp/.avif dejaba la
 *     tarjeta con logo + texto y **sin la foto de fondo**.
 *
 *  2. **El encuadre de satori es siempre "centrado"**: con `background-size:
 *     cover` una foto VERTICAL (1200x1600) recorta la franja central, que en
 *     muchas fotos es la parte vacía (una pared, el techo). Se recorta en
 *     servidor con la estrategia `attention` de sharp (la banda con más
 *     detalle = la que el comercio quiere mostrar).
 *
 *  3. **Hairpin**: las fotos viven en disco (UPLOAD_DIR). Bajarlas por la URL
 *     pública hace VPS → Cloudflare → VPS, que en un VPS chico cuelga el
 *     render y termina cayendo al fallback (tarjeta sin foto y sin logo).
 *     Se lee el archivo del disco cuando la URL es de /uploads/.
 *
 * Regla: al motor de render SIEMPRE se le pasa un JPEG embebido (data URI),
 * nunca una URL remota: así el formato y el encuadre quedan garantizados.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSiteUrl } from "@/lib/site-url";

/** Ruta en disco de una URL /uploads/... (o null si no es local). */
export function localUploadPath(url: string | null): string | null {
  if (!url) return null;
  try {
    const site = getSiteUrl().replace(/\/$/, "");
    let path: string | null = null;
    if (url.startsWith(`${site}/uploads/`)) path = url.slice(site.length);
    else if (url.startsWith("/uploads/")) path = url;
    if (!path || path.includes("..")) return null;
    const root = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
    return join(root, path.replace(/^\/uploads\//, ""));
  } catch {
    return null;
  }
}

/** Descarga el buffer de una imagen (disco primero, remoto después). */
export async function loadImageBuffer(
  url: string | null,
  ms = 8000
): Promise<{ buf: Buffer; contentType: string | null } | null> {
  if (!url) return null;
  const local = localUploadPath(url);
  if (local) {
    try {
      const buf = await readFile(local);
      if (buf.length > 0) return { buf, contentType: null };
    } catch {
      /* cae a remoto */
    }
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return { buf, contentType: res.headers.get("content-type") };
  } catch {
    return null;
  }
}

type JpegOpts = {
  width: number;
  height?: number;
  /** "cover" (recorta) o "contain" (encaja con fondo blanco). */
  fit?: "cover" | "contain";
  /** Recorte inteligente: la banda con más detalle (sharp.strategy.attention). */
  smart?: boolean;
  quality?: number;
};

/**
 * Normaliza cualquier imagen (JPEG/PNG/WebP/AVIF/GIF) a un JPEG embebido
 * (data URI). Devuelve null si la imagen no se puede leer o decodificar.
 */
export async function toJpegDataUri(
  buf: Buffer,
  { width, height, fit = "cover", smart = true, quality = 82 }: JpegOpts
): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const base = sharp(buf).rotate();
    const resized =
      fit === "contain"
        ? base.resize({ width, ...(height ? { height } : {}), fit: "contain", background: "#ffffff" })
        : base.resize({
            width,
            ...(height ? { height } : {}),
            fit: "cover",
            // `attention` elige la banda con más detalle de la foto: una foto
            // vertical de un local recorta el lugar, no el techo.
            // Sin `position`, sharp recorta centrado (el default).
            ...(smart ? { position: sharp.strategy.attention } : {}),
          });
    const out = await resized
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Foto del local lista para el render: recortada a 1200x630 (formato de la
 * tarjeta) y embebida como JPEG. Null si no hay foto o no se pudo leer.
 */
export async function coverJpegDataUri(
  url: string | null,
  width = 1200,
  height = 630
): Promise<string | null> {
  const img = await loadImageBuffer(url);
  if (!img) return null;
  return toJpegDataUri(img.buf, { width, height, fit: "cover", smart: true });
}

/** Logo listo para el render: cuadrado, embebido como JPEG. */
export async function squareJpegDataUri(
  url: string | null,
  size = 400
): Promise<string | null> {
  const img = await loadImageBuffer(url);
  if (!img) return null;
  return toJpegDataUri(img.buf, { width: size, height: size, fit: "cover", smart: true });
}
