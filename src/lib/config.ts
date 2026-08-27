export type Zone = {
  slug: string;
  name: string;
  neighborhoods: string[];
  active: boolean;
};

/** Nombre de la cookie donde se guarda la zona seleccionada. */
export const ZONE_COOKIE = "portal659-zone";

export const ZONES: Zone[] = [
  {
    slug: "sicardi-garibaldi",
    name: "Sicardi y Garibaldi",
    neighborhoods: ["sicardi", "garibaldi"],
    active: true,
  },
  {
    slug: "arana",
    name: "Arana",
    neighborhoods: ["arana"],
    active: false,
  },
  {
    slug: "correas",
    name: "Correas",
    neighborhoods: ["correas"],
    active: false,
  },
];

/** Zonas visibles/activas para el selector. */
export const ACTIVE_ZONES = ZONES.filter((z) => z.active);

export const DEFAULT_ZONE: Zone = ZONES[0];

export const ZONE = {
  slug: DEFAULT_ZONE.slug,
  name: DEFAULT_ZONE.name,
  slugs: DEFAULT_ZONE.neighborhoods,
} as const;

export const VERTICALS = [
  {
    slug: "gastronomia",
    name: "Gastronomía",
    description: "Rotiserías, pizzerías y comida casera del barrio",
    emoji: "🍽️",
    color: "vert-gastro",
    hex: "#ff6b4a",
  },
  {
    slug: "comercio",
    name: "Comercio del Barrio",
    description: "Almacenes, verdulerías, carnicerías, kioscos, librerías, ferreterías, floristerías, pet shops, veterinarias y todo lo que se vende cerca",
    emoji: "🏪",
    color: "vert-comercio",
    hex: "#10b981",
  },
  {
    slug: "servicio",
    name: "Servicios",
    description: "Oficios y profesionales que atienden en el barrio",
    emoji: "🔧",
    color: "vert-servicio",
    hex: "#0ea5e9",
  },
  {
    slug: "moda",
    name: "Ropa y Accesorios",
    description: "Indumentaria, calzado, bijouterie y accesorios",
    emoji: "👗",
    color: "vert-moda",
    hex: "#8b5cf6",
  },
  {
    slug: "salud",
    name: "Salud y Bienestar",
    description: "Farmacia, peluquería, estética y más",
    emoji: "💊",
    color: "vert-salud",
    hex: "#ec4899",
  },
] as const;