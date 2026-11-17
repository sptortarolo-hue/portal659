/**
 * Verificación de la etiqueta adhesiva (productos por unidad y pesables).
 * Corre con: node scripts/check-label-spec.mjs
 *
 * Node 24 ejecuta el TypeScript directo (strip-types): se testea el MISMO
 * código que usa la UI, el servidor y la impresión:
 *   - src/lib/label-spec.ts      (layout + códigos + formato + config)
 *   - src/lib/scale-barcode.ts   (formato de la etiqueta de balanza)
 *   - src/lib/code128.ts         (guarda contra desincronización de tablas)
 *
 * Invariantes:
 *   1. Config tolerante (default, basura, clamp).
 *   2. CODE128 local == CODE128 de src/lib/code128.ts (tabla duplicada).
 *   3. EAN-13: 95 módulos y DV GS1 correcto.
 *   4. buildScaleLabelDigits → parseScaleLabel (round-trip peso/importe):
 *      lo que imprime el portal lo lee el Mostrador.
 *   5. El layout respeta los límites del rollo: nada fuera del canvas, el
 *      código gana el módulo más grande disponible y hay fallback a número.
 *   6. Formato de moneda/kilos/fechas (coma decimal argentina).
 *   7. wrapText/measureTextPx nunca devuelven una línea más ancha que su caja.
 */
import {
  DEFAULT_LABEL_PRINTER_CONFIG,
  addDaysISO,
  arISODate,
  buildLabelSpec,
  buildScaleLabelDigits,
  code128ModuleCount,
  code128Runs,
  ean13ModuleCount,
  ean13Runs,
  fmtKg,
  fmtMoney,
  fmtDateShort,
  gtinCheckDigit,
  labelPixelSize,
  measureTextPx,
  readLabelPrinterConfig,
  wrapText,
} from "../src/lib/label-spec.ts";
import { code128BarWidths } from "../src/lib/code128.ts";
import {
  gtinCheckDigit as gtinCheckDigitScale,
  parseScaleLabel,
  readScaleLabelConfig,
} from "../src/lib/scale-barcode.ts";

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    console.error(`  ✘ ${name}`);
    failures++;
  }
}

console.log("Etiqueta adhesiva — check de invariantes\n");

// ── 1. Config ─────────────────────────────────────────────────────────────
console.log("config:");
{
  const def = readLabelPrinterConfig(undefined);
  check("default apagado", def.enabled === false);
  check("default 50x30", def.size === "50x30" && def.widthMm === 50 && def.heightMm === 30);
  check("default plantilla envasado", def.tpl === "envasado");
  check("default lenguaje auto", def.language === "auto");
  check("basura → default", readLabelPrinterConfig("%%%").enabled === false);
  check("jsonb como texto", readLabelPrinterConfig('{"enabled":true,"size":"58x40"}').widthMm === 58);
  check("tamaño inválido → clamp", readLabelPrinterConfig({ size: "custom", widthMm: 999, heightMm: 1 }).widthMm === 76);
  check("shelf null tolerado", readLabelPrinterConfig({ shelfLifeDays: 15 }).shelfLifeDays === 15);
  check("shelf basura → null", readLabelPrinterConfig({ shelfLifeDays: -5 }).shelfLifeDays === null);
}

// ── 2. CODE128 duplicado == code128.ts ─────────────────────────────────────
console.log("\ncódigo 128:");
{
  for (const code of ["7791234567890", "128", "ABC-123", "000128", "P-AB12CD34EF"]) {
    const ours = code128Runs(code);
    const theirs = code128BarWidths(code);
    check(
      `mismo ancho total para "${code}"`,
      ours && theirs && ours.reduce((s, w) => s + w, 0) === theirs.reduce((s, w) => s + w, 0)
    );
    check(
      `misma cantidad de módulos (${code})`,
      code128ModuleCount(code) === theirs.reduce((s, w) => s + w, 0)
    );
  }
}

// ── 3. EAN-13 ──────────────────────────────────────────────────────────────
console.log("\nEAN-13:");
{
  const digits = "7791234567890";
  const runs = ean13Runs(digits);
  check("13 dígitos → grilla", !!runs);
  check("95 módulos útiles", ean13ModuleCount(digits) === 95);
  check("largo de carrera coherente", runs.reduce((s, w) => s + w, 0) === 95);
  check("dígitos inválidos → null", ean13Runs("123") === null);
  check("module count para inválido", ean13ModuleCount("123") === null);
}

// ── 4. Round-trip buildScaleLabelDigits → parseScaleLabel ───────────────────
console.log("\nround-trip balanza:");
{
  const cfg = readScaleLabelConfig({
    enabled: true,
    prefix: "2",
    pluDigits: 6,
    valueDigits: 5,
    valueKind: "peso_g",
    decimals: 0,
    checkDigit: "validar",
  });
  const digits = buildScaleLabelDigits({ plu: "128", kg: 0.75, amount: 1375 }, cfg);
  check("se generan 13 dígitos", digits && digits.length === 13);
  check("prefijo respetado", digits.startsWith("2"));
  const parsed = digits ? parseScaleLabel(digits, cfg) : null;
  check("el Mostrador lee el PLU", parsed?.plu === "128");
  check("el Mostrador lee 0,750 kg", parsed?.kg === 0.75);

  const importeCfg = readScaleLabelConfig({ ...cfg, valueKind: "importe", decimals: 2 });
  const importeDigits = buildScaleLabelDigits({ plu: "128", kg: null, amount: 123.45 }, importeCfg);
  const importeParsed = importeDigits ? parseScaleLabel(importeDigits, importeCfg) : null;
  check("modo importe: importe round-trip", importeParsed?.amount === 123.45);
  check(
    "modo importe: importe fuera de dígitos → null",
    buildScaleLabelDigits({ plu: "128", kg: null, amount: 123456.78 }, importeCfg) === null
  );

  const kgCfg = readScaleLabelConfig({ ...cfg, valueKind: "peso_kg", decimals: 3 });
  const kgDigits = buildScaleLabelDigits({ plu: "128", kg: 1.25, amount: null }, kgCfg);
  const kgParsed = kgDigits ? parseScaleLabel(kgDigits, kgCfg) : null;
  check("modo peso_kg round-trip", kgParsed?.kg === 1.25);

  check("PLU demasiado largo → null", buildScaleLabelDigits({ plu: "12345678", kg: 1 }, cfg) === null);
  check("peso 0 → null", buildScaleLabelDigits({ plu: "128", kg: 0 }, cfg) === null);
  check("misma tabla de DV que scale-barcode", gtinCheckDigit("20001280075") === gtinCheckDigitScale("20001280075"));
}

// ── 5. Layout dentro de los límites del rollo ───────────────────────────────
console.log("\nlayout:");
{
  const content = {
    template: "envasado",
    storeName: "Almacén Don Pedro",
    productName: "Queso cremoso de campo, cortado a cuchillo",
    plu: "128",
    unit: "kg",
    price: 12000,
    oldPrice: null,
    kg: 0.75,
    total: 9000,
    packedAt: "2026-11-17",
    expiresAt: "2026-11-24",
    code: "7791234567890",
  };
  for (const size of ["40x30", "50x30", "58x40"]) {
    const cfg = readLabelPrinterConfig({ size, enabled: true, language: "tspl" });
    const { widthPx, heightPx } = labelPixelSize(cfg);
    const expected = size === "40x30" ? [320, 240] : size === "50x30" ? [400, 240] : [464, 320];
    check(`${size}: píxeles`, widthPx === expected[0] && heightPx === expected[1]);
    const spec = buildLabelSpec(content, cfg, { scaleFormat: null });
    check(`${size}: hay operaciones`, spec.ops.length > 6);
    const outOfBounds = spec.ops.some((op) => {
      if (op.kind === "text") return op.y < 0 || op.y > heightPx || op.x < -2 || op.x > widthPx;
      if (op.kind === "rect") return op.x < 0 || op.y < 0 || op.x + op.w > widthPx || op.y + op.h > heightPx;
      if (op.kind === "bars") return op.x < -1 || op.x + op.runs.reduce((s, r) => s + r, 0) * op.module > widthPx + 1 || op.y + op.h > heightPx;
      return false;
    });
    check(`${size}: nada fuera del rollo`, !outOfBounds);
    check(`${size}: código con módulo ≥ 2 px`, spec.barcode.module >= 2);
    check(`${size}: barras o número presente`, spec.barcode.symbology !== "none");
  }

  // Góndola
  const gond = readLabelPrinterConfig({ size: "50x30", enabled: true, tpl: "gondola" });
  const gondContent = {
    template: "gondola",
    storeName: "Almacén Don Pedro",
    productName: "Yerba mate elaborada Arrozal",
    brand: "Arrozal",
    plu: null,
    unit: "unidad",
    price: 4500,
    oldPrice: 5200,
    kg: null,
    total: 4500,
    packedAt: null,
    expiresAt: null,
    code: "7790001234567",
  };
  const gondSpec = buildLabelSpec(gondContent, gond, {});
  check("góndola: precio y código presentes", gondSpec.ops.some((op) => op.kind === "text" && op.text.includes("4.500")));
  check("góndola: hay barras o número", gondSpec.barcode.symbology !== "none");

  // Ancho mínimo para EAN-13 vs Code128 (40mm: EAN podría apretarse)
  const cfg40 = readLabelPrinterConfig({ size: "40x30", enabled: true });
  const spec40 = buildLabelSpec(content, cfg40, { scaleFormat: null });
  check("40x30: barcode resuelto", spec40.barcode.symbology !== "none");
}

// ── 6. Formato ───────────────────────────────────────────────────────────────
console.log("\nformato:");
{
  check("fmtMoney completo", fmtMoney(9000) === "$9000,00" || fmtMoney(9000) === "$9.000,00");
  check("fmtMoney miles", fmtMoney(1234567.5) === "$1.234.567,50");
  check("fmtMoney negativo", fmtMoney(-1200).startsWith("-"));
  check("fmtKg coma decimal", fmtKg(0.75) === "0,750 kg");
  check("fmtKg inválido", fmtKg(null) === "—");
  check("fmtDateShort", fmtDateShort("2026-11-17") === "17/11/26");
  check("fmtDateShort inválido", fmtDateShort("ayer") === "");
  check("addDaysISO", addDaysISO("2026-11-17", 7) === "2026-11-24");
  check("addDaysISO cruza mes", addDaysISO("2026-11-30", 1) === "2026-12-01");
  check("arISODate formato", /^\d{4}-\d{2}-\d{2}$/.test(arISODate(new Date("2026-11-17T03:00:00Z"))));
}

// ── 7. wrapText / measureTextPx ──────────────────────────────────────────────
console.log("\ntexto:");
{
  const lines = wrapText("Queso cremoso de campo cortado a cuchillo en horma entera", 20, 200, 2);
  check("wrapText respeta maxLines", lines.length <= 2);
  for (const ln of lines) {
    check(`wrapText línea dentro de caja ("${ln}")`, measureTextPx(ln, 20) <= 200 + 1);
  }
  const long = wrapText("SUPERCALIFRAGILISTICOEXPIALIDOCIOSOQUEESUNAPALABRA", 18, 160, 2);
  check("palabra larguisima se parte", long.length <= 2 && measureTextPx(long[0], 18) <= 160 + 1);
  check("measureTextPx monótono", measureTextPx("mmmm", 20) > measureTextPx("iiii", 20));
}

console.log("");
if (failures > 0) {
  console.error(`✘ ${failures} invariante(s) rota(s)`);
  process.exit(1);
}
console.log("✔ Todas las invariantes de la etiqueta adhesiva se cumplen.");
