import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { getSiteUrl } from "@/lib/site-url";
import { logApiError } from "@/lib/api-error";

/**
 * Descarga una foto remota CONFIABLE a uploads/ (para no hotlinkear).
 * Allowlist estricta (anti-SSRF): solo hosts de Open Food Facts, que es
 * de donde sale el lookup de códigos. Cualquier otra URL se rechaza.
 * Devuelve la URL local o null (el llamador conserva la anterior).
 */
const ALLOWED_HOSTS = new Set([
  "images.openfoodfacts.org",
  "static.openfoodfacts.org",
]);

const MAX_BYTES = 5 * 1024 * 1024;

export async function downloadRemoteImage(
  remoteUrl: string,
  vendorId: string,
  folder = "offers"
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(parsed.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;

    let outBuffer = buf;
    let outExt = "jpg";
    try {
      const sharp = (await import("sharp")).default;
      const pipeline = sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true });
      const meta = await sharp(buf).metadata();
      const format = meta.format as string | undefined;
      if (format === "png" || format === "webp") {
        outBuffer = await pipeline.toFormat(format, { quality: 80 }).toBuffer();
        outExt = format;
      } else {
        outBuffer = await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
        outExt = "jpg";
      }
    } catch (e) {
      logApiError("remote-image/sharp", e);
      outBuffer = buf;
    }

    const filename = `off-${Date.now()}-${randomBytes(6).toString("hex")}.${outExt}`;
    const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
    const cleanFolder = folder.replace(/[^a-z0-9_-]/g, "") || "offers";
    const dir = path.join(uploadRoot, cleanFolder, vendorId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), outBuffer);
    return `${getSiteUrl()}/uploads/${cleanFolder}/${vendorId}/${filename}`;
  } catch (e) {
    logApiError("remote-image/download", e);
    return null;
  }
}
