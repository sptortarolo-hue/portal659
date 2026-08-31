// Capa de IA para limpiar/estructurar el menú importado desde Excel.
// Solo soporta NVIDIA NIM (OpenAI-compatible). Si no hay LLM_API_KEY,
// se usa un modo "reglas" (mapeo por encabezados) sin IA.

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "meta/llama-3.3-70b-instruct";

export type CleanedMenuItem = {
  name: string;
  description?: string | null;
  price: number;
  category?: string | null;
};

export type CleanMenuResult = {
  items: CleanedMenuItem[];
  usedLlm: boolean;
};

/** Table→objects: `[{ col1: val, col2: val }, ...]` proveniente del Excel. */
type Row = Record<string, unknown>;

const REQUIRED_FIELDS = ["name", "price"] as const;

function isConfigured(): boolean {
  return !!process.env.LLM_API_KEY;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  // quita $, puntos de miles, espacios, y usa coma como decimal
  let clean = s.replace(/[$,\s]/g, "");
  clean = clean.replace(/\./g, ".");
  const n = parseFloat(clean.replace(/(\d),(\d)/g, "$1.$2"));
  return Number.isFinite(n) ? n : null;
}

function toString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Modo reglas: mapea encabezados comunes de una hoja de Excel a los
 * campos del menú. Funciona sin API key.
 */
function cleanMenuByRules(rows: Row[]): CleanedMenuItem[] {
  const items: CleanedMenuItem[] = [];
  for (const row of rows) {
    let name: string | null = null;
    let price: number | null = null;
    let category: string | null = null;
    let description: string | null = null;

    for (const [k, v] of Object.entries(row)) {
      const key = String(k).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key) continue;
      if (/^(nombre|plato|producto|item|articulo|comida|menu|name)$/.test(key) || key.includes("nombre")) {
        const s = toString(v);
        if (s && !name) name = s;
      } else if (/^(precio|price|valor|precio\$|\$precio)$/.test(key) || key.includes("precio")) {
        const n = Number(v);
        if (Number.isFinite(n)) price = n;
        else {
          const parsed = toNumber(v);
          if (parsed != null) price = parsed;
        }
      } else if (/^(categoria|categoría|seccion|sección|rubro|rubro$|cat|tipo|category)$/.test(key) || key.includes("categor") || key.includes("seccion") || key.includes("rubro")) {
        const s = toString(v);
        if (s) category = s;
      } else if (/^(descripcion|descripción|desc|detalle|description)$/.test(key) || key.includes("descripc") || key.includes("detalle")) {
        const s = toString(v);
        if (s) description = s;
      }
    }

    if (!name) continue;

    if (price == null) {
      // intenta interpretar el valor numérico en cualquier celda
      for (const v of Object.values(row)) {
        const parsed = toNumber(v);
        if (parsed != null) {
          price = parsed;
          break;
        }
      }
    }

    const item: CleanedMenuItem = { name, price: price ?? 0 };
    if (category) item.category = category;
    if (description) item.description = description;
    items.push(item);
  }
  return items;
}

async function cleanMenuWithLlm(
  rows: Row[],
  existingCategories: string[]
): Promise<CleanedMenuItem[]> {
  const apiKey = process.env.LLM_API_KEY!;
  const baseUrl = process.env.LLM_BASE_URL || NVIDIA_BASE_URL;
  const model = process.env.LLM_MODEL || NVIDIA_MODEL;

  const system = `Sos un asistente que limpia y estructura el menú de un comercio gastronómico a partir de filas de una planilla de Excel. Devolvés SOLO un JSON válido (sin texto adicional) con forma:

[{"name": string, "price": number, "category": string|null, "description": string|null}, ...]

Reglas:
- "name": nombre del plato (obligatorio). Si una fila no tiene nombre claro, omitila.
- "price": número sin símbolos ni separadores. Si viene "1.500" interpretalo como 1500. Coma es decimal.
- "category": categoría del menú. Usa una de las existentes si matchea (case-insensitive), si no una nueva breve (ej. "Pizzas", "Bebidas").
- "description": descripción limpia, o null si no hay.
- Ignorá filas vacías, títulos de sección duplicados, o totales.
- No inventes precios: si no hay precio claro, pon 0.`;

  const user = `Categorías existentes del comercio: ${JSON.stringify(existingCategories)}\n\nFilas del Excel (JSON):\n${JSON.stringify(rows)}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`NVIDIA API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content || "";
  const jsonStr = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) throw new Error("La IA no devolvió un arreglo");

  return parsed
    .map((it: CleanedMenuItem) => {
      const name = toString(it?.name);
      if (!name) return null;
      const price = toNumber(String(it?.price ?? ""));
      const item: CleanedMenuItem = { name, price: price ?? 0 };
      const cat = toString(it?.category);
      if (cat) item.category = cat;
      const desc = toString(it?.description);
      if (desc) item.description = desc;
      return item;
    })
    .filter((x): x is CleanedMenuItem => x !== null);
}

/** Limpia las filas del Excel: usa IA si hay key; si falla, cae a reglas. */
export async function cleanMenu(
  rows: Row[],
  existingCategories: string[]
): Promise<CleanMenuResult> {
  if (isConfigured()) {
    try {
      const items = await cleanMenuWithLlm(rows, existingCategories);
      return { items, usedLlm: true };
    } catch {
      // fallback a reglas si la IA falla o expira
    }
  }
  return { items: cleanMenuByRules(rows), usedLlm: false };
}

export { REQUIRED_FIELDS };
