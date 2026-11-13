/**
 * Verificación del motor del cartel imprimible con QR (sin dependencias).
 * Corre con: node scripts/check-cartel.ts
 *
 * Comprueba:
 *   1. la paleta del cartel coincide con VERTICALS (src/lib/config.ts);
 *   2. hay copy para todos los verticales × los dos destinos;
 *   3. los tamaños mm ↔ px (150 dpi) son consistentes y el 2×2 entra en A4;
 *   4. el destino automático manda a los servicios al micrositio;
 *   5. el QR usa zona de silencio y corrección de errores altas;
 *   6. el resumen de horarios y el teléfono salen bien.
 */
import {
  CARTEL_PALETTE,
  CARTEL_QR,
  CARTEL_SIZES,
  cartelCopy,
  cartelHoursSummary,
  cartelPalette,
  cartelPhone,
  cartelRubro,
  cartelTarget,
  cartelTargetUrl,
  isCartelServiceVertical,
} from "../src/lib/cartel.ts";
import { VERTICALS } from "../src/lib/config.ts";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
  }
};

console.log("\n1) Paleta del cartel vs VERTICALS");
for (const v of VERTICALS) {
  const p = CARTEL_PALETTE[v.slug];
  check(
    `${v.slug}: hex/emoji/nombre en sync`,
    !!p && p.hex === v.hex && p.emoji === v.emoji && p.name === v.name,
    { config: { hex: v.hex, emoji: v.emoji, name: v.name }, cartel: p }
  );
}
check("vertical desconocido cae en 'otro'", cartelPalette("no-existe").hex === CARTEL_PALETTE.otro.hex);

console.log("\n2) Copy por vertical × destino");
const targets = ["carta", "tienda"] as const;
for (const v of [...VERTICALS.map((x) => x.slug), "otro"]) {
  for (const t of targets) {
    const c = cartelCopy(v, t);
    check(
      `${v}/${t}: título + bajada + 3 pasos + badge`,
      !!c.title &&
        !!c.subtitle &&
        c.steps.length === 3 &&
        c.steps.every((s) => !!s.full && !!s.short) &&
        (c.badge === null || typeof c.badge === "string"),
      c
    );
  }
}
check("servicios → el badge '0% comisión' no aparece en la carta de mesa", cartelCopy("gastronomia", "carta").badge !== "0% comisión");
check("micrositio gastro → badge 0% comisión", cartelCopy("gastronomia", "tienda").badge === "0% comisión");

console.log("\n3) Tamaños (mm ↔ px a 150 dpi)");
for (const s of CARTEL_SIZES) {
  const expectW = Math.round((s.pageWmm / 25.4) * 150);
  const expectH = Math.round((s.pageHmm / 25.4) * 150);
  check(
    `${s.id}: ${s.pageWmm}×${s.pageHmm}mm ≈ ${s.pxW}×${s.pxH}px (150dpi)`,
    Math.abs(s.pxW - expectW) <= 1 && Math.abs(s.pxH - expectH) <= 1,
    { expect: [expectW, expectH], got: [s.pxW, s.pxH] }
  );
}
const sheet = CARTEL_SIZES.find((s) => s.id === "hoja2x2");
check(
  "la hoja 2×2 son 4 stickers dentro de una A4",
  !!sheet && sheet.sheet?.cols === 2 && sheet.sheet?.rows === 2 && sheet.pageWmm === 210 && sheet.pageHmm === 297
);
check("el sticker 10×15 es compacto", CARTEL_SIZES.find((s) => s.id === "sticker")?.compact === true);
check("A4 y A5 llevan el cartel completo", !CARTEL_SIZES.find((s) => s.id === "a4")?.compact && !CARTEL_SIZES.find((s) => s.id === "a5")?.compact);

console.log("\n4) Destino del QR");
check("servicio → micrositio por defecto", cartelTarget("servicio", null) === "tienda");
check("estetica → micrositio por defecto", cartelTarget("estetica", null) === "tienda");
check("taller → micrositio por defecto", cartelTarget("taller", null) === "tienda");
check("salud → micrositio por defecto", cartelTarget("salud", null) === "tienda");
check("gastronomia → carta de mesa por defecto", cartelTarget("gastronomia", null) === "carta");
check("comercio → carta de mesa por defecto", cartelTarget("comercio", null) === "carta");
check("moda → carta de mesa por defecto", cartelTarget("moda", null) === "carta");
check("lo elegido por el comercio gana", cartelTarget("gastronomia", "tienda") === "tienda");
check("un valor inválido cae al automático", cartelTarget("servicio", "cualquiera") === "tienda");
check("isCartelServiceVertical", isCartelServiceVertical("taller") && !isCartelServiceVertical("gastronomia"));
check(
  "URL de la carta de mesa",
  cartelTargetUrl("pepita", "carta", "https://www.portal659.com.ar/") === "https://www.portal659.com.ar/carta/pepita"
);
check(
  "URL del micrositio",
  cartelTargetUrl("pepita", "tienda", "https://www.portal659.com.ar") === "https://www.portal659.com.ar/tienda/pepita"
);

console.log("\n5) QR");
check("zona de silencio ≥ 2 módulos", CARTEL_QR.margin >= 2, CARTEL_QR.margin);
check("corrección de errores alta (H)", CARTEL_QR.errorCorrectionLevel === "H");
check("se genera a 1200px (impresión limpia)", CARTEL_QR.width >= 1000);

console.log("\n6) Datos del local");
check(
  "horarios: mismo rango agrupado",
  cartelHoursSummary("lun: 09:00-18:00, mar: 09:00-18:00, mie: 09:00-18:00, jue: 09:00-18:00, vie: 09:00-18:00, sab: 10:00-14:00") ===
    "Lun–Vie 09:00–18:00 · Sáb 10:00–14:00",
  cartelHoursSummary("lun: 09:00-18:00, mar: 09:00-18:00, mie: 09:00-18:00, jue: 09:00-18:00, vie: 09:00-18:00, sab: 10:00-14:00")
);
check("horarios: 24 hs", cartelHoursSummary("24hs") === "Abierto 24 hs");
check("horarios: sin datos → null", cartelHoursSummary(null) === null);
check("horarios: texto desconocido se devuelve crudo", cartelHoursSummary("consultar") === "consultar");
check(
  "teléfono con 0 y 9",
  cartelPhone("1122334455") === "+54 9 11 2233-4455",
  cartelPhone("1122334455")
);
check("teléfono vacío → null", cartelPhone("") === null);
check("rubro genérico → null", cartelRubro("otros") === null);
check("rubro con mayúscula", cartelRubro("peluquería") === "Peluquería");

console.log("");
if (failures > 0) {
  console.error(`✗ ${failures} comprobaciones fallaron\n`);
  process.exit(1);
}
console.log("✓ Cartel: todas las comprobaciones ok\n");
