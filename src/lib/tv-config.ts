/**
 * Configuración de la Pantalla TV (carta digital en un televisor).
 *
 * Client-safe: NO importar nada de `pg` ni server-only desde acá. Este módulo
 * lo comparten el panel del comercio, el loader del snapshot y la pantalla.
 *
 * Guardar los cambios es "borrador" (`draft`): la TV solo ve el snapshot
 * `published` hasta que el comercio toca "Publicar". Los precios, nombres y
 * fotos NO se configuran acá: se leen del catálogo en vivo.
 */

export const TV_THEMES = ["barrio", "noche", "pizarra", "fresco"] as const;
export type TvTheme = (typeof TV_THEMES)[number];

/** Franja horaria (dayparting): desayuno / almuerzo / cena... */
export type TvDaypart = {
  id: string;
  label: string;
  /** "HH:MM" */
  from: string;
  /** "HH:MM" */
  to: string;
  /** Días de la semana (0 = domingo ... 6 = sábado). Vacío = todos los días. */
  days: number[];
  /** Categorías que se muestran en la franja (vacío = todas las visibles). */
  categoryIds: string[];
  /** Tema propio de la franja (vacío = el tema general de la pantalla). */
  theme: TvTheme | "";
};

export type TvPoster = {
  /** URL del archivo (imagen PNG/JPG o video MP4). */
  url: string;
  /** "image" | "video". */
  type: "image" | "video";
  /** Segundos que se muestra (video: se ignora, se reproduce completo). */
  durationSec: number;
};

export type TvConfig = {
  theme: TvTheme;
  columns: 2 | 3 | 4;
  slideSeconds: 6 | 10 | 15 | 20;
  showPrices: boolean;
  showDescriptions: boolean;
  hideSoldOut: boolean;
  showClock: boolean;
  showQr: boolean;
  photoStyle: "none" | "thumb";
  hero: {
    mode: "auto" | "manual";
    productIds: string[];
    /** Cambiar el destacado solo cada `seconds` (si hay 2+ ofertas). */
    rotate: boolean;
    /** Segundos que dura cada oferta en el banner. */
    seconds: number;
  };
  upsell: { enabled: boolean; text: string; productId: string | null };
  ticker: { enabled: boolean; text: string };
  /** Categorías visibles y su orden (por nombre canónico de vendor_categories). */
  categories: Array<{ id: string; visible: boolean }>;
  dayparts: TvDaypart[];
  /** Pantalla de "volvemos a las X" cuando el local está cerrado. */
  closedScreen: boolean;
  footerText: string;
  /**
   * Posters publicitarios: imágenes o videos que se intercalan entre las
   * slides de la carta (promos, combos, eventos). Se leen del catálogo de
   * uploads; la TV los muestra a pantalla completa durante `durationSec`.
   */
  posters: TvPoster[];
  /**
   * QR de pedidos online: pantalla completa con el QR para pedir desde el
   * celular. Se intercala como una slide más de la rotación y también puede
   * sumarse a la pantalla de "local cerrado". `mode` decide cuándo aparece:
   * "siempre" (abierto y cerrado), "abierto" o "cerrado".
   */
  qr: { enabled: boolean; mode: "siempre" | "abierto" | "cerrado"; seconds: number };
};

export const DEFAULT_TV_CONFIG: TvConfig = {
  theme: "barrio",
  columns: 3,
  slideSeconds: 10,
  showPrices: true,
  showDescriptions: true,
  hideSoldOut: true,
  showClock: true,
  showQr: false,
  photoStyle: "thumb",
  hero: { mode: "auto", productIds: [], rotate: true, seconds: 10 },
  upsell: { enabled: false, text: "", productId: null },
  ticker: { enabled: false, text: "" },
  categories: [],
  dayparts: [],
  closedScreen: true,
  footerText: "",
  posters: [],
  qr: { enabled: false, mode: "siempre", seconds: 12 },
};

/** Valores aceptados por el editor (para selects y normalización). */
export const TV_LAYOUT_CHOICES = [
  { label: "2 columnas", columns: 2 as const, hint: "Menús chicos y letra grande" },
  { label: "3 columnas", columns: 3 as const, hint: "Equilibrado (recomendado)" },
  { label: "4 columnas", columns: 4 as const, hint: "Cartas largas, letra más chica" },
];

const SLIDE_SECONDS = [6, 10, 15, 20];
const DAYS_OK = [0, 1, 2, 3, 4, 5, 6];

/** "09:00" o "9" -> "09:00". Devuelve "" si no se puede interpretar. */
export function normClock(value: unknown): string {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return "";
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = m[2] ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function isTvConfig(value: unknown): value is TvConfig {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normaliza lo que viene del panel a un TvConfig válido. Nunca lanza: todo el
 * campo desconocido o mal formado cae al default. Es la única puerta de
 * escritura de `draft`/`published` para que la TV nunca reciba basura.
 */
export function normalizeTvConfig(input: unknown): TvConfig {
  // `raw` es "lo que vino del panel": se lee campo por campo con fallback, y
  // cualquier forma desconocida cae al default (nunca lanza).
  const raw = (isTvConfig(input) ? input : {}) as Partial<TvConfig> & Record<string, unknown>;
  const num = (v: unknown, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  const str = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);

  const theme: TvTheme =
    TV_THEMES.includes(raw.theme as TvTheme) ? (raw.theme as TvTheme) : DEFAULT_TV_CONFIG.theme;
  const columns: 2 | 3 | 4 = [2, 3, 4].includes(Number(raw.columns)) ? (Number(raw.columns) as 2 | 3 | 4) : 3;
  const slideSeconds = SLIDE_SECONDS.includes(Number(raw.slideSeconds))
    ? (Number(raw.slideSeconds) as TvConfig["slideSeconds"])
    : 10;
  const photoStyle = raw.photoStyle === "none" ? "none" : "thumb";

  const asObj = (v: unknown) => (isTvConfig(v) ? v : {}) as Record<string, unknown>;
  const heroRaw = asObj(raw.hero);
  const heroIds = Array.isArray(heroRaw.productIds)
    ? heroRaw.productIds.filter((x: unknown) => typeof x === "string" && x).slice(0, 4)
    : [];
  // Rotación del banner: tolerante (el draft viejo no tiene estos campos).
  const heroRotate = typeof heroRaw.rotate === "boolean" ? heroRaw.rotate : DEFAULT_TV_CONFIG.hero.rotate;
  const heroSecondsRaw = Number(heroRaw.seconds);
  const heroSeconds = Number.isFinite(heroSecondsRaw) && heroSecondsRaw > 0
    ? Math.min(60, Math.max(5, Math.round(heroSecondsRaw)))
    : DEFAULT_TV_CONFIG.hero.seconds;

  const upsellRaw = asObj(raw.upsell);
  const tickerRaw = asObj(raw.ticker);

  // QR de pedidos online: tolerante (el draft viejo no lo trae).
  const qrRaw = asObj(raw.qr);
  const qrMode: TvConfig["qr"]["mode"] =
    qrRaw.mode === "abierto" || qrRaw.mode === "cerrado" ? qrRaw.mode : "siempre";
  const qrSecRaw = Number(qrRaw.seconds);
  const qrSeconds = Number.isFinite(qrSecRaw) && qrSecRaw > 0
    ? Math.min(60, Math.max(5, Math.round(qrSecRaw)))
    : DEFAULT_TV_CONFIG.qr.seconds;

  const categories = Array.isArray(raw.categories)
    ? raw.categories
        .map((c: unknown) => {
          const cr = asObj(c);
          return { id: str(cr.id, ""), visible: bool(cr.visible, true) };
        })
        .filter((c: { id: string }) => !!c.id)
    : [];

  const dayparts = Array.isArray(raw.dayparts)
    ? raw.dayparts
        .map((d: unknown) => {
          const dr = asObj(d);
          const days = Array.isArray(dr.days)
            ? (dr.days.map((x: unknown) => Number(x)).filter((x: number) => DAYS_OK.includes(x)) as number[])
            : [];
          const ids = Array.isArray(dr.categoryIds)
            ? (dr.categoryIds.filter((x: unknown) => typeof x === "string" && x) as string[])
            : [];
          const dt: TvDaypart = {
            id: str(dr.id, Math.random().toString(36).slice(2, 9)),
            label: str(dr.label, "Franja").slice(0, 40),
            from: normClock(dr.from) || "00:00",
            to: normClock(dr.to) || "23:59",
            days,
            categoryIds: ids,
            theme: TV_THEMES.includes(dr.theme as TvTheme) ? (dr.theme as TvTheme) : "",
          };
          return dt;
        })
        .slice(0, 6)
    : [];

  const posters = Array.isArray(raw.posters)
    ? raw.posters
        .map((p: unknown) => {
          const pr = asObj(p);
          const url = str(pr.url, "").trim();
          if (!url) return null;
          const type: TvPoster["type"] = pr.type === "video" ? "video" : "image";
          const dur = Number(pr.durationSec);
          const durationSec = Number.isFinite(dur) && dur > 0 ? Math.min(60, Math.max(3, Math.round(dur))) : 5;
          return { url, type, durationSec };
        })
        .filter((p): p is TvPoster => !!p)
        .slice(0, 20)
    : [];

  return {
    theme,
    columns,
    slideSeconds,
    showPrices: bool(raw.showPrices, true),
    showDescriptions: bool(raw.showDescriptions, true),
    hideSoldOut: bool(raw.hideSoldOut, true),
    showClock: bool(raw.showClock, true),
    showQr: bool(raw.showQr, false),
    photoStyle,
    hero: {
      mode: heroRaw.mode === "manual" ? "manual" : "auto",
      productIds: heroIds,
      rotate: heroRotate,
      seconds: heroSeconds,
    },
    upsell: {
      enabled: bool(upsellRaw.enabled, false),
      text: str(upsellRaw.text, "").slice(0, 90),
      productId: typeof upsellRaw.productId === "string" && upsellRaw.productId ? upsellRaw.productId : null,
    },
    ticker: {
      enabled: bool(tickerRaw.enabled, false),
      text: str(tickerRaw.text, "").slice(0, 140),
    },
    categories,
    dayparts,
    closedScreen: bool(raw.closedScreen, true),
    footerText: str(raw.footerText, "").slice(0, 120),
    posters,
    qr: { enabled: bool(qrRaw.enabled, false), mode: qrMode, seconds: qrSeconds },
  };
}

/**
 * Une la configuración publicada de la pantalla con las categorías reales del
 * comercio: las que faltan se agregan visibles, las que ya no existen salen,
 * y el orden lo manda el comercio.
 */
export function mergeScreenCategories(base: TvConfig, categoryNames: string[]): TvConfig {
  const wanted = new Map(base.categories.map((c, i) => [c.id, { id: c.id, visible: c.visible, i }]));
  const ordered: Array<{ id: string; visible: boolean }> = [];
  const known = new Set<string>();
  for (const name of categoryNames) {
    known.add(name);
    const hit = wanted.get(name);
    ordered.push({ id: name, visible: hit ? hit.visible : true });
  }
  // Categorías borradas del comercio: se descartan del config (no ensucian).
  return { ...base, categories: ordered };
}

/** Minutos desde medianoche para comparar franjas. */
export function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":");
  const hh = parseInt(h, 10);
  const mm = parseInt(m, 10);
  return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
}

/**
 * Resuelve la configuración efectiva para un momento dado (dayparting):
 * si la franja aplica, se usan sus categorías/tema y se devuelve su id.
 * Determinista y sin `Date`: el horario lo pasa el servidor o el cliente.
 */
export function resolveDaypart(
  config: TvConfig,
  at: { day: number; minutes: number }
): { config: TvConfig; daypartId: string | null; label: string | null } {
  const hit = config.dayparts.find((dp) => {
    const daysOk = dp.days.length === 0 || dp.days.includes(at.day);
    if (!daysOk) return false;
    const nowM = at.minutes;
    const from = clockToMinutes(dp.from);
    const to = clockToMinutes(dp.to);
    // Franjas que cruzan medianoche ("22:00" -> "02:00").
    return from <= to ? nowM >= from && nowM < to : nowM >= from || nowM < to;
  });

  if (!hit) return { config, daypartId: null, label: null };
  if (hit.categoryIds.length === 0 && !hit.theme) {
    return { config, daypartId: hit.id, label: hit.label };
  }
  const visible = new Map(config.categories.map((c) => [c.id, c.visible]));
  return {
    config: {
      ...config,
      theme: hit.theme || config.theme,
      categories: hit.categoryIds.length
        ? hit.categoryIds.map((id) => ({ id, visible: visible.get(id) ?? true }))
        : config.categories,
    },
    daypartId: hit.id,
    label: hit.label,
  };
}
