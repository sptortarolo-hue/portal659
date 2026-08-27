export type Neighborhood = {
  slug: string;
  name: string;
  active: boolean;
};

/** Nombre de la cookie donde se guarda el barrio seleccionado. */
export const ZONE_COOKIE = "portal659-zone";

export const NEIGHBORHOODS: Neighborhood[] = [
  { slug: "sicardi", name: "Sicardi", active: true },
  { slug: "garibaldi", name: "Garibaldi", active: true },
  { slug: "arana", name: "Arana", active: false },
  { slug: "correas", name: "Correas", active: false },
];

/** Barrios visibles/activos para el selector de zona. */
export const ACTIVE_NEIGHBORHOODS = NEIGHBORHOODS.filter((n) => n.active);

export const ZONE = {
  slugs: ACTIVE_NEIGHBORHOODS.map((n) => n.slug),
  name: ACTIVE_NEIGHBORHOODS.map((n) => n.name).join(" y "),
} as const;

export const DEFAULT_NEIGHBORHOOD = {
  slug: "sicardi",
  name: "Sicardi",
};

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
    description: "Almacenes, verdulerías, carnicerías, kioscos y todo lo que se vende cerca",
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
    description: "Farmacia, peluquería, estética, veterinaria y más",
    emoji: "💊",
    color: "vert-salud",
    hex: "#ec4899",
  },
  {
    slug: "varios",
    name: "Varios",
    description: "Librería, ferretería, limpieza, floristería y otros",
    emoji: "📦",
    color: "vert-varios",
    hex: "#f59e0b",
  },
  {
    slug: "mascotas",
    name: "Mascotas",
    description: "Pet shop, peluquería canina, veterinaria y alimentos para mascotas",
    emoji: "🐾",
    color: "vert-mascotas",
    hex: "#14b8a6",
  },
] as const;