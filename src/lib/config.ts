export const ZONE = {
  slugs: ["sicardi", "garibaldi"],
  name: "Sicardi y Garibaldi",
} as const;

export const DEFAULT_NEIGHBORHOOD = {
  slug: "sicardi",
  name: "Sicardi",
};

export const NEIGHBORHOODS = [
  { slug: "sicardi", name: "Sicardi", active: true },
  { slug: "garibaldi", name: "Garibaldi", active: true },
] as const;
