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
  /** Fondo del lienzo: gradiente + halos (da profundidad, no color plano). */
  bgGrad: string;
  /** Halo del acento (manchas de luz suave). */
  glow: string;
  /** Halo secundario (contraste de temperatura). */
  glow2: string;
  /** Fondo del chip de precio. */
  priceBg: string;
  /** Tinta del chip de precio (contrasta con priceBg). */
  priceChipInk: string;
  /** Scrim fuerte para texto sobre foto (hero). */
  scrimStrong: string;
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
    bgGrad:
      "radial-gradient(1100px 620px at 8% -12%, rgba(163,230,51,0.22), transparent 62%)," +
      "radial-gradient(900px 520px at 102% -6%, rgba(99,102,241,0.14), transparent 58%)," +
      "linear-gradient(180deg, #FFFDF7 0%, #F6F1E6 100%)",
    glow: "rgba(163,230,51,0.20)",
    glow2: "rgba(99,102,241,0.14)",
    priceBg: "#101623",
    priceChipInk: "#FFFDF7",
    scrimStrong: "linear-gradient(100deg, rgba(10,14,24,0.92) 0%, rgba(10,14,24,0.74) 46%, rgba(10,14,24,0.28) 100%)",
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
    bgGrad:
      "radial-gradient(1200px 680px at 6% -14%, rgba(163,230,51,0.18), transparent 60%)," +
      "radial-gradient(1000px 600px at 104% 4%, rgba(56,189,248,0.16), transparent 56%)," +
      "linear-gradient(180deg, #0B1020 0%, #070A15 100%)",
    glow: "rgba(163,230,51,0.16)",
    glow2: "rgba(56,189,248,0.14)",
    priceBg: "#A3E633",
    priceChipInk: "#101623",
    scrimStrong: "linear-gradient(100deg, rgba(4,7,16,0.94) 0%, rgba(4,7,16,0.76) 48%, rgba(4,7,16,0.24) 100%)",
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
    bgGrad:
      "radial-gradient(1000px 620px at 4% -10%, rgba(255,209,102,0.16), transparent 60%)," +
      "radial-gradient(900px 540px at 98% 2%, rgba(52,211,153,0.12), transparent 56%)," +
      "linear-gradient(180deg, #1E2A24 0%, #16201B 100%)",
    glow: "rgba(255,209,102,0.14)",
    glow2: "rgba(52,211,153,0.12)",
    priceBg: "#FFD166",
    priceChipInk: "#1E2A24",
    scrimStrong: "linear-gradient(100deg, rgba(8,14,11,0.94) 0%, rgba(8,14,11,0.74) 48%, rgba(8,14,11,0.22) 100%)",
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
    bgGrad:
      "radial-gradient(1000px 600px at 2% -12%, rgba(52,211,153,0.22), transparent 60%)," +
      "radial-gradient(900px 540px at 100% 0%, rgba(125,211,252,0.18), transparent 56%)," +
      "linear-gradient(180deg, #F7FBF4 0%, #E9F3EA 100%)",
    glow: "rgba(52,211,153,0.18)",
    glow2: "rgba(125,211,252,0.16)",
    priceBg: "#0E5C45",
    priceChipInk: "#F0FFF7",
    scrimStrong: "linear-gradient(100deg, rgba(6,24,17,0.92) 0%, rgba(6,24,17,0.74) 46%, rgba(6,24,17,0.26) 100%)",
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
    "--tv-bg-grad": t.bgGrad,
    "--tv-glow": t.glow,
    "--tv-glow-2": t.glow2,
    "--tv-price-bg": t.priceBg,
    "--tv-price-ink": t.priceChipInk,
    "--tv-scrim-strong": t.scrimStrong,
  };
}

/** Familia tipográfica del tablero (alta altura de x, pesos marcados). */
export const TV_FONT =
  'Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, Arial, sans-serif';

/** Familia para precios: números tabulares, sin ligaduras raras. */
export const TV_FONT_NUM =
  'Segoe UI Variable Display, Segoe UI, system-ui, Arial, sans-serif';
