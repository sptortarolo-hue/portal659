#!/usr/bin/env node
/**
 * Importa un catálogo exportado con "WhatsApp Catalogue Exporter"
 * (Chrome Web Store: https://chromewebstore.google.com/detail/beambfgmpbbncelafdodhppkjgnnabgf)
 * a un vendor existente de Portal 659.
 *
 * Uso:
 *   node scripts/import-wa-csv.mjs --csv="C:\Users\IPS\Downloads\whatsapp-catalogue-2026-10-01.csv" --dry-run
 *   node scripts/import-wa-csv.mjs --csv="..." --vendor-slug=mi-tienda --apply [--category="Dietética"] [--type=product]
 *
 * Columnas esperadas (las que genera la extensión):
 *   index,name,price,price_value,currency,description,product_link,image_url,image_data,raw_text
 * - Precio: se usa `price_value`; si viene vacío se parsea `price` ("ARS 2,200.00" -> 2200).
 * - Foto: se usa `image_data` (data URI base64). `image_url` suele ser `blob:https://web.whatsapp.com/...`
 *   (efímero, no descargable) y se ignora salvo que sea http(s) real.
 * - Filas sin nombre o sin precio válido se descartan con motivo (logos, fotos sueltas).
 *
 * - Solo AGREGA productos nuevos (upsert por nombre exacto, case-insensitive).
 *   No toca productos/categorías existentes.
 * - Fotos: mismo pipeline que el upload normal (sharp: rotate + resize 1200px + jpeg q80)
 *   en `UPLOAD_DIR/offers/<vendorId>/<prefix>-<hash>.jpg`.
 *
 * En --apply requiere DATABASE_URL en el entorno y que el vendor exista.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);

const CSV_PATH = args.csv || '';
const APPLY = Boolean(args.apply);
const VENDOR_SLUG = args['vendor-slug'] || '';
const CATEGORY = String(args.category || 'otras');
const TYPE = String(args.type || 'product');
const PREFIX = String(args['file-prefix'] || 'wa');
const SKIP_INDEX = new Set(
  String(args['skip-index'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

if (!CSV_PATH) {
  console.error('Pasá --csv="ruta/al/whatsapp-catalogue-....csv"');
  process.exit(1);
}

/** $1.000 con punto de miles (determinístico en cualquier ICU). */
function fmtAR(n) {
  return '$' + String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { q = false; }
      } else { cur += c; }
    } else if (c === '"') { q = true; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else { cur += c; }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    const o = {};
    header.forEach((h, j) => { o[h] = cells[j] ?? ''; });
    return o;
  });
}

function cleanName(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function parsePriceValue(v) {
  const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** "ARS 2,200.00" / "$ 1.500" -> número. */
function parsePriceLabel(v) {
  const s = String(v || '').replace(/[^\d.,]/g, '').trim();
  if (!s) return null;
  // Si hay coma decimal estilo "2,200.00": quitar comas de miles, dejar punto.
  // Si es "1.500" (punto de miles sin coma): quitar puntos.
  let norm = s;
  if (/,/.test(s)) {
    norm = s.replace(/,/g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    norm = s.replace(/\./g, '');
  }
  const n = Number(norm);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function imagePayload(dataUri) {
  const m = (dataUri || '').match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/s);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[3].replace(/\s+/g, ''), 'base64');
    if (buf.length < 500) return null;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isWebp = buf.toString('ascii', 0, 4) === 'RIFF';
    if (!isJpg && !isPng && !isWebp) return null;
    return buf;
  } catch { return null; }
}

async function processImage(buf) {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf).metadata();
    const fmt = meta.format;
    if (fmt === 'png' || fmt === 'webp') {
      return { buf: await sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true }).toFormat(fmt, { quality: 80 }).toBuffer(), ext: fmt };
    }
    if (fmt === 'avif' || fmt === 'gif') return { buf, ext: 'jpg' };
    return { buf: await sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(), ext: 'jpg' };
  } catch {
    return { buf, ext: 'jpg' };
  }
}

// ---------------- main ----------------
const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
const report = { skipped: [], products: [], imageReuse: 0, errors: [] };

const items = []; // {name, price, description, category, imgBuf, srcIndex}
for (const r of rows) {
  const idx = (r.index || '').trim();
  const name = cleanName(r.name);
  if (SKIP_INDEX.has(idx)) { report.skipped.push({ index: idx, name: name || '(sin nombre)', reason: 'skip-index' }); continue; }
  if (!name) { report.skipped.push({ index: idx, name: '(sin nombre)', reason: 'sin nombre (foto suelta del catálogo)' }); continue; }

  const price = parsePriceValue(r.price_value) ?? parsePriceLabel(r.price);
  if (!price) { report.skipped.push({ index: idx, name, reason: 'sin precio válido' }); continue; }

  items.push({
    name,
    price,
    description: cleanName(r.description),
    category: CATEGORY,
    imgBuf: imagePayload(r.image_data),
    srcIndex: idx,
  });
}

for (const it of items) {
  if (!report.products.some((p) => p.name.toLowerCase() === it.name.toLowerCase())) {
    report.products.push({ index: it.srcIndex, name: it.name, price: it.price, category: it.category, hasImage: Boolean(it.imgBuf) });
  }
}

if (!APPLY) {
  const tmpDir = path.join(process.cwd(), 'uploads', `_dryrun-${PREFIX}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  let okImg = 0, badImg = 0;
  const seen = new Set();
  for (const it of items) {
    if (!it.imgBuf) { badImg++; continue; }
    const hash = crypto.createHash('sha256').update(it.imgBuf).digest('hex').slice(0, 12);
    if (seen.has(hash)) { report.imageReuse++; continue; }
    seen.add(hash);
    const { buf, ext } = await processImage(it.imgBuf);
    fs.writeFileSync(path.join(tmpDir, `${PREFIX}-${hash}.${ext}`), buf);
    okImg++;
  }
  console.log(`DRY-RUN WhatsApp Catalogue desde ${CSV_PATH}`);
  console.log(`Filas CSV: ${rows.length} | productos a crear: ${report.products.length} | skipeadas: ${report.skipped.length}`);
  console.log(`Imágenes OK: ${okImg} únicas | reutilizadas (mismo hash): ${report.imageReuse} | sin imagen válida: ${badImg}`);
  console.log(`(imágenes de prueba en uploads/_dryrun-${PREFIX}/ — borrar tras validar)`);
  console.log('\n--- PRODUCTOS ---');
  for (const p of report.products) console.log(`[${p.category}] ${p.name} — ${fmtAR(p.price)}${p.hasImage ? '' : '  [SIN FOTO]'}`);
  console.log('\n--- SKIPEADAS ---');
  for (const s of report.skipped) console.log(`#${s.index} ${s.name} — ${s.reason}`);
  fs.writeFileSync(path.join(tmpDir, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(0);
}

// ---------------- apply ----------------
if (!VENDOR_SLUG) {
  console.error('Pasá --vendor-slug=<slug> para --apply.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en el entorno para --apply.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const vendorRes = await client.query('SELECT id, store_name, neighborhood FROM vendors WHERE slug = $1 LIMIT 1', [VENDOR_SLUG]);
if (!vendorRes.rows.length) {
  console.error(`No existe vendor con slug '${VENDOR_SLUG}'. Crealo primero o pasá --vendor-slug=<slug>.`);
  process.exit(1);
}
const vendor = vendorRes.rows[0];

const hasPrep = (await client.query(
  "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='requires_prep'"
)).rows.length > 0;

const existing = await client.query('SELECT lower(name) AS n FROM products WHERE vendor_id = $1', [vendor.id]);
const existingSet = new Set(existing.rows.map((r) => r.n));
const catRows = await client.query('SELECT lower(name) AS n, name FROM vendor_categories WHERE vendor_id = $1', [vendor.id]);
const catSet = new Set(catRows.rows.map((r) => r.n));

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const hashToFile = new Map();
let created = 0, skippedExisting = 0;

for (const it of items) {
  const key = it.name.toLowerCase();
  if (existingSet.has(key)) { skippedExisting++; continue; }
  if (!catSet.has(it.category.toLowerCase())) {
    const pos = (await client.query('SELECT count(*)::int AS m FROM vendor_categories WHERE vendor_id = $1', [vendor.id])).rows[0].m;
    await client.query('INSERT INTO vendor_categories (vendor_id, name, position) VALUES ($1, $2, $3)', [vendor.id, it.category, pos]);
    catSet.add(it.category.toLowerCase());
  }
  let imageUrl = null;
  if (it.imgBuf) {
    const hash = crypto.createHash('sha256').update(it.imgBuf).digest('hex').slice(0, 12);
    let filename = hashToFile.get(hash);
    if (!filename) {
      const { buf, ext } = await processImage(it.imgBuf);
      filename = `${PREFIX}-${hash}.${ext}`;
      const dir = path.join(uploadRoot, 'offers', vendor.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), buf);
      hashToFile.set(hash, filename);
    } else { report.imageReuse++; }
    imageUrl = `${siteUrl}/uploads/offers/${vendor.id}/${filename}`;
  }
  const cols = hasPrep
    ? 'vendor_id, name, description, price, currency, category, neighborhood, type, available, requires_prep, image_url'
    : 'vendor_id, name, description, price, currency, category, neighborhood, type, available, image_url';
  const vals = hasPrep
    ? [vendor.id, it.name, it.description || null, it.price, 'ARS', it.category, vendor.neighborhood, TYPE, true, false, imageUrl]
    : [vendor.id, it.name, it.description || null, it.price, 'ARS', it.category, vendor.neighborhood, TYPE, true, imageUrl];
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  await client.query(`INSERT INTO products (${cols}) VALUES (${placeholders})`, vals);
  existingSet.add(key);
  created++;
}

console.log(`APPLY OK vendor=${VENDOR_SLUG}: productos creados=${created} ya_existían=${skippedExisting} imágenes_reutilizadas=${report.imageReuse}`);
await client.end();
