/**
 * Empaqueta dist/win-unpacked en dist/portal-print-agent.zip.
 *
 * - Crea la carpeta interna "Portal Print Agent/" (al extraer queda con nombre).
 * - Recorta locales/ a es/en (reduce ~269MB -> ~220MB).
 * - Usa tar (bsdtar de Windows 10+), sin dependencias nuevas.
 * - Imprime tamaño y MD5 del zip final.
 *
 * Uso: node scripts/package-zip.mjs   (desde services/print-agent)
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..");
const SRC = join(ROOT, "dist", "win-unpacked");
const STAGING = join(ROOT, "dist", "Portal Print Agent");
const OUT = join(ROOT, "dist", "portal-print-agent.zip");

const KEEP_LOCALES = new Set(["es", "es-419", "en", "en-US", "en-GB"]);

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function trimLocales() {
  const localesDir = join(STAGING, "locales");
  if (!existsSync(localesDir)) return;
  for (const name of readdirSync(localesDir)) {
    const base = name.replace(/\.pak$/i, "");
    if (!KEEP_LOCALES.has(base)) {
      rmSync(join(localesDir, name), { recursive: true, force: true });
    }
  }
  const kept = readdirSync(localesDir).map((n) => n.replace(/\.pak$/i, ""));
  console.log(`locales recortados a: ${kept.join(", ")}`);
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`No existe ${SRC}. Corré primero: npm run build:win`);
    process.exit(1);
  }

  rmSync(STAGING, { recursive: true, force: true });
  rmSync(OUT, { force: true });
  mkdirSync(STAGING, { recursive: true });

  cpSync(SRC, STAGING, { recursive: true });
  trimLocales();

  // bsdtar crea .zip con -a (extensión .zip => compresor zip).
  // OJO: bsdtar interpreta "C:\..." del -f como host remoto ("C:"); por eso
  // se corre con cwd=dist y rutas relativas (mismo layout: carpeta superior
  // "Portal Print Agent/").
  execFileSync("tar", ["-a", "-c", "-f", "portal-print-agent.zip", "Portal Print Agent"], {
    stdio: "inherit",
    cwd: join(ROOT, "dist"),
  });

  rmSync(STAGING, { recursive: true, force: true });

  const size = statSync(OUT).size;
  console.log(`zip generado: ${OUT}`);
  console.log(`tamaño: ${(size / 1e6).toFixed(1)} MB (${size} bytes)`);
  console.log(`md5: ${await md5File(OUT)}`);
}

await main();