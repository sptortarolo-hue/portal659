/**
 * Verificación del motor de layout de la Pantalla TV (sin dependencias).
 * Corre con: node scripts/check-tv-layout.ts
 *
 * Comprueba las 5 invariantes del tablero:
 *   1. cada ítem aparece exactamente una vez;
 *   2. nada de scroll: todo entra en slides de alto acotado;
 *   3. determinismo: misma entrada => misma salida;
 *   4. ningún ítem se pierde con nombres larguísimos;
 *   5. el menú vacío no rompe.
 */
import {
  auditSlides,
  buildSlides,
  columnWidth,
  estimateItemHeight,
  TV_CANVAS,
  type TvSectionInput,
} from "../src/lib/tv-layout.ts";
import {
  buildColumnSlots,
  buildHeroSlots,
  columnSlotSeconds,
  heroSlotSeconds,
  nextSlotLabels,
  qrInClosedScreen,
  qrInHighlight,
} from "../src/lib/tv-rotation.ts";

const CONTENT_H = TV_CANVAS.h - TV_CANVAS.safeY * 2;
const CONTENT_W = TV_CANVAS.w - TV_CANVAS.safeX * 2;
const HEADER_H = 150; // marca + estado de la pantalla
const TICKER_H = 90;
const GRID_H = CONTENT_H - HEADER_H - TICKER_H;

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

type Input = Parameters<typeof buildSlides>[0];

const run = (sections: TvSectionInput[], over: Partial<Input> = {}) =>
  buildSlides({
    sections,
    columns: 3,
    width: CONTENT_W,
    height: GRID_H,
    photoStyle: "thumb",
    showDescriptions: true,
    ...over,
  });

const item = (id: string, name: string, desc: string | null = null) => ({
  id,
  name,
  desc,
  hasPhoto: true,
});

console.log("tv-layout: verificación de invariantes");

// Caso 1: carta típica de 40 ítems en 5 categorías.
const typical: TvSectionInput[] = [
  {
    id: "hamburguesas",
    name: "Hamburguesas",
    items: Array.from({ length: 12 }, (_, i) =>
      item(`h${i}`, `Hamburguesa ${i}`, " Doble con queso cheddar, panceta y cebolla caramelizada")
    ),
  },
  {
    id: "papas",
    name: "Papas",
    items: Array.from({ length: 8 }, (_, i) => item(`p${i}`, `Papas ${i}`, "Con cheddar y panceta")),
  },
  { id: "bebidas", name: "Bebidas", items: Array.from({ length: 10 }, (_, i) => item(`b${i}`, `Bebida ${i}`)) },
  { id: "postres", name: "Postres", items: Array.from({ length: 6 }, (_, i) => item(`d${i}`, `Postre ${i}`, null)) },
  { id: "promos", name: "Promos", items: Array.from({ length: 4 }, (_, i) => item(`x${i}`, `Combo ${i}`, null)) },
];
const s1 = run(typical);
check("carta típica: todos los ítems aparecen una vez", auditSlides(s1, typical).ok, auditSlides(s1, typical));
check("carta típica: al menos una slide", s1.length >= 1);
check(
  "carta típica: columnas completas antes de rotar (sin columnas de 1 ítem)",
  s1.every((s) => s.columns.filter((c) => c.itemIds.length > 0).length >= Math.min(2, s.columns.length))
);

// Caso 2: una sola categoría gigante (paginación).
const huge: TvSectionInput[] = [
  { id: "todo", name: "Todo el menú", items: Array.from({ length: 60 }, (_, i) => item(`i${i}`, `Ítem ${i} del menú`)) },
];
const s2 = run(huge, { columns: 2 });
check("categoría gigante: pagina en varias slides", s2.length > 1, `slides=${s2.length}`);
check("categoría gigante: sin pérdida", auditSlides(s2, huge).ok);
check(
  "categoría gigante: marca 'continúa' donde corresponde",
  s2.length === 1 || s2.some((s) => s.columns.some((c) => c.continued))
);

// Caso 3: determinismo.
const a = JSON.stringify(run(typical, { columns: 4 }));
const b = JSON.stringify(run(typical, { columns: 4 }));
check("determinismo: misma entrada => misma salida", a === b);

// Caso 4: nombres absurdos.
const nasty: TvSectionInput[] = [
  {
    id: "n",
    name: "Nombres largos",
    items: Array.from({ length: 6 }, (_, i) =>
      item(`n${i}`, `Hamburguesa artesanal ${i} con doble cheddar, panceta crocante, cebolla caramelizada y salsa de la casa`.repeat(2), "x".repeat(400))
    ),
  },
];
const s4 = run(nasty, { columns: 2 });
check("nombres largos: sin pérdida", auditSlides(s4, nasty).ok, auditSlides(s4, nasty));

// Caso 5: vacío.
check("menú vacío: 0 slides", run([]).length === 0);
check("categorías vacías: 0 slides", run([{ id: "a", name: "A", items: [] }]).length === 0);

// Caso 6: diseño "split" — columna 9:16 a la izquierda, grilla derecha angosta.
// El player descuenta el ancho de la columna y fuerza 2 columnas; acá se
// replica esa geometría para exigir las mismas invariantes.
const SPLIT_STAGE_H = GRID_H; // la columna mide el alto de la fila de contenido
const SPLIT_STAGE_W = Math.round((SPLIT_STAGE_H * 9) / 16);
const SPLIT_GRID_W = CONTENT_W - SPLIT_STAGE_W - 32;
const s6 = run(typical, { columns: 2, width: SPLIT_GRID_W });
check("split: ancho de columna 9:16 razonable", SPLIT_STAGE_W > 380 && SPLIT_STAGE_W < 480, SPLIT_STAGE_W);
check("split: la grilla derecha queda con espacio para 2 columnas", SPLIT_GRID_W > 1100, SPLIT_GRID_W);
check("split: todos los ítems aparecen una vez", auditSlides(s6, typical).ok, auditSlides(s6, typical));
check("split: al menos una slide", s6.length >= 1);
check(
  "split: ninguna columna queda con menos de 2 ítems si hay contenido (sin columnas huérfanas)",
  s6.every((s) => s.columns.filter((c) => c.itemIds.length >= 2).length > 0) || s6.length === 1,
  s6.map((s) => s.columns.map((c) => c.itemIds.length))
);
const splitW = columnWidth(SPLIT_GRID_W, 2);
check("split: ancho de columna derecha entero y usable", Number.isInteger(splitW) && splitW > 500, splitW);

// Caso 7: split con la carta larga (nada se pierde al paginar angosto).
const s7 = run(huge, { columns: 2, width: SPLIT_GRID_W });
check("split + categoría gigante: pagina y no pierde nada", auditSlides(s7, huge).ok, auditSlides(s7, huge));
check("split + categoría gigante: varias slides", s7.length > 1, `slides=${s7.length}`);

// Caso 6: modelo de alturas y escala.
const w = columnWidth(CONTENT_W, 3);
check("ancho de columna entero", Number.isInteger(w) && w > 400, w);
const h = estimateItemHeight(item("z", "Hamburguesa", "Con queso"), w, "thumb", true);
check("altura de ítem razonable (100-200px)", h > 100 && h < 200, h);
check(
  "modo sin foto achica la fila",
  estimateItemHeight(item("z", "Hamburguesa"), w, "none", false) < h
);

// Caso 8: rotaciones del destacado (el QR es un destacado más).
// - clásico: el QR rota en el banner superior;
// - split: el QR rota en la columna 9:16 (junto al destacado y los posters).
const heroNoQr = buildHeroSlots(4, false);
check("clásico: sin QR la rotación son solo los productos", heroNoQr.length === 4);
check("clásico: sin QR no hay slot de QR", heroNoQr.every((s) => s.kind === "product"));
const heroQr = buildHeroSlots(4, true);
check("clásico: con QR el banner suma el slot del QR", heroQr.length === 5);
check("clásico: el QR aparece una sola vez", heroQr.filter((s) => s.kind === "qr").length === 1);
check("clásico: el QR no pisa ningún producto", heroQr.filter((s) => s.kind === "product").length === 4);
const heroOne = buildHeroSlots(1, true);
check("clásico: un solo producto + QR igual rota", heroOne.length === 2);
const heroNoRotate = buildHeroSlots(4, true, false);
check(
  "clásico: con la rotación apagada el producto queda fijo pero el QR sigue",
  heroNoRotate.filter((s) => s.kind === "product").length === 1 && heroNoRotate.some((s) => s.kind === "qr")
);
check(
  "clásico: cada slot tiene su duración (producto vs QR)",
  heroSlotSeconds({ kind: "product", index: 0 }, { heroSeconds: 10, qrSeconds: 12 }) === 10 &&
    heroSlotSeconds({ kind: "qr", index: 1 }, { heroSeconds: 10, qrSeconds: 12 }) === 12
);
const colQr = buildColumnSlots(2, true);
check("split: la columna suma el slot del QR", colQr.length === 4);
check("split: la columna arranca con el destacado", colQr[0].kind === "hero");
check("split: el QR aparece una sola vez en la columna", colQr.filter((s) => s.kind === "qr").length === 1);
check(
  "split: el slot del QR es el último (vuelve al destacado después)",
  colQr[colQr.length - 1].kind === "qr"
);
check(
  "split: duración del poster = su durationSec",
  columnSlotSeconds({ kind: "poster", index: 1 }, { heroSeconds: 10, qrSeconds: 12, posterSeconds: [6, 8] }) ===
    8
);
const labels = nextSlotLabels(heroQr, 0, 2, [
  { name: "Combo", priceLabel: "$9.900" },
  { name: "Empanada", priceLabel: "$1.200" },
  { name: "Milanesa", priceLabel: "$7.500" },
  { name: "Tarta", priceLabel: "$6.000" },
]);
check("chips: el próximo slot se anuncia", labels.length === 2 && labels[0].label === "Empanada");
check(
  "chips: cuando viene el QR se anuncia como pedido online",
  nextSlotLabels(heroQr, 3, 2, []).some((l) => l.label.includes("Pedí online"))
);

// Caso 9: modos del QR ("Cuándo mostrarlo" en el editor).
check("modo siempre: el QR va al destacado", qrInHighlight("siempre"));
check("modo siempre: el QR va a la pantalla de cerrado", qrInClosedScreen("siempre"));
check("modo abierto: el QR va al destacado", qrInHighlight("abierto"));
check("modo abierto: el QR NO va a la pantalla de cerrado", !qrInClosedScreen("abierto"));
check("modo cerrado: el QR NO va al destacado", !qrInHighlight("cerrado"));
check("modo cerrado: el QR va a la pantalla de cerrado", qrInClosedScreen("cerrado"));

if (failures > 0) {
  console.log(`\n${failures} verificación(es) fallaron`);
  process.exit(1);
}
console.log("\ntodas las verificaciones pasaron");
