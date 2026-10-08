import { queryMany } from "@/lib/db";
import { isStoreOpen } from "@/lib/open-hours";

// ---------------------------------------------------------------------------
// Ranking de comercios (home por vertical + /buscar sin query).
// Cascada: Destacado > Abierto > Oferta hoy > Boost nuevo > Rating >
// Pedidos > novedad. Los gaps son grandes a propósito: ningún volumen
// realista de reseñas o pedidos rompe el escalón superior.
// ---------------------------------------------------------------------------

/** Peso por escalón (ver cascada arriba). */
export const RANK_FEATURED = 10000;
export const RANK_OPEN = 1000;
export const RANK_OPEN_UNKNOWN = 500;
export const RANK_OFFER_TODAY = 100;
export const RANK_NEW_BOOST = 30;

/** Días desde el alta durante los que un comercio nuevo recibe impulso. */
export const NEW_BOOST_DAYS = 14;
/** Ventana de pedidos que cuenta como prueba social. */
export const RANK_ORDERS_WINDOW_DAYS = 30;

export type VendorRankStats = {
  /** Pedidos no cancelados ni de prueba en la ventana. */
  orders30d: number;
  /** Promedio 1-5 (igual que el que muestra la tienda: todas las reseñas). */
  ratingAvg: number | null;
  ratingCount: number;
  /** Tiene al menos un producto con oferta hoy. */
  hasOfferToday: boolean;
};

export type RankableVendor = {
  id: string;
  featured?: boolean | null;
  created_at?: string | Date | null;
  hours?: string | null;
  open_override?: boolean | null;
};

const EMPTY_STATS: VendorRankStats = {
  orders30d: 0,
  ratingAvg: null,
  ratingCount: 0,
  hasOfferToday: false,
};

/** Puntaje de un comercio. Puro y determinista (testeable sin DB). */
export function scoreVendor(
  v: RankableVendor,
  stats?: VendorRankStats | null,
  now: Date = new Date()
): number {
  const s = stats || EMPTY_STATS;
  let score = 0;

  // 1) Destacado (manual/admin o futuro pago): siempre primero.
  if (v.featured === true) score += RANK_FEATURED;

  // 2) Abierto ahora: un cerrado arriba es un clic muerto. Sin datos de
  // horario, punto medio (no se lo premia ni se lo entierra).
  const open = isStoreOpen({ hours: v.hours ?? null, open_override: v.open_override ?? null });
  if (open === true) score += RANK_OPEN;
  else if (open === null || open === undefined) score += RANK_OPEN_UNKNOWN;

  // 3) Oferta hoy.
  if (s.hasOfferToday) score += RANK_OFFER_TODAY;

  // 4) Boost de local nuevo (solo si está abierto: no se impulsa un
  // comercio que el vecino no puede usar en este momento).
  const created = v.created_at ? new Date(v.created_at).getTime() : NaN;
  if (open === true && Number.isFinite(created)) {
    const ageDays = (now.getTime() - created) / 86400000;
    if (ageDays >= 0 && ageDays < NEW_BOOST_DAYS) score += RANK_NEW_BOOST;
  }

  // 5) Rating ponderado por volumen: 5.0 con 2 reseñas no le gana a 4.7
  // con 60 (log10 suaviza a los gigantes).
  if (s.ratingCount > 0 && (s.ratingAvg || 0) > 0) {
    score += Number(s.ratingAvg) * Math.log10(1 + s.ratingCount);
  }

  // 6) Prueba social: pedidos recientes (misma escala aprox. que rating).
  if (s.orders30d > 0) score += Math.log10(1 + s.orders30d) * 2;

  return score;
}

/** Ordena una lista por score (desc). Desempate: más nuevo primero. */
export function rankVendors<T extends RankableVendor>(
  list: T[],
  statsById?: Record<string, VendorRankStats> | null,
  now: Date = new Date()
): T[] {
  return [...list]
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const diff = scoreVendor(b.v, statsById?.[b.v.id], now) - scoreVendor(a.v, statsById?.[a.v.id], now);
      if (diff !== 0) return diff;
      const ca = a.v.created_at ? new Date(a.v.created_at).getTime() : 0;
      const cb = b.v.created_at ? new Date(b.v.created_at).getTime() : 0;
      if (cb !== ca) return cb - ca;
      return a.i - b.i;
    })
    .map(({ v }) => v);
}

type OrdersRow = { vendor_id: string; n: string };
type ReviewsRow = { vendor_id: string; avg: string; n: string };
type OfferRow = { vendor_id: string };

/**
 * Stats de ranking por vendor en 3 queries agregadas. Tolerante: si la DB
 * falla, devuelve vacío y el orden cae a destacado/apertura/novedad.
 */
export async function fetchRankStats(vendorIds: string[]): Promise<Record<string, VendorRankStats>> {
  const out: Record<string, VendorRankStats> = {};
  if (!vendorIds || vendorIds.length === 0) return out;
  const put = (id: string, patch: Partial<VendorRankStats>) => {
    out[id] = { ...(out[id] || EMPTY_STATS), ...patch };
  };
  try {
    const [orders, reviews, offers] = await Promise.all([
      queryMany<OrdersRow>(
        `SELECT vendor_id, COUNT(*) AS n FROM orders
          WHERE vendor_id = ANY($1)
            AND created_at >= now() - ($2 || ' days')::interval
            AND status <> 'cancelled'
            AND COALESCE(is_preview, false) = false
          GROUP BY vendor_id`,
        [vendorIds, String(RANK_ORDERS_WINDOW_DAYS)]
      ),
      queryMany<ReviewsRow>(
        `SELECT vendor_id, AVG(rating)::float AS avg, COUNT(*) AS n FROM reviews
          WHERE vendor_id = ANY($1)
          GROUP BY vendor_id`,
        [vendorIds]
      ),
      queryMany<OfferRow>(
        `SELECT DISTINCT vendor_id FROM products
          WHERE vendor_id = ANY($1) AND featured_today = true AND available = true`,
        [vendorIds]
      ),
    ]);
    for (const r of orders || []) put(r.vendor_id, { orders30d: Number(r.n) || 0 });
    for (const r of reviews || []) {
      put(r.vendor_id, { ratingAvg: r.avg != null ? Number(r.avg) : null, ratingCount: Number(r.n) || 0 });
    }
    for (const r of offers || []) put(r.vendor_id, { hasOfferToday: true });
  } catch {
    // Sin stats: el score usa destacado/apertura/novedad (best-effort).
  }
  return out;
}
