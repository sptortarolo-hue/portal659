export const ZONE = {
  slugs: ["sicardi", "garibaldi"],
  name: "Sicardi y Garibaldi",
} as const;

export const VERTICALS = [
  {
    slug: "gastronomia",
    name: "Gastronomía",
    description: "Rotiserías, pizzerías y comida casera del barrio",
    emoji: "🍽️",
  },
  {
    slug: "almacen",
    name: "El Almacén",
    description: "Verdulerías, carnicerías y almacenes de la zona",
    emoji: "🥦",
  },
  {
    slug: "servicio",
    name: "Servicios del Barrio",
    description: "Oficios y profesionales que atienden en el barrio",
    emoji: "🔧",
  },
] as const;

export const DEFAULT_NEIGHBORHOOD = {
  slug: "sicardi",
  name: "Sicardi",
};

export const NEIGHBORHOODS = [
  { slug: "sicardi", name: "Sicardi", active: true },
  { slug: "garibaldi", name: "Garibaldi", active: true },
] as const;
