/**
 * Rotaciones de la Pantalla TV: qué ocupa el "destacado" en cada vista.
 *
 * Puro y determinista (sin `Date`, sin `Math.random`): el reproductor y el
 * script de verificación comparten estas funciones, así las invariantes se
 * pueden auditar sin renderizar nada.
 *
 * El QR de "Pedí online" es un DESTACADO más de la rotación:
 *  - en el diseño clásico rota en el banner superior (plantilla ancha);
 *  - en el diseño split rota en la columna 9:16 de la izquierda (plantilla
 *    vertical), alternando con el destacado del comercio y sus posters.
 *
 * Antes el QR era una slide suelta intercalada en la carta: se perdía entre
 * las slides de producto. Como destacado tiene el lugar prominente de la
 * pantalla, que es donde el cliente mira primero.
 */

/** Slot del banner de destacados (vista clásica). */
export type HeroSlot =
  | { kind: "product"; index: number }
  | { kind: "qr"; index: number };

/**
 * Rotación del banner clásico.
 *
 * @param productCount cuántos destacados de producto hay.
 * @param qrOn si el QR de pedidos online está disponible (lo generó el server).
 * @param rotate si el comercio apagó la rotación, el producto queda fijo
 *   (pero el QR sigue apareciendo: es otro tipo de contenido).
 */
export function buildHeroSlots(productCount: number, qrOn: boolean, rotate = true): HeroSlot[] {
  const n = Math.max(0, Math.floor(productCount) || 0);
  const products = rotate ? n : Math.min(n, 1);
  const out: HeroSlot[] = [];
  for (let i = 0; i < products; i++) out.push({ kind: "product", index: i });
  if (qrOn) out.push({ kind: "qr", index: out.length });
  return out;
}

/** Slot de la columna 9:16 (vista split). */
export type ColumnSlot =
  | { kind: "hero"; index: number }
  | { kind: "poster"; index: number }
  | { kind: "qr"; index: number };

/**
 * Rotación de la columna del split: el destacado del comercio, sus posters
 * verticales y (si hay QR) el QR de pedidos online.
 */
export function buildColumnSlots(posterCount: number, qrOn: boolean): ColumnSlot[] {
  const out: ColumnSlot[] = [{ kind: "hero", index: 0 }];
  const n = Math.max(0, Math.floor(posterCount) || 0);
  for (let i = 0; i < n; i++) out.push({ kind: "poster", index: i });
  if (qrOn) out.push({ kind: "qr", index: out.length });
  return out;
}

export type RotationSeconds = {
  /** Segundos de cada destacado de producto (config.hero.seconds). */
  heroSeconds: number;
  /** Segundos del QR (config.qr.seconds). */
  qrSeconds: number;
  /** Segundos de cada poster vertical (config.posters[].durationSec). */
  posterSeconds?: number[];
};

/** Cuánto dura un slot del banner clásico. */
export function heroSlotSeconds(slot: HeroSlot, opts: RotationSeconds): number {
  if (slot.kind === "qr") return Math.max(1, Math.round(opts.qrSeconds));
  return Math.max(1, Math.round(opts.heroSeconds));
}

/** Cuánto dura un slot de la columna del split. */
export function columnSlotSeconds(slot: ColumnSlot, opts: RotationSeconds): number {
  if (slot.kind === "qr") return Math.max(1, Math.round(opts.qrSeconds));
  if (slot.kind === "poster") {
    const d = opts.posterSeconds?.[slot.index];
    return Math.max(1, Math.round(d ?? 5));
  }
  return Math.max(1, Math.round(opts.heroSeconds));
}

/**
 * Los próximos slots de la rotación (para los chips "qué viene después" del
 * banner). Devuelve el rótulo de cada uno: los productos con su precio y el
 * QR con su propio cartel.
 */
export function nextSlotLabels(
  slots: HeroSlot[],
  from: number,
  count: number,
  products: { name: string; priceLabel: string | null }[]
): { label: string; priceLabel: string | null }[] {
  const out: { label: string; priceLabel: string | null }[] = [];
  if (slots.length === 0) return out;
  for (let k = 1; k <= count; k++) {
    const slot = slots[(from + k) % slots.length];
    if (!slot) continue;
    if (slot.kind === "qr") {
      out.push({ label: "📱 Pedí online", priceLabel: null });
      continue;
    }
    const item = products[slot.index];
    if (item) out.push({ label: item.name, priceLabel: item.priceLabel });
  }
  return out;
}

/** Modos del QR ("Cuándo mostrarlo" en el editor). */
export type QrMode = "siempre" | "abierto" | "cerrado";

/**
 * ¿El QR aparece como DESTACADO con el local abierto?
 *  - "siempre" → sí (destacado + pantalla de cerrado)
 *  - "abierto" → sí (solo en el destacado)
 *  - "cerrado" → no (solo en la pantalla de local cerrado)
 */
export function qrInHighlight(mode: QrMode | undefined): boolean {
  return mode === "siempre" || mode === "abierto";
}

/**
 * ¿El QR aparece en la pantalla de local cerrado?
 *  - "siempre" → sí
 *  - "abierto" → no (solo en el destacado, con el local abierto)
 *  - "cerrado" → sí
 */
export function qrInClosedScreen(mode: QrMode | undefined): boolean {
  return mode === "siempre" || mode === "cerrado";
}
