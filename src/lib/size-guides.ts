/**
 * Guías de talles (vertical moda): plantillas por tipo de prenda para prefill
 * del editor y para la ficha del micrositio cuando el producto no tiene guía
 * propia. Formato: una línea por talle — "Talle: medidas" (el render separa
 * en el primer ":" y muestra talle + medidas como tabla).
 */

export type SizeGuideTemplate = { id: string; label: string; rows: string[] };

export const SIZE_GUIDE_TEMPLATES: SizeGuideTemplate[] = [
  {
    id: "remera",
    label: "Remera / Camiseta",
    rows: [
      "S: Pecho 90 cm · Largo 66 cm",
      "M: Pecho 96 cm · Largo 69 cm",
      "L: Pecho 102 cm · Largo 72 cm",
      "XL: Pecho 108 cm · Largo 74 cm",
    ],
  },
  {
    id: "camisa",
    label: "Camisa",
    rows: [
      "S: Pecho 96 cm · Largo 70 cm · Manga 60 cm",
      "M: Pecho 102 cm · Largo 72 cm · Manga 62 cm",
      "L: Pecho 108 cm · Largo 74 cm · Manga 64 cm",
      "XL: Pecho 114 cm · Largo 76 cm · Manga 66 cm",
    ],
  },
  {
    id: "pantalon",
    label: "Pantalón / Jean",
    rows: [
      "38: Cintura 76 cm · Largo 100 cm",
      "40: Cintura 80 cm · Largo 102 cm",
      "42: Cintura 84 cm · Largo 104 cm",
      "44: Cintura 88 cm · Largo 106 cm",
      "46: Cintura 92 cm · Largo 108 cm",
    ],
  },
  {
    id: "calzado",
    label: "Calzado",
    rows: [
      "37: Largo plantilla 23,5 cm",
      "38: Largo plantilla 24,1 cm",
      "39: Largo plantilla 24,8 cm",
      "40: Largo plantilla 25,4 cm",
      "41: Largo plantilla 26,0 cm",
      "42: Largo plantilla 26,7 cm",
    ],
  },
  {
    id: "vestido",
    label: "Vestido",
    rows: [
      "S: Pecho 88 cm · Cintura 70 cm · Largo 90 cm",
      "M: Pecho 94 cm · Cintura 76 cm · Largo 92 cm",
      "L: Pecho 100 cm · Cintura 82 cm · Largo 94 cm",
      "XL: Pecho 106 cm · Cintura 88 cm · Largo 96 cm",
    ],
  },
  {
    id: "buzo",
    label: "Buzo / Hoodie",
    rows: [
      "S: Pecho 100 cm · Largo 65 cm",
      "M: Pecho 106 cm · Largo 68 cm",
      "L: Pecho 112 cm · Largo 71 cm",
      "XL: Pecho 118 cm · Largo 73 cm",
    ],
  },
  {
    id: "ninos",
    label: "Niños (edad)",
    rows: [
      "2: Edad 2 años · Altura 92 cm",
      "4: Edad 4 años · Altura 104 cm",
      "6: Edad 6 años · Altura 116 cm",
      "8: Edad 8 años · Altura 128 cm",
      "10: Edad 10 años · Altura 140 cm",
    ],
  },
];

/** Texto de la plantilla (líneas separadas por \n) para prefill del editor. */
export function templateToText(id: string): string {
  const t = SIZE_GUIDE_TEMPLATES.find((x) => x.id === id);
  return t ? t.rows.join("\n") : "";
}

/** Línea "Talle: medidas" → { talle, rest }. Null si no tiene ":". */
export function parseGuideLine(line: string): { talle: string; rest: string } | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  return { talle: line.slice(0, idx).trim(), rest: line.slice(idx + 1).trim() };
}

/** Orden canónico de talles para facets (buscador): letras primero, números después. */
const TALLE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "3XL", "4XL", "UNICO", "ÚNICO"];

export function sortTalles(talles: string[]): string[] {
  return [...talles].sort((a, b) => {
    const ia = TALLE_ORDER.indexOf(a.toUpperCase());
    const ib = TALLE_ORDER.indexOf(b.toUpperCase());
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b, "es");
  });
}
