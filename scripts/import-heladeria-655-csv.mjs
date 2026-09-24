#!/usr/bin/env node
/**
 * Importa el catálogo de heladera-655 desde el CSV exportado de WhatsApp.
 *
 * Uso:
 *   node scripts/import-heladeria-655-csv.mjs --csv="C:\Users\IPS\Downloads\heladeria 655.csv" --dry-run
 *   node scripts/import-heladeria-655-csv.mjs --csv="..." --apply [--vendor-slug=heladera-655]
 *   node scripts/import-heladeria-655-csv.mjs --csv="..." --apply --volume-groups
 *     (--volume-groups: en vez de crear productos "(Pack x 6)", crea grupos de
 *     volumen "Combinables $U → 6 x $P" con los productos de igual precio pack.
 *     Requiere la migración migrate-volume-pricing.sql aplicada.)
 *
 * - Solo AGREGA productos nuevos (upsert por nombre exacto, case-insensitive).
 *   No toca productos/categorías/grupos existentes (kit de 1/4, 1/2, kilo, Gustos).
 * - Fotos: se decodifican de la columna `image_data` (base64 embebido). Las URLs
 *   `blob:` del CSV son efímeras y no se usan. Se procesan como el upload normal
 *   (sharp: rotate + resize 1200px + jpeg q80) y se guardan en
 *   `UPLOAD_DIR/offers/<vendorId>/hel655-<hash>.jpg`.
 * - Packs: `product_variants` es solo de moda (color/talle), así que el pack va
 *   como producto separado "<nombre> (Pack x 6)" con el precio extraído de la
 *   descripción. La fila de Toppings se divide en 6 productos individuales.
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

const CSV_PATH = args.csv || 'C:\\Users\\IPS\\Downloads\\heladeria 655.csv';
const APPLY = Boolean(args.apply);
const WITH_GROUPS = Boolean(args['volume-groups']);
const VENDOR_SLUG = args['vendor-slug'] || 'heladera-655';

/** $1.000 con punto de miles (determinístico en cualquier ICU). */
function fmtAR(n) {
  return '$' + String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Filas que no son productos vendibles (índice CSV 1-based de la columna `index`).
const SKIP_INDEX = new Set(['1', '8', '11']);
// Toppings (índice 48): se divide en estos productos individuales.
const TOPPING_ITEMS = [
  { name: 'Topping Maní con chocolate', price: 1200 },
  { name: 'Topping Microcereal choco color', price: 1200 },
  { name: 'Topping Lentejas de chocolate', price: 1200 },
  { name: 'Topping Crocante de maní sabor almendras', price: 800 },
  { name: 'Topping Crocante de maní con chocolate', price: 800 },
  { name: 'Topping Merenguitos', price: 500 },
];

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

function parsePrice(v) {
  const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function parsePackPrice(desc) {
  const m = (desc || '').match(/pack\s*de\s*6\s*x\s*\$?\s*([\d.]+)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Agrupa ítems por precio de pack (para grupos de volumen combinables). */
function groupByPack(list) {
  const map = new Map();
  for (const it of list) {
    if (!it.packPrice) continue;
    if (!map.has(it.packPrice)) map.set(it.packPrice, []);
    map.get(it.packPrice).push(it);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([packPrice, members]) => {
    const units = [...new Set(members.map((m) => m.price))];
    const name = units.length === 1
      ? `Combinables ${fmtAR(units[0])} → 6 x ${fmtAR(packPrice)}`
      : `Combinables → 6 x ${fmtAR(packPrice)}`;
    return { packPrice, name: name.slice(0, 60), members };
  });
}

function categoryFor(name) {
  const n = name.toLowerCase();
  if (/palito|frisky|frutifrozen|granizado|cucurucho|caritas|cono tu/.test(n)) return 'Palitos';
  if (/postre|torta|copa|cucurucho/.test(n)) return 'Postres y tortas';
  if (/balde/.test(n)) return 'Baldes';
  if (/chipa/.test(n)) return 'Congelados';
  if (/promo/.test(n)) return 'Promos';
  if (/topping|maní|merenguito|crocante|lenteja|microcereal/.test(n)) return 'Extras';
  if (/helado vegano|helado sin tacc|paquetes/.test(n)) return 'Helados envasados';
  return 'Bombones e impulsivos';
}

function imagePayload(dataUri) {
  const m = (dataUri || '').match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/s);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[3].replace(/\s+/g, ''), 'base64');
    if (buf.length < 500) return null;
    // Validación mínima de firma (jpeg/png/webp).
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
const report = { skipped: [], products: [], packs: [], imageReuse: 0, errors: [] };
const hashToFile = new Map(); // sha256 -> filename (dedupe dentro del CSV)

const items = []; // {name, price, description, category, imgBuf, packPrice, srcIndex}
for (const r of rows) {
  const idx = (r.index || '').trim();
  const name = cleanName(r.name);
  if (!name) continue; // filas vacías / solo-foto duplicada
  if (SKIP_INDEX.has(idx)) { report.skipped.push({ index: idx, name, reason: 'no es producto vendible (logo/lista de precios/catálogo)' }); continue; }

  if (idx === '48') {
    // Toppings: una foto compartida, 6 productos.
    const imgBuf = imagePayload(r.image_data);
    for (const t of TOPPING_ITEMS) {
      items.push({ name: t.name, price: t.price, description: 'Topping para helado', category: 'Extras', imgBuf, packPrice: null, srcIndex: idx });
    }
    continue;
  }

  const price = parsePrice(r.price_value);
  if (!price) { report.skipped.push({ index: idx, name, reason: 'sin price_value' }); continue; }
  const desc = cleanName(r.description);
  const packPrice = parsePackPrice(desc);
  items.push({
    name,
    price,
    description: desc,
    category: categoryFor(name),
    imgBuf: imagePayload(r.image_data),
    packPrice,
    srcIndex: idx,
  });
  if (packPrice) report.packs.push({ index: idx, name, unit: price, pack6: packPrice });
}

for (const it of items) {
  if (!report.products.some((p) => p.name.toLowerCase() === it.name.toLowerCase())) {
    report.products.push({ index: it.srcIndex, name: it.name, price: it.price, category: it.category, hasImage: Boolean(it.imgBuf), pack6: it.packPrice ?? undefined });
  }
}

if (!APPLY) {
  // Dry-run: decodifica y procesa imágenes a un temporal para validar que ninguna esté corrupta.
  const tmpDir = path.join(process.cwd(), 'uploads', '_dryrun-hel655');
  fs.mkdirSync(tmpDir, { recursive: true });
  let okImg = 0, badImg = 0;
  const seen = new Set();
  for (const it of items) {
    if (!it.imgBuf) { badImg++; continue; }
    const hash = crypto.createHash('sha256').update(it.imgBuf).digest('hex').slice(0, 12);
    if (seen.has(hash)) { report.imageReuse++; continue; }
    seen.add(hash);
    const { buf, ext } = await processImage(it.imgBuf);
    fs.writeFileSync(path.join(tmpDir, `hel655-${hash}.${ext}`), buf);
    okImg++;
  }
  console.log(`DRY-RUN heladera-655 desde ${CSV_PATH}`);
  console.log(`Filas CSV: ${rows.length} | productos a crear: ${report.products.length} | packs x6: ${report.packs.length} | skipeadas: ${report.skipped.length}`);
  console.log(`Imágenes OK: ${okImg} únicas | reutilizadas (mismo hash): ${report.imageReuse} | sin imagen válida: ${badImg}`);
  console.log(`(imágenes de prueba en uploads/_dryrun-hel655/ — borrar tras validar)`);
  console.log('\n--- PRODUCTOS ---');
  for (const p of report.products) console.log(`[${p.category}] ${p.name} — $${p.price}${p.pack6 ? ` (+Pack x6 $${p.pack6})` : ''}${p.hasImage ? '' : '  [SIN FOTO]'}`);
  console.log('\n--- SKIPEADAS ---');
  for (const s of report.skipped) console.log(`#${s.index} ${s.name} — ${s.reason}`);
  console.log('\n--- PACKS DETECTADOS ---');
  for (const k of report.packs) console.log(`#${k.index} ${k.name}: unidad $${k.unit} / pack x6 $${k.pack6}`);
  if (WITH_GROUPS) {
    console.log('\n--- GRUPOS DE VOLUMEN (se crearían con --apply --volume-groups) ---');
    for (const g of groupByPack(items)) {
      console.log(`"${g.name}" [${g.members.length}]: ${g.members.map((m) => m.name.slice(0, 40)).join(' | ')}`);
    }
  } else if (report.packs.length > 0) {
    console.log('\n(Consejo: con --volume-groups se crean grupos "Combinables" en vez de productos "(Pack x 6)".)');
  }
  fs.writeFileSync(path.join(tmpDir, 'report.json'), JSON.stringify(report, null, 2));
  process.exit(0);
}

// ---------------- apply ----------------
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
let created = 0, createdPacks = 0, skippedExisting = 0;
const createdItems = []; // {id, name, price, packPrice} recién creados (candidatos a grupos)

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
      filename = `hel655-${hash}.${ext}`;
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
    ? [vendor.id, it.name, it.description || null, it.price, 'ARS', it.category, vendor.neighborhood, 'food', true, false, imageUrl]
    : [vendor.id, it.name, it.description || null, it.price, 'ARS', it.category, vendor.neighborhood, 'food', true, imageUrl];
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const inserted = await client.query(
    `INSERT INTO products (${cols}) VALUES (${placeholders}) RETURNING id`, vals
  );
  existingSet.add(key);
  created++;
  createdItems.push({ id: inserted.rows[0].id, name: it.name, price: it.price, packPrice: it.packPrice });

  if (it.packPrice && !WITH_GROUPS) {
    const packName = `${it.name} (Pack x 6)`;
    if (!existingSet.has(packName.toLowerCase())) {
      const pvals = hasPrep
        ? [vendor.id, packName, `Pack x 6 — ${it.description || it.name}`, it.packPrice, 'ARS', it.category, vendor.neighborhood, 'food', true, false, imageUrl]
        : [vendor.id, packName, `Pack x 6 — ${it.description || it.name}`, it.packPrice, 'ARS', it.category, vendor.neighborhood, 'food', true, imageUrl];
      await client.query(`INSERT INTO products (${cols}) VALUES (${pvals.map((_, i) => `$${i + 1}`).join(', ')})`, pvals);
      existingSet.add(packName.toLowerCase());
      createdPacks++;
    }
  }
}

console.log(`APPLY OK vendor=${VENDOR_SLUG}: productos creados=${created} packs creados=${createdPacks} ya_existían=${skippedExisting} imágenes_reutilizadas=${report.imageReuse}`);

if (WITH_GROUPS) {
  const volTables = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='volume_groups'"
  );
  if (!volTables.rows.length) {
    console.error('Falta la migración de volumen (volume_groups). Aplicala (migrate-volume-pricing.sql) y reintentá con --volume-groups.');
  } else {
    const gExisting = await client.query(
      'SELECT id, name, product_ids FROM volume_groups WHERE vendor_id = $1 AND active = true', [vendor.id]
    );
    const takenIds = new Set();
    for (const g of gExisting.rows) for (const pid of g.product_ids || []) takenIds.add(String(pid));
    const takenNames = new Set(gExisting.rows.map((g) => g.name));
    let createdGroups = 0, skippedGroups = 0;
    // Semillas: recién creados + preexistentes (si el apply anterior fue sin
    // flag, los productos ya están y hay que buscarles el id).
    const groupSeeds = createdItems.filter((i) => i.packPrice);
    const missingSeeds = items.filter(
      (i) => i.packPrice && !groupSeeds.some((s) => s.name.toLowerCase() === i.name.toLowerCase())
    );
    if (missingSeeds.length > 0) {
      const found = await client.query(
        'SELECT id, name, price FROM products WHERE vendor_id = $1 AND lower(name) = ANY($2)',
        [vendor.id, missingSeeds.map((i) => i.name.toLowerCase())]
      );
      for (const r of found.rows) {
        const src = items.find((i) => i.name.toLowerCase() === String(r.name).toLowerCase());
        if (src) groupSeeds.push({ id: r.id, name: r.name, price: Number(r.price), packPrice: src.packPrice });
      }
    }
    for (const g of groupByPack(groupSeeds)) {
      const free = g.members.filter((m) => !takenIds.has(String(m.id)));
      if (free.length === 0 || takenNames.has(g.name)) { skippedGroups++; continue; }
      const ins = await client.query(
        `INSERT INTO volume_groups (vendor_id, name, product_ids, combine_promo, combine_cash, extras_mode)
         VALUES ($1, $2, $3, false, false, 'on_top') RETURNING id`,
        [vendor.id, g.name, free.map((m) => m.id)]
      );
      await client.query(
        `INSERT INTO volume_tiers (group_id, min_qty, kind, value) VALUES ($1, 6, 'fixed_total', $2)`,
        [ins.rows[0].id, g.packPrice]
      );
      for (const m of free) takenIds.add(String(m.id));
      takenNames.add(g.name);
      createdGroups++;
      console.log(`  grupo "${g.name}" [${free.length}]: ${free.map((m) => m.name.slice(0, 40)).join(' | ')}`);
    }
    console.log(`GRUPOS: creados=${createdGroups} omitidos=${skippedGroups}`);
  }
}
await client.end();
