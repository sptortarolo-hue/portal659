/**
 * Forma del snapshot que consume la Pantalla TV.
 * Client-safe (solo tipos): lo comparten el loader del servidor y los
 * componentes del reproductor, así el preview del panel y la TV real
 * renderizan exactamente el mismo objeto.
 */

import type { TvConfig } from "./tv-config";

/** Ítem de carta ya formateado para la TV (precio como texto, badges listos). */
export type TvItem = {
  id: string;
  name: string;
  desc: string | null;
  /** "$1.500" (null si el config apaga los precios). */
  priceLabel: string | null;
  /** Precio de lista tachado cuando hay promo. */
  oldPriceLabel: string | null;
  /** "Hoy", "Combo", "-20%", "por kg"... */
  badge: string | null;
  imageUrl: string | null;
  /** Sin stock (se oculta o se atenúa según config). */
  soldOut: boolean;
};

export type TvSection = {
  id: string;
  name: string;
  items: TvItem[];
};

export type TvSnapshot = {
  /** Versión publicada: el SSE la compara para recargar la TV. */
  version: number;
  generatedAt: string;
  vendor: {
    name: string;
    logoUrl: string | null;
    /** Estado real del local (override gana). null = sin horarios cargados. */
    isOpen: boolean | null;
    hoursText: string | null;
    category: string | null;
    storeUrl: string;
  };
  config: TvConfig;
  /** Tema efectivo (puede venir de la franja horaria). */
  theme: string;
  daypartLabel: string | null;
  sections: TvSection[];
  hero: TvItem[];
};
