/**
 * Verificación de las etiquetas de balanza (EAN-13 de medida variable).
 * Corre con: node scripts/check-scale-barcode.mjs
 *
 * Node 24 ejecuta el TypeScript directo (strip-types), así que se testea el
 * MISMO parser que usan el panel y el Mostrador (`src/lib/scale-barcode.ts`):
 * nada de una copia que pueda desincronizarse.
 *
 * Invariantes que vigila:
 *
 *   1. El parser lee el formato configurado (prefijo + PLU + valor + DV) y
 *      rechaza lo que no corresponde (largo, prefijo, DV, valor implausible).
 *   2. Peso en gramos, peso en kilos e importe, con decimales implícitos.
 *   3. `guessScaleLabelFormats` detecta el formato real de una etiqueta a
 *      partir de los PLU del catálogo.
 *   4. `readScaleLabelConfig` sanea basura y APAGADO es el default.
 *   5. Mostrador: ambas entradas (lector USB y cámara) usan el mismo resolver,
 *      la etiqueta entra como línea propia y el peso de la etiqueta no rebota
 *      con el múltiplo/mínimo de venta (skipWeightRules en las 3 rutas).
 *   6. El PLU se guarda en el producto (POST/PATCH) y la config se persiste.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEFAULT_SCALE_LABEL_CONFIG,
  fmtScaleKg,
  gtinCheckDigit,
  guessScaleLabelFormats,
  isValidGtin,
  normalizePlu,
  parseScaleLabel,
  readScaleLabelConfig,
  scaleLabelFormatSummary,
  scaleLabelLength,
} from "../src/lib/scale-barcode.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

/** Arma una etiqueta EAN-13 con DV GS1 real. */
function label({ prefix = "2", plu = "000123", value = "00750", dv = true } = {}) {
  const body = `${prefix}${plu}${value}`;
  return dv ? `${body}${gtinCheckDigit(body)}` : body;
}

const CFG_G = {
  enabled: true,
  prefix: "2",
  pluDigits: 6,
  valueDigits: 5,
  valueKind: "peso_g",
  decimals: 0,
  checkDigit: "validar",
};

// --- 1. Formato típico en gramos ---------------------------------------
{
  const code = label();
  const p = parseScaleLabel(code, CFG_G);
  check("gramos: código de 13 dígitos", code.length === 13, code);
  check("gramos: DV válido", isValidGtin(code));
  check("gramos: parsea", p != null);
  check("gramos: PLU normalizado", p?.plu === "123", p?.plu);
  check("gramos: PLU impreso", p?.pluRaw === "000123", p?.pluRaw);
  check("gramos: 750 g = 0,75 kg", p?.kg === 0.75, p?.kg);
  check("gramos: kind peso", p?.kind === "peso", p?.kind);
  check("fmtScaleKg: 0,750 kg", fmtScaleKg(0.75) === "0,750 kg", fmtScaleKg(0.75));
  check("resumen menciona 13 dígitos", scaleLabelFormatSummary(CFG_G).includes("13 dígitos"));
  check("scaleLabelLength = 13", scaleLabelLength(CFG_G) === 13);
}

// --- 2. Peso en kilos con decimales ------------------------------------
{
  const cfg = { ...CFG_G, valueKind: "peso_kg", valueDigits: 5, decimals: 3 };
  const p = parseScaleLabel(label({ value: "01324" }), cfg);
  check("kg: 1324 con 3 decimales = 1,324 kg", p?.kg === 1.324, p?.kg);
  check("kg: kind peso", p?.kind === "peso");
}

// --- 3. Importe --------------------------------------------------------
{
  const cfg = { ...CFG_G, valueKind: "importe", valueDigits: 5, decimals: 2 };
  const p = parseScaleLabel(label({ value: "01250" }), cfg);
  check("importe: 1250 con 2 decimales = $12,50", p?.amount === 12.5, p?.amount);
  check("importe: kind importe", p?.kind === "importe", p?.kind);
  check("importe: no inventa kg", p?.kg === null, p?.kg);
}

// --- 4. Rechazos -------------------------------------------------------
{
  const code = label();
  check("rechaza: DV roto", parseScaleLabel(code.slice(0, -1) + ((Number(code.slice(-1)) + 1) % 10), CFG_G) === null);
  check("rechaza: prefijo distinto", parseScaleLabel(label({ prefix: "3" }), CFG_G) === null);
  check("rechaza: largo distinto", parseScaleLabel(code.slice(0, -2), CFG_G) === null);
  check("rechaza: 0 kg", parseScaleLabel(label({ value: "00000" }), CFG_G) === null);
  check("rechaza: peso absurdo (99.999 kg)", parseScaleLabel(label({ value: "99999" }), CFG_G) === null);
  check("rechaza: texto vacío", parseScaleLabel("", CFG_G) === null);
  check("config nula usa el formato default (el switch lo decide el llamador)", parseScaleLabel(code, null)?.kg === 0.75);
  // Tolerancia del lector: un "0" extra delante (EAN-13 corto).
  const p = parseScaleLabel(`0${code}`, CFG_G);
  check("tolera el 0 que agrega el lector", p?.kg === 0.75, p?.kg);
  // DV ignorado: acepta un DV distinto.
  const badDv = code.slice(0, -1) + ((Number(code.slice(-1)) + 1) % 10);
  check(
    "DV ignorado: acepta DV distinto",
    parseScaleLabel(badDv, { ...CFG_G, checkDigit: "ignorar" }) != null
  );
  // Sin DV: 12 dígitos.
  const noDv = label({ dv: false });
  check(
    "sin DV: acepta 12 dígitos",
    parseScaleLabel(noDv, { ...CFG_G, checkDigit: "ninguno" })?.kg === 0.75
  );
}

// --- 5. Detección de formato ------------------------------------------
{
  const code = label({ prefix: "20", plu: "0012", value: "01250" });
  const found = guessScaleLabelFormats(code, ["12"]);
  check("detecta: encuentra al menos un formato", found.length > 0, found.length);
  const hit = found.find(
    (g) => g.config.prefix === "20" && g.config.pluDigits === 4 && g.config.valueKind === "peso_g"
  );
  check("detecta: acierta prefijo 20 / PLU 4 / gramos", hit != null);
  check("detecta: el PLU coincide con el catálogo", found.every((g) => normalizePlu(g.plu) === "12"));
  check("detecta: sin PLUs conocidos no adivina", guessScaleLabelFormats(code, []).length === 0);
  check("detecta: basura no adivina", guessScaleLabelFormats("abc", ["12"]).length === 0);
}

// --- 6. Config tolerante ---------------------------------------------
{
  const d = readScaleLabelConfig(null);
  check("config: apagado por default", d.enabled === false);
  check("config: prefix default 2", d.prefix === "2", d.prefix);
  check("config: PLU default 6", d.pluDigits === 6);
  check("config: valor default 5", d.valueDigits === 5);
  const junk = readScaleLabelConfig({
    enabled: true,
    prefix: "x2y9z",
    pluDigits: 99,
    valueDigits: -3,
    valueKind: "cualquiera",
    decimals: 12,
    checkDigit: "nada",
  });
  check("config: prefijo solo dígitos", junk.prefix === "29", junk.prefix);
  check("config: PLU capado a 8", junk.pluDigits === 8, junk.pluDigits);
  check("config: valor capado a 1", junk.valueDigits === 1, junk.valueDigits);
  check("config: tipo inválido al default", junk.valueKind === DEFAULT_SCALE_LABEL_CONFIG.valueKind);
  check("config: decimales capados a 3", junk.decimals === 3, junk.decimals);
  check("config: DV inválido al default", junk.checkDigit === DEFAULT_SCALE_LABEL_CONFIG.checkDigit);
  const bad = readScaleLabelConfig({ prefix: "" });
  check("config: sin prefijo vuelve al default", bad.prefix === DEFAULT_SCALE_LABEL_CONFIG.prefix);
}

// --- 7. Normalización de PLU -----------------------------------------
{
  check("PLU: 00123 ≡ 123", normalizePlu("00123") === "123");
  check("PLU: ceros → 0", normalizePlu("000") === "0");
  check("PLU: recorta espacios y mayúsculas", normalizePlu("  abc  ") === "ABC");
  check("PLU: vacío → vacío", normalizePlu("   ") === "");
}

// --- 8. Cableado en el código ----------------------------------------
{
  const mostrador = read("src/components/vendor/mostrador.tsx");
  check("mostrador: importa el parser", mostrador.includes("@/lib/scale-barcode"));
  check("mostrador: parsea etiquetas", mostrador.includes("parseScaleLabel("));
  check("mostrador: el escaneo usa resolveScanCode", mostrador.includes("resolveScanCode("));
  check(
    "mostrador: la cámara usa el mismo resolver (no duplica SKU)",
    /startScan[\s\S]{0,4000}resolveScanCode\(/.test(mostrador)
  );
  check("mostrador: etiqueta = línea propia", mostrador.includes("addLabelLine("));
  check("mostrador: badge de etiqueta", mostrador.includes("i.label"));
  check("mostrador: fallback de PLU a SKU", mostrador.includes("normalizePlu(p.sku)"));
  check("mostrador: alta rápida precarga el PLU", mostrador.includes("scalePlu: label.pluRaw"));
  check("mostrador: alta rápida manda scale_plu", mostrador.includes("scale_plu: qcScalePlu"));
  check("mostrador: snapshot offline guarda el formato", mostrador.includes("scaleLabelConfig:"));
  check("mostrador: scroll por clave de línea", mostrador.includes("data-kg-line="));

  const pos = read("src/app/api/vendor/pos/order/route.ts");
  const cons = read("src/app/api/vendor/pos/consumicion/route.ts");
  const close = read("src/app/api/vendor/tables/[id]/close/route.ts");
  check("pos/order: la balanza manda (skipWeightRules)", pos.includes("skipWeightRules: true"));
  check("pos/consumicion: la balanza manda", cons.includes("skipWeightRules: true"));
  check("tables/close: la balanza manda", close.includes("skipWeightRules: true"));

  const offers = read("src/app/api/vendor/offers/route.ts");
  const offerPatch = read("src/app/api/vendor/offers/[id]/route.ts");
  check("offers POST: acepta scale_plu", offers.includes("scale_plu"));
  check("offers POST: nombra la migración", offers.includes("migrate-scale-labels.sql"));
  check("offers PATCH: acepta scale_plu", offerPatch.includes("scale_plu"));
  check("offers PATCH: valida duplicados", offerPatch.includes("dupPlu"));

  const me = read("src/app/api/vendor/me/route.ts");
  check("me: persiste scale_label_config", me.includes("scale_label_config"));
  check("me: sanea con el parser", me.includes("readScaleLabelConfig("));

  const form = read("src/components/dashboard/shared.tsx");
  check("form producto: campo PLU", form.includes("offScalePlu"));
  const studio = read("src/components/dashboard/menu-studio.tsx");
  check("catálogo: manda scale_plu", studio.includes("scale_plu:"));
  const cfgCard = read("src/components/dashboard/scale-config-section.tsx");
  check("config: card de etiquetas", cfgCard.includes("Etiquetas con lector"));
  check("config: probador de etiqueta", cfgCard.includes("parseScaleLabel("));
  check("config: detección de formato", cfgCard.includes("guessScaleLabelFormats("));

  const offline = read("src/lib/offline-db.ts");
  check("offline-db: snapshot lleva el formato", offline.includes("scaleLabelConfig"));

  const sql = read("supabase/self-host/migrate-scale-labels.sql");
  check("migración: columna de config", sql.includes("scale_label_config"));
  check("migración: columna de PLU", sql.includes("scale_plu"));
  check("migración: índice único por comercio", sql.includes("products_vendor_scale_plu_uniq"));
}

console.log("");
if (failures > 0) {
  console.log(`${failures} chequeo(s) fallaron`);
  process.exit(1);
}
console.log("Etiquetas de balanza: todo ok");
