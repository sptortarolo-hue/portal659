/**
 * Genera assets/icon.ico a partir de assets/icon-512.png (ICO con imagen PNG,
 * válido en Windows Vista+). Sirve de icono del .exe y de la ventana.
 *
 * Uso: node scripts/make-ico.mjs   (desde services/print-agent)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const pngPath = join(DIR, "assets", "icon-512.png");
const icoPath = join(DIR, "assets", "icon.ico");

const png = readFileSync(pngPath);
const size = png.length;

// ICONDIR (6 bytes): reserved=0, type=1, count=1
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

// ICONDIRENTRY (16 bytes): 256x256 se codifica con width=0, height=0
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // width (0 => 256)
entry.writeUInt8(0, 1); // height (0 => 256)
entry.writeUInt8(0, 2); // palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bitcount
entry.writeUInt32LE(size, 8); // bytes in res
entry.writeUInt32LE(22, 12); // offset = 6 + 16

writeFileSync(icoPath, Buffer.concat([header, entry, png]));
console.log(`icon.ico generado: ${size + 22} bytes`);