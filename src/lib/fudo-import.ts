/**
 * Parser tolerante para el Excel de FUDO (`Importar-productos.xlsx`).
 *
 * Formato oficial (soporte.fu.do):
 * - Hoja 1: instrucciones (se ignora)
 * - Hoja 2: productos (ID uso interno en blanco, Categoría*, Nombre*, Precio, ...)
 * - Hoja 3: ingredientes (ID en blanco, Categoría*, Nombre*, Unidad, Costo, Merma%)
 * - Con modificadores: hojas 4 (lógica grupos), 5 (composición), 6 (asociación)
 * - Además acepta hoja `Recetas` con formato Portal
 *   (Plato | Ingrediente | Cantidad | Unidad | Rinde | Instrucciones)
 *   porque FUDO no exporta el escandallo en el xlsx.
 *
 * Todo es best-effort: lo no reconocido se reporta en `warnings`,
 * nunca rompe la importación de lo válido.
 */

export type FudoProduct = {
  name: string;
  price: number;
  category: string;
  description: string;
  sku: string;
  group?: string;
  modifiers: { desc: string; price_mod: number }[];
  /** Campos propios de FUDO (opcionales). */
  available: boolean;
  featured: boolean;
  cost: number | null;
  stock: number | null;
  stockMin: number | null;
  stockControl: boolean;
};

export type FudoIngredient = {
  name: string;
  category: string;
  unit: string;
  cost: number | null;
  wastePct: number;
};

export type FudoGroupDef = {
  name: string;
  publicName: string;
  pricing: "sum" | "max";
  min: number;
  max: number;
};

export type FudoGroupOption = {
  group: string;
  label: string;
  price: number;
  maxQty: number;
};

export type FudoAssociation = {
  group: string;
  product: string;
};

export type FudoRecipeLine = {
  dish: string;
  ingredient: string;
  qty: number;
  unit: string;
  yield: number;
  instructions: string;
};

export type FudoParsed = {
  isFudo: boolean;
  products: FudoProduct[];
  ingredients: FudoIngredient[];
  groups: FudoGroupDef[];
  groupOptions: FudoGroupOption[];
  associations: FudoAssociation[];
  recipeLines: FudoRecipeLine[];
  warnings: { row: string; reason: string }[];
  sheetsFound: string[];
};

export function normHeader(k: unknown): string {
  return String(k ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s_\-]+/g, "")
    .replace(/[*#:;.,()\/\\|]/g, "");
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  let s = String(v).trim();
  if (!s) return null;
  // "$ 2.500,50" / "2500" / "0.3 kg" (por si viene con unidad pegada)
  s = s.replace(/[$\s]/g, "");
  const m = s.match(/-?[\d.,]+/);
  if (!m) return null;
  s = m[0];
  if (s.includes(",") && s.includes(".")) {
    // "2.500,50" → "2500.50"
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    // "0,3" → "0.3"  |  "2,500" → "2.5" (se asume decimal; miles con coma son raros en FUDO)
    s = s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function boolSiNo(v: unknown, def: boolean): boolean {
  const s = normHeader(v);
  if (!s) return def;
  if (["si", "s", "yes", "y", "1", "true", "verdadero", "activo", "activa"].includes(s)) return true;
  if (["no", "n", "0", "false", "falso", "inactivo", "inactiva"].includes(s)) return false;
  return def;
}

/** Clasifica una hoja por su nombre. */
export function classifySheet(name: string): "instructions" | "products" | "ingredients" | "group_logic" | "group_composition" | "group_association" | "recipes" | "stock" | "unknown" {
  const n = normHeader(name);
  if (/receta/.test(n)) return "recipes";
  if (/stock/.test(n)) return "stock";
  if (/instruccion|instrucciones|ayuda|info/.test(n) || n === "1" || n === "hoja1") return "instructions";
  if (/ingrediente/.test(n)) return "ingredients";
  if (/asociacion|asociaci|productosasociados|grupo.*producto/.test(n)) return "group_association";
  if (/composicion|composici|opcion|detallegrupo/.test(n)) return "group_composition";
  if (/grupo|logicamodificador|modificador/.test(n) && !/composicion|asociacion/.test(n)) return "group_logic";
  if (/producto|plato|menu|carta/.test(n)) return "products";
  return "unknown";
}

type SheetGrid = { name: string; rows: string[][] };

function headerIndex(headers: string[], ...aliases: string[]): number {
  const want = new Set(aliases.map(normHeader));
  for (let i = 0; i < headers.length; i++) {
    if (want.has(normHeader(headers[i]))) return i;
  }
  // match parcial para headers con sufijos ("Precio*", "Nombre del producto", ...)
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i]);
    for (const a of want) {
      if (a && h.includes(a)) return i;
    }
  }
  return -1;
}

// Vocabulario de encabezados conocidos (FUDO + Portal).
const HEADER_VOCAB = [
  "id", "nombre", "producto", "plato", "item", "articulo", "ingrediente", "insumo",
  "precio", "price", "valor", "costo", "coste",
  "categoria", "seccion", "rubro",
  "descripcion", "detalle",
  "activo", "disponible", "favorito", "destacado",
  "stock", "minimo", "unidad", "medida", "merma",
  "grupo", "modificante", "opcion", "logica", "min", "max", "asociado", "publico",
  "cantidad", "cant", "rinde", "porciones", "rendimiento", "instruccion", "receta",
  "sku", "codigo", "ean", "sku",
];

function headerScore(cells: string[]): number {
  let s = 0;
  for (const c of cells) {
    const h = normHeader(c);
    if (!h) continue;
    if (HEADER_VOCAB.some((v) => h === v || h.includes(v))) s += 2;
    else if (/^[a-z]{1,3}\d*$/.test(h)) s += 0; // "ID", "N°" sueltos no suman
  }
  return s;
}

function findHeaderRow(rows: string[][]): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const s = headerScore(rows[i]);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  // Exigir al menos 2 celdas de vocabulario (ej. Grupo+Producto, Plato+Ingrediente).
  if (best >= 0 && bestScore >= 4) return best;
  // Fallback legacy: primera fila con nombre+precio.
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(normHeader);
    const hasName = cells.some((c) => ["nombre", "producto", "plato", "item", "articulo", "ingrediente", "name"].some((a) => c.includes(a)));
    const hasPrice = cells.some((c) => ["precio", "price", "valor", "costo", "coste", "cost"].some((a) => c.includes(a)));
    if (hasName && hasPrice) return i;
  }
  return rows.length > 1 ? 1 : 0; // FUDO suele traer título en fila 0 + header en fila 1
}

function gridToObjects(rows: string[][]): { headers: string[]; data: string[][] } {
  if (rows.length === 0) return { headers: [], data: [] };
  const hi = findHeaderRow(rows);
  return { headers: rows[hi] ?? [], data: rows.slice(hi + 1) };
}

/** ¿Esta hoja parece de FUDO? (columna ID uso interno / Categoría* / Activo Si-No / etc.) */
function looksLikeFudo(headers: string[]): boolean {
  const hs = headers.map(normHeader).join(" ");
  return (
    hs.includes("id") ||
    hs.includes("activo") ||
    hs.includes("favorito") ||
    hs.includes("categoria") ||
    hs.includes("merma") ||
    hs.includes("unidad") ||
    hs.includes("rinde") ||
    hs.includes("cant")
  );
}

function parseProductsSheet(grid: SheetGrid, warnings: { row: string; reason: string }[]): FudoProduct[] {
  const { headers, data } = gridToObjects(grid.rows);
  if (headers.length === 0) return [];
  const iId = headerIndex(headers, "id", "idusointerno", "iduso interno");
  const iName = headerIndex(headers, "nombre", "producto", "plato", "item", "articulo", "name", "descripciondelplato");
  const iPrice = headerIndex(headers, "precio", "price", "valor", "precioventa");
  const iCat = headerIndex(headers, "categoria", "seccion", "rubro", "category");
  const iDesc = headerIndex(headers, "descripcion", "detalle", "description", "observacion");
  const iSku = headerIndex(headers, "sku", "codigo", "ean", "barcode", "codigobarras");
  const iActive = headerIndex(headers, "activo", "disponible", "habilitado", "vigente");
  const iFav = headerIndex(headers, "favorito", "destacado", "estrella");
  const iCost = headerIndex(headers, "costo", "coste", "cost", "costounitario");
  const iStock = headerIndex(headers, "stock", "existencia", "cantidad");
  const iStockMin = headerIndex(headers, "stockminimo", "minimo", "stocksminimo");
  const iGroup = headerIndex(headers, "grupo", "grupomodificantes", "grupodeopciones");
  // Modificante N descripción/precio (formato Portal, también tolerado acá)
  const modCols: { desc: number; price: number }[] = [];
  for (let n = 1; n <= 20; n++) {
    const d = headerIndex(headers, `modificante${n}descripcion`, `modificanten${n}descripcion`, `mod${n}desc`);
    const p = headerIndex(headers, `modificante${n}precio`, `modificanten${n}precio`, `mod${n}price`, `modificante${n}price`);
    if (d >= 0) modCols.push({ desc: d, price: p });
  }

  const out: FudoProduct[] = [];
  const seen = new Set<string>();
  data.forEach((r, idx) => {
    if (r.every((c) => !String(c ?? "").trim())) return;
    const name = String(r[iName] ?? "").trim();
    if (iName < 0 || !name) {
      warnings.push({ row: `${grid.name} fila ${idx + 2}`, reason: "Sin nombre (se omite)" });
      return;
    }
    const price = iPrice >= 0 ? num(r[iPrice]) : null;
    if (price == null || !Number.isFinite(price) || price < 0) {
      warnings.push({ row: name, reason: "Precio inválido o vacío (se omite)" });
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      warnings.push({ row: name, reason: "Duplicado en el archivo (se usa la última fila)" });
    }
    seen.add(key);
    const modifiers = modCols
      .map(({ desc, price: pi }) => ({
        desc: String(r[desc] ?? "").trim(),
        price_mod: pi >= 0 ? num(r[pi]) ?? 0 : 0,
      }))
      .filter((m) => m.desc !== "");
    out.push({
      name,
      price,
      category: String(r[iCat] ?? "").trim() || "otras",
      description: String(r[iDesc] ?? "").trim(),
      sku: iSku >= 0 ? String(r[iSku] ?? "").trim().slice(0, 64) : iId >= 0 ? "" : "",
      group: iGroup >= 0 ? String(r[iGroup] ?? "").trim() : "",
      modifiers,
      available: iActive >= 0 ? boolSiNo(r[iActive], true) : true,
      featured: iFav >= 0 ? boolSiNo(r[iFav], false) : false,
      cost: iCost >= 0 ? num(r[iCost]) : null,
      stock: iStock >= 0 ? num(r[iStock]) : null,
      stockMin: iStockMin >= 0 ? num(r[iStockMin]) : null,
      stockControl: iStock >= 0 && String(r[iStock] ?? "").trim() !== "",
    });
  });
  return out;
}

function parseIngredientsSheet(grid: SheetGrid, warnings: { row: string; reason: string }[]): FudoIngredient[] {
  const { headers, data } = gridToObjects(grid.rows);
  if (headers.length === 0) return [];
  const iName = headerIndex(headers, "nombre", "ingrediente", "insumo", "producto", "name");
  const iCat = headerIndex(headers, "categoria", "seccion", "rubro", "category");
  const iUnit = headerIndex(headers, "unidad", "unidadmedida", "medida", "unit", "um");
  const iCost = headerIndex(headers, "costo", "coste", "cost", "precio", "price", "valor");
  const iWaste = headerIndex(headers, "merma", "desperdicio", "waste", "perdida");
  const out: FudoIngredient[] = [];
  const seen = new Set<string>();
  data.forEach((r, idx) => {
    if (r.every((c) => !String(c ?? "").trim())) return;
    const name = String(r[iName] ?? "").trim();
    if (iName < 0 || !name) {
      warnings.push({ row: `${grid.name} fila ${idx + 2}`, reason: "Ingrediente sin nombre (se omite)" });
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) warnings.push({ row: name, reason: "Ingrediente duplicado (se usa la última fila)" });
    seen.add(key);
    const waste = iWaste >= 0 ? num(r[iWaste]) ?? 0 : 0;
    out.push({
      name,
      category: String(r[iCat] ?? "").trim() || "general",
      unit: String(r[iUnit] ?? "").trim() || "u",
      cost: iCost >= 0 ? num(r[iCost]) : null,
      wastePct: Math.min(Math.max(waste, 0), 99.99),
    });
  });
  return out;
}

function parseGroupLogicSheet(grid: SheetGrid): FudoGroupDef[] {
  const { headers, data } = gridToObjects(grid.rows);
  if (headers.length === 0) return [];
  const iName = headerIndex(headers, "nombre", "grupo", "group");
  const iPublic = headerIndex(headers, "nombrepublico", "publico", "titulo");
  const iLogic = headerIndex(headers, "logica", "logic", "preciopfinal", "tipo", "modo");
  const iMin = headerIndex(headers, "min", "minimo", "cantminima", "cantidadminima");
  const iMax = headerIndex(headers, "max", "maximo", "cantmaxima", "cantidadmaxima");
  const out: FudoGroupDef[] = [];
  for (const r of data) {
    if (r.every((c) => !String(c ?? "").trim())) continue;
    const name = String(r[iName] ?? "").trim();
    if (!name) continue;
    const logicRaw = normHeader(r[iLogic]);
    out.push({
      name,
      publicName: iPublic >= 0 ? String(r[iPublic] ?? "").trim() : "",
      pricing: logicRaw.includes("max") ? "max" : "sum",
      min: iMin >= 0 ? Math.max(0, Math.floor(num(r[iMin]) ?? 0)) : 0,
      max: iMax >= 0 ? Math.max(1, Math.floor(num(r[iMax]) ?? 1)) : 1,
    });
  }
  return out;
}

function parseGroupCompositionSheet(grid: SheetGrid): FudoGroupOption[] {
  const { headers, data } = gridToObjects(grid.rows);
  if (headers.length === 0) return [];
  const iGroup = headerIndex(headers, "grupo", "group", "nombregrupo");
  const iProd = headerIndex(headers, "producto", "nombre", "opcion", "modificante", "item");
  const iPrice = headerIndex(headers, "precio", "price", "valor", "adicional");
  const iMax = headerIndex(headers, "cantmaxima", "maximo", "max", "cantidad");
  const out: FudoGroupOption[] = [];
  for (const r of data) {
    if (r.every((c) => !String(c ?? "").trim())) continue;
    const group = String(r[iGroup] ?? "").trim();
    const label = String(r[iProd] ?? "").trim();
    if (!group || !label) continue;
    out.push({
      group,
      label,
      price: iPrice >= 0 ? num(r[iPrice]) ?? 0 : 0,
      maxQty: iMax >= 0 ? Math.max(1, Math.floor(num(r[iMax]) ?? 1)) : 1,
    });
  }
  return out;
}

function parseAssociationSheet(grid: SheetGrid): FudoAssociation[] {
  const { headers, data } = gridToObjects(grid.rows);
  if (headers.length === 0) return [];
  const iGroup = headerIndex(headers, "grupo", "group", "nombregrupo");
  const iProd = headerIndex(headers, "producto", "nombre", "plato", "asociado", "productoasociado");
  const out: FudoAssociation[] = [];
  for (const r of data) {
    if (r.every((c) => !String(c ?? "").trim())) continue;
    const group = String(r[iGroup] ?? "").trim();
    const product = String(r[iProd] ?? "").trim();
    if (!group || !product) continue;
    out.push({ group, product });
  }
  return out;
}

function parseRecipesSheet(grid: SheetGrid, warnings: { row: string; reason: string }[]): FudoRecipeLine[] {
  const { headers, data } = gridToObjects(grid.rows);
  if (headers.length === 0) return [];
  const iDish = headerIndex(headers, "plato", "producto", "nombre", "receta", "menu");
  const iIng = headerIndex(headers, "ingrediente", "insumo", "componente", "material");
  const iQty = headerIndex(headers, "cantidad", "cant", "qty", "neta", "cantidadneta");
  const iUnit = headerIndex(headers, "unidad", "medida", "unit", "um");
  const iYield = headerIndex(headers, "rinde", "porciones", "rendimiento", "portions", "yield");
  const iInstr = headerIndex(headers, "instruccion", "instrucciones", "preparacion", "notas");
  if (iDish < 0 || iIng < 0) return [];
  const out: FudoRecipeLine[] = [];
  data.forEach((r, idx) => {
    if (r.every((c) => !String(c ?? "").trim())) return;
    const dish = String(r[iDish] ?? "").trim();
    const ingredient = String(r[iIng] ?? "").trim();
    if (!dish || !ingredient) {
      warnings.push({ row: `${grid.name} fila ${idx + 2}`, reason: "Receta sin plato o sin ingrediente (se omite)" });
      return;
    }
    // Fila de cabecera repetida en el medio del archivo
    if (normHeader(dish).includes("plato") && normHeader(ingredient).includes("ingrediente")) return;
    const qty = iQty >= 0 ? num(r[iQty]) : null;
    if (qty == null || !(qty > 0)) {
      warnings.push({ row: `${dish} / ${ingredient}`, reason: "Cantidad inválida (se omite la línea)" });
      return;
    }
    out.push({
      dish,
      ingredient,
      qty,
      unit: iUnit >= 0 && String(r[iUnit] ?? "").trim() ? String(r[iUnit]).trim() : "u",
      yield: iYield >= 0 && (num(r[iYield]) ?? 0) > 0 ? (num(r[iYield]) as number) : 1,
      instructions: iInstr >= 0 ? String(r[iInstr] ?? "").trim() : "",
    });
  });
  return out;
}

/** Normaliza unidad FUDO → unidad aceptada por costing (g/kg/mg/ml/L/u/doc...). */
export function normalizeUnit(raw: string): string {
  const u = normHeader(raw);
  const map: Record<string, string> = {
    kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg", k: "kg",
    gramo: "g", gramos: "g", gr: "g", grs: "g",
    miligramo: "mg", miligramos: "mg",
    litro: "L", litros: "L", ltro: "L", ltrs: "L",
    mililitro: "ml", mililitros: "ml",
    centilitro: "cl", centilitros: "cl",
    unidad: "u", unidades: "u", unid: "u", und: "u",
    docena: "doc", docenas: "doc",
    cucharada: "u", cucharadita: "u", pizca: "u", porcion: "u", porciones: "u",
  };
  if (map[u]) return map[u];
  // plural simple: "kgs" → "kg"
  const singular = u.endsWith("s") ? u.slice(0, -1) : u;
  if (map[singular]) return map[singular];
  return raw.trim() || "u";
}

/** Infiere base_unit (g/ml/u) desde una unidad de compra/linea. */
export function inferBaseUnit(rawUnit: string): "g" | "ml" | "u" {
  const u = normalizeUnit(rawUnit).toLowerCase();
  if (["mg", "g", "kg"].includes(u)) return "g";
  if (["ml", "cc", "cl", "l", "lt", "lts"].includes(u)) return "ml";
  return "u";
}

export function normName(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Punto de entrada: recibe las hojas ya leídas (nombre + grilla de strings)
 * y devuelve todo el contenido FUDO parseado.
 */
export function parseFudoSheets(sheets: SheetGrid[]): FudoParsed {
  const warnings: { row: string; reason: string }[] = [];
  const sheetsFound = sheets.map((s) => s.name);
  const byKind = new Map<string, SheetGrid[]>();
  for (const s of sheets) {
    const k = classifySheet(s.name);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(s);
  }

  // Si ninguna hoja clasifica y hay una sola hoja genérica, tratarla como productos
  // con el parser Portal actual (compatibilidad). Acá solo marcamos isFudo=false.
  const knownKinds = ["products", "ingredients", "group_logic", "group_composition", "group_association", "recipes", "stock"] as const;
  const hasKnown = knownKinds.some((k) => (byKind.get(k) ?? []).length > 0);
  let fudoHeaderHit = false;
  for (const s of sheets) {
    const { headers } = gridToObjects(s.rows);
    if (looksLikeFudo(headers)) {
      fudoHeaderHit = true;
      break;
    }
  }

  const products: FudoProduct[] = [];
  const ingredients: FudoIngredient[] = [];
  const groups: FudoGroupDef[] = [];
  const groupOptions: FudoGroupOption[] = [];
  const associations: FudoAssociation[] = [];
  const recipeLines: FudoRecipeLine[] = [];

  if (!hasKnown && !fudoHeaderHit) {
    return {
      isFudo: false,
      products,
      ingredients,
      groups,
      groupOptions,
      associations,
      recipeLines,
      warnings,
      sheetsFound,
    };
  }

  // Productos: hojas clasificadas como productos + unknowns con pinta de productos.
  // Si hay varias, se concatenan (FUDO a veces parte la carta por categoría).
  const productSheets = [...(byKind.get("products") ?? [])];
  for (const s of byKind.get("unknown") ?? []) {
    const { headers } = gridToObjects(s.rows);
    if (headers.length > 0 && looksLikeFudo(headers)) productSheets.push(s);
  }
  // Hoja de stock con columnas producto/precio también puede traer carta.
  for (const s of byKind.get("stock") ?? []) {
    const { headers } = gridToObjects(s.rows);
    const h = headers.map(normHeader).join(" ");
    if (h.includes("precio") && (h.includes("nombre") || h.includes("producto"))) productSheets.push(s);
  }
  for (const s of productSheets) {
    for (const p of parseProductsSheet(s, warnings)) products.push(p);
  }

  for (const s of byKind.get("ingredients") ?? []) {
    for (const ing of parseIngredientsSheet(s, warnings)) ingredients.push(ing);
  }
  for (const s of byKind.get("group_logic") ?? []) {
    for (const g of parseGroupLogicSheet(s)) groups.push(g);
  }
  for (const s of byKind.get("group_composition") ?? []) {
    for (const o of parseGroupCompositionSheet(s)) groupOptions.push(o);
  }
  for (const s of byKind.get("group_association") ?? []) {
    for (const a of parseAssociationSheet(s)) associations.push(a);
  }
  for (const s of byKind.get("recipes") ?? []) {
    for (const l of parseRecipesSheet(s, warnings)) recipeLines.push(l);
  }

  // Deduplicar definiciones de grupo por nombre (última gana).
  const groupByName = new Map<string, FudoGroupDef>();
  for (const g of groups) groupByName.set(normName(g.name), g);

  return {
    isFudo: true,
    products,
    ingredients,
    groups: [...groupByName.values()],
    groupOptions,
    associations,
    recipeLines,
    warnings,
    sheetsFound,
  };
}
