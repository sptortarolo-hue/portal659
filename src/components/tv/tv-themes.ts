/**
 * Temas de la Pantalla TV.
 *
 * Tokens visuales aplicados como CSS custom properties sobre el lienzo: así el
 * mismo diseño se ve coherente en las 4 latitudes (claro/noche/pizarra/fresco)
 * sin depender de la paleta de Tailwind ni de safelist de clases dinámicas.
 *
 * Reglas que se respetan siempre (de las guías de legibilidad en signage):
 *  - nunca #000 ni #FFF puros (en TV "sangran" y encandilan);
 *  - contraste alto para texto y precios; el acento fuerte solo en chips/badges
 *    con tinta oscura arriba;
 *  - números tabulares y alineados a la derecha (los precios se comparan).
 */

import type { TvTheme } from "@/lib/tv-config";

export type TvThemeTokens = {
  bg: string;
  fg: string;
  muted: string;
  card: string;
  line: string;
  /** Acento (chips, precios destacados, barra de progreso). */
  accent: string;
  /** Tinta para texto sobre el acento. */
  accentInk: string;
  /** Tinta de precios. */
  priceInk: string;
  /** Gradiente de fondo (scrim para fotos). */
  scrim: string;
};

export const TV_THEME_TOKENS: Record<TvTheme, TvThemeTokens> = {
  // Claro cálido: el default del portal (ink sobre hueso).
  barrio: {
    bg: "#FFFDF7",
    fg: "#101623",
    muted: "#5A6478",
    card: "#FFFFFF",
    line: "#E7E3DA",
    accent: "#A3E633",
    accentInk: "#101623",
    priceInk: "#101623",
    scrim: "rgba(16,22,35,0.06)",
  },
  // Oscuro: el que se ve mejor en un local con poca luz.
  noche: {
    bg: "#0B1020",
    fg: "#F5F7FA",
    muted: "#A6B0C3",
    card: "#141A2E",
    line: "#243049",
    accent: "#A3E633",
    accentInk: "#101623",
    priceInk: "#E9FBFF",
    scrim: "rgba(245,247,250,0.06)",
  },
  // Pizarra: para bares/confiterías que quieren el estilo de menú pintado.
  pizarra: {
    bg: "#1E2A24",
    fg: "#F2F0E6",
    muted: "#B8C2B4",
    card: "#26352D",
    line: "#3A4A40",
    accent: "#FFD166",
    accentInk: "#1E2A24",
    priceInk: "#FFD166",
    scrim: "rgba(242,240,230,0.06)",
  },
  // Fresco: verdulería, heladería, dietéticas.
  fresco: {
    bg: "#F7FBF4",
    fg: "#12211A",
    muted: "#4C6157",
    card: "#FFFFFF",
    line: "#DCE9D8",
    accent: "#34D399",
    accentInk: "#04231A",
    priceInk: "#0E5C45",
    scrim: "rgba(18,33,26,0.05)",
  },
};

export const TV_THEME_LABELS: Record<TvTheme, string> = {
  barrio: "Barrio",
  noche: "Noche",
  pizarra: "Pizarra",
  fresco: "Fresco",
};

/** Miniatura (dos colores) para el selector del panel. */
export const TV_THEME_SWATCH: Record<TvTheme, { bg: string; fg: string; accent: string }> = {
  barrio: { bg: "#FFFDF7", fg: "#101623", accent: "#A3E633" },
  noche: { bg: "#0B1020", fg: "#F5F7FA", accent: "#A3E633" },
  pizarra: { bg: "#1E2A24", fg: "#F2F0E6", accent: "#FFD166" },
  fresco: { bg: "#F7FBF4", fg: "#12211A", accent: "#34D399" },
};

/** Variables CSS del tema, para aplicar con `style={...}` en el lienzo. */
export function themeVars(theme: TvTheme): Record<string, string> {
  const t = TV_THEME_TOKENS[theme] ?? TV_THEME_TOKENS.barrio;
  return {
    "--tv-bg": t.bg,
    "--tv-fg": t.fg,
    "--tv-muted": t.muted,
    "--tv-card": t.card,
    "--tv-line": t.line,
    "--tv-accent": t.accent,
    "--tv-accent-ink": t.accentInk,
    "--tv-price": t.priceInk,
    "--tv-scrim": t.scrim,
  };
}

/** Familia tipográfica del tablero (alta altura de x, pesos marcados). */
export const TV_FONT =
  'Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, Arial, sans-serif';

/** Familia para precios: números tabulares, sin ligaduras raras. */
export const TV_FONT_NUM =
  'Segoe UI Variable Display, Segoe UI, system-ui, Arial, sans-serif';
