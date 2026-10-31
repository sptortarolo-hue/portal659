/**
 * Motor de layout de la Pantalla TV.
 *
 * Puro y determinista (sin `Date`, sin `Math.random`, sin medir el DOM): la
 * misma carta + la misma configuración produce SIEMPRE las mismas slides.
 * Reglas que sigue (aprendidas de los tableros de QSR tipo McDonald's):
 *
 *  - Nada de scroll: si no entra, se PAGINA en slides que rotan solas.
 *  - Cada ítem aparece exactamente una vez (ni repetido ni perdido).
 *  - Nunca se recorta texto: las alturas se ESTIMAN y, si la estimación se
 *    pasa del alto disponible, el ítem pasa a la columna/slide siguiente.
 *  - Área segura: el contenido vive dentro de 1728×972 del lienzo de 1920×1080
 *    (márgenes de 96px H / 54px V = 90% "title-safe"), el fondo sangra al borde.
 *
 * Client-safe: este archivo no importa nada (ni tipos del repo) para poder
 * correrlo también desde el script de verificación con Node.
 */

/** Lienzo de referencia (1080p) y área segura de texto. */
export const TV_CANVAS = { w: 1920, h: 1080, safeX: 96, safeY: 54 } as const;

/** Escala tipográfica a 1080p, por distancia de lectura (ver guías de signage). */
export const TV_TYPE = {
  brand: 56,
  category: 72,
  item: 44,
  price: 44,
  desc: 30,
  meta: 26,
} as const;

/** Alturas usadas por el modelo de estimación (px a 1080p). */
const HDR = Math.round(TV_TYPE.category * 1.25) + 24; // bloque de categoría
const GUTTER = 32; // espacio entre columnas
const PRICE_W = 280; // columna reservada del precio (alineada a la derecha)
const CHAR_NAME = 0.53; // ancho medio de carácter / tamaño de fuente (nombres)
const CHAR_DESC = 0.5;
const PAD_ITEM = 18; // 9 arriba + 9 abajo
const GAP_ITEM = 14; // aire entre ítems
const NAME_LH = Math.round(TV_TYPE.item * 1.1);
const DESC_LH = Math.round(TV_TYPE.desc * 1.35);
const THUMB = 96; // alto mínimo de fila con foto

export type TvItemRef = {
  id: string;
  name: string;
  desc: string | null;
  hasPhoto: boolean;
};

export type TvSectionInput = {
  id: string;
  name: string;
  items: TvItemRef[];
};

export type TvColumn = {
  sectionId: string;
  sectionName: string;
  /** true si la categoría sigue en la columna siguiente. */
  continued: boolean;
  itemIds: string[];
};

export type TvPosterRef = {
  url: string;
  type: "image" | "video";
  durationSec: number;
};

export type TvSlide = {
  columns: TvColumn[];
  /** Si está presente, la slide es un poster a pantalla completa (sin columnas). */
  poster?: TvPosterRef | null;
};

export type BuildSlidesInput = {
  sections: TvSectionInput[];
  columns: number;
  /** Ancho útil del área de contenido (ya descontados los márgenes). */
  width: number;
  /** Alto útil del área de contenido. */
  height: number;
  photoStyle: "none" | "thumb";
  showDescriptions: boolean;
  /** Posters a intercalar entre las slides de la carta. */
  posters?: TvPosterRef[];
  /** Cada cuántas slides se intercala un poster (default 3). */
  posterEvery?: number;
};

function textLines(text: string, charW: number, fontSize: number, width: number): number {
  const chars = Math.max(6, Math.floor(width / (charW * fontSize)));
  // Aproximación conservadora: divide por chars y redondea hacia arriba.
  return Math.max(1, Math.ceil(text.length / chars));
}

/**
 * Altura estimada de una fila. Es conservadora a propósito: sobrestimar mete
 * menos ítems por columna (se ve más grande), nunca recorta.
 */
export function estimateItemHeight(
  item: TvItemRef,
  colWidth: number,
  photoStyle: "none" | "thumb",
  showDescriptions: boolean
): number {
  const nameW = Math.max(240, colWidth - PRICE_W - 40);
  const lines = textLines(item.name || "", CHAR_NAME, TV_TYPE.item, nameW);
  let h = PAD_ITEM + lines * NAME_LH;
  if (showDescriptions && item.desc && item.desc.trim()) {
    const dl = textLines(item.desc.trim(), CHAR_DESC, TV_TYPE.desc, Math.max(200, colWidth - 40));
    h += Math.min(dl, 2) * DESC_LH + 6;
  }
  if (photoStyle === "thumb") h = Math.max(h, THUMB + PAD_ITEM);
  return h + GAP_ITEM;
}

/** Ancho de cada columna con el gutter. */
export function columnWidth(width: number, columns: number): number {
  return Math.floor((width - GUTTER * Math.max(0, columns - 1)) / Math.max(1, columns));
}

/**
 * Página de columnas: reparte las categorías en `columns` columnas del alto
 * disponible. Si sobra contenido, se empaqueta en slides sucesivos.
 */
export function packColumns(
  sections: TvSectionInput[],
  columns: number,
  width: number,
  height: number,
  photoStyle: "none" | "thumb",
  showDescriptions: boolean
): TvSlide[] {
  const n = Math.max(1, Math.min(6, Math.floor(columns) || 1));
  const colW = columnWidth(width, n);
  const heightOf = (item: TvItemRef) =>
    estimateItemHeight(item, colW, photoStyle, showDescriptions);

  const slides: TvSlide[] = [];
  let cols: TvColumn[] = [];
  let used = 0;
  let cur: TvColumn | null = null;

  /** Cierra la columna actual; `leftover` marca si la categoría sigue. */
  const closeColumn = (leftover: boolean) => {
    if (cur) cur.continued = leftover;
    cur = null;
    used = 0;
  };

  for (const section of sections) {
    if (section.items.length === 0) continue;
    let i = 0;
    while (i < section.items.length) {
      const item = section.items[i];
      const h = heightOf(item);
      const column: TvColumn | null = cur;
      const needsHeader = column === null || column.sectionId !== section.id;
      const need = (needsHeader ? HDR : 0) + h;

      if (column && used + need <= height) {
        column.itemIds.push(item.id);
        used += h;
        i += 1;
        continue;
      }

      // No entra en la columna actual: se cierra (con "continúa" si quedaba
      // algo de esta categoría) y el ítem se ubica en una columna nueva.
      closeColumn(needsHeader ? false : true);
      if (cols.length >= n) {
        slides.push({ columns: cols });
        cols = [];
      }
      const col: TvColumn = {
        sectionId: section.id,
        sectionName: section.name,
        continued: false,
        itemIds: [],
      };
      cols.push(col);
      cur = col;
      used = HDR;
      // Columna nueva y vacía: el ítem entra SIEMPRE (evita loop infinito y
      // garantiza que no se pierda; la estimación es conservadora, así que
      // esto solo pasa con nombres absurdamente largos).
      col.itemIds.push(item.id);
      used += h;
      i += 1;
    }
  }

  if (cols.length > 0) slides.push({ columns: cols });
  return slides.filter((s) => s.columns.some((c) => c.itemIds.length > 0));
}

/** Todas las slides de la pantalla (wrapper cómodo para el player). */
export function buildSlides(input: BuildSlidesInput): TvSlide[] {
  const width = TV_CANVAS.w - TV_CANVAS.safeX * 2;
  const menuSlides = packColumns(
    input.sections,
    input.columns,
    input.width ?? width,
    input.height,
    input.photoStyle,
    input.showDescriptions
  );
  const posters = (input.posters || []).filter((p) => !!p?.url);
  if (posters.length === 0) return menuSlides;
  const every = Math.max(1, Math.floor(input.posterEvery || 3));
  const out: TvSlide[] = [];
  let p = 0;
  menuSlides.forEach((s, i) => {
    if (i > 0 && i % every === 0 && p < posters.length) {
      out.push({ columns: [], poster: posters[p++] });
    }
    out.push(s);
  });
  while (p < posters.length) out.push({ columns: [], poster: posters[p++] });
  return out;
}

/** Escala para meter el lienzo de 1920×1080 en el viewport del TV. */
export function scaleForViewport(vw: number, vh: number): number {
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return 0.1;
  return Math.min(vw / TV_CANVAS.w, vh / TV_CANVAS.h);
}

/** Invariantes para tests/scripts: cada ítem una sola vez, nada perdido. */
export function auditSlides(
  slides: TvSlide[],
  sections: TvSectionInput[]
): { ok: boolean; missing: string[]; duplicated: string[] } {
  const seen = new Map<string, number>();
  for (const slide of slides) {
    for (const col of slide.columns) {
      for (const id of col.itemIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  const expected = new Set<string>();
  for (const s of sections) for (const it of s.items) expected.add(it.id);
  const missing: string[] = [];
  for (const id of expected) if (!seen.has(id)) missing.push(id);
  const duplicated: string[] = [];
  for (const [id, n] of seen) if (n > 1) duplicated.push(id);
  for (const id of seen.keys()) if (!expected.has(id)) duplicated.push(id);
  return { ok: missing.length === 0 && duplicated.length === 0, missing, duplicated };
}
