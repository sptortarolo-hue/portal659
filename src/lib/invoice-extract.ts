/**
 * Extracción de comprobantes de proveedor (foto/PDF) con IA.
 *
 * Soporta varios proveedores con fallback automático (igual que el bot de
 * WhatsApp): Gemini → Groq (visión) → OpenRouter (visión) → primario
 * configurado (solo si el modelo soporta imágenes). La IA solo propone:
 * nada se guarda ciego.
 */
import { recordLlmUsage, parseLlmUsage } from "@/lib/llm-accounting";

export type ExtractedInvoiceItem = {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  line_total: number;
  unit_price_net?: number;
  unit_price_total?: number;
  iva_discriminado?: boolean;
  confidence?: number;
};

export type ExtractedInvoice = {
  supplier_name: string | null;
  receipt_type: string | null;
  receipt_number: string | null;
  purchased_at: string | null;
  items: ExtractedInvoiceItem[];
};

export type CatalogItem = { id: string; name: string; kind: "product" | "ingredient" | "variant" };

const VALID_RECEIPTS = new Set([
  "factura_a", "factura_b", "factura_c", "remito", "ticket", "ninguno",
]);

const PROMPT = `Sos un asistente que lee comprobantes de proveedores (facturas, remitos, tickets) de comercios minoristas argentinos y devuelve SOLO un JSON válido, sin texto adicional.

Extraé los siguientes campos del comprobante:
- supplier_name: nombre del proveedor/emisor (string o null).
- receipt_type: uno de "factura_a", "factura_b", "factura_c", "remito", "ticket", "ninguno" según el comprobante. Si es remito sin tipo fiscal, "remito".
- receipt_number: número de comprobante (string o null).
- purchased_at: fecha del comprobante en formato YYYY-MM-DD (string o null).
- items: array de líneas de producto/mercadería. Cada item:
  - description: descripción del artículo tal como figura (string).
  - qty: cantidad (número).
  - unit: unidad de la cantidad ("kg", "g", "l", "ml", "u", etc.).
  - unit_price: precio unitario tal como figura en el comprobante.
  - unit_price_net: si el IVA está discriminado, precio unitario SIN IVA; si no, el mismo que unit_price.
  - unit_price_total: precio unitario FINAL con IVA (el que se paga); si no hay discriminación, el mismo que unit_price.
  - iva_discriminado: true si el comprobante discrimina IVA, false si no (remito, factura C).
  - line_total: total de la línea (qty * unit_price_total). Si no figura, calculalo.
  - confidence: número entre 0 y 1 con tu confianza en esa línea. Bajá confidence si no hay discriminación de IVA.

REGLAS IMPORTANTES:
- NO incluyas líneas de subtotal, IVA, descuentos, fletes, redondeos ni totales como items.
- Si una línea es un servicio o gasto (no mercadería), NO la incluyas.
- Si no podés leer un campo con seguridad, devolvé null o 0 y bajá confidence.
- Devolvé SOLO el JSON, sin explicaciones.`;

type Provider = {
  name: string;
  kind: "gemini" | "openai";
  baseUrl: string;
  apiKey: string;
  model: string;
};
type ExtractResult = { extracted: ExtractedInvoice; raw: string; usage?: any };

function buildProviders(): Provider[] {
  const out: Provider[] = [];
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (geminiKey) {
    out.push({
      name: "gemini",
      kind: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: geminiKey,
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    });
  }
  const groqKey = process.env.GROQ_API_KEY || "";
  if (groqKey) {
    out.push({
      name: "groq",
      kind: "openai",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
      model: process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b",
    });
  }
  const orKey = process.env.OPENROUTER_API_KEY || "";
  if (orKey) {
    out.push({
      name: "openrouter",
      kind: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: orKey,
      model: process.env.OPENROUTER_VISION_MODEL || "google/gemini-4-hydrogen",
    });
    // Último recurso: modelo gratuito con visión que hoy sirve OpenRouter.
    out.push({
      name: "openrouter-free",
      kind: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: orKey,
      model: "inclusionai/ling-3.2-flash:free",
    });
  }
  // Primario configurado (NVIDIA/OpenRouter/etc.): solo si se indica un modelo
  // con visión explícitamente, para no intentar con uno de texto.
  if (process.env.LLM_API_KEY && process.env.LLM_VISION_MODEL) {
    out.push({
      name: "primary",
      kind: "openai",
      baseUrl: (process.env.LLM_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
      apiKey: process.env.LLM_API_KEY,
      model: process.env.LLM_VISION_MODEL,
    });
  }
  return out;
}

function normalizeUnit(u: string): string {
  const s = String(u || "").trim().toLowerCase();
  if (!s) return "u";
  if (s === "unidad" || s === "unidades" || s === "u." || s === "un") return "u";
  if (s === "kilogramo" || s === "kilogramos" || s === "kilo" || s === "kilos") return "kg";
  if (s === "gramo" || s === "gramos") return "g";
  if (s === "litro" || s === "litros") return "l";
  if (s === "mililitro" || s === "mililitros") return "ml";
  return s;
}

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function toDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "").trim();
  }
  return t;
}

function tryParseJson(text: string): unknown {
  const t = stripFences(text);
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeParsed(parsed: unknown, raw: string): { extracted: ExtractedInvoice; raw: string } {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("No se pudo interpretar la respuesta de la IA");
  }
  const obj = parsed as Record<string, unknown>;
  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items: ExtractedInvoiceItem[] = itemsRaw
    .map((it): ExtractedInvoiceItem | null => {
      const o = (it || {}) as Record<string, unknown>;
      const desc = String(o.description || "").trim();
      if (!desc) return null;
      const qty = toNum(o.qty, 1);
      const safeQty = qty > 0 ? qty : 1;
      const unit = normalizeUnit(String(o.unit || "u"));
      const unitPrice = toNum(o.unit_price, 0);
      const discriminado = o.iva_discriminado === true;
      const netRaw = o.unit_price_net;
      const totalRaw = o.unit_price_total;
      const unitNet = netRaw != null && String(netRaw).trim() !== "" ? toNum(netRaw, unitPrice) : unitPrice;
      const unitTotal = totalRaw != null && String(totalRaw).trim() !== "" ? toNum(totalRaw, unitPrice) : unitPrice;
      const lineTotalRaw = o.line_total;
      const lineTotal =
        lineTotalRaw != null && String(lineTotalRaw).trim() !== ""
          ? toNum(lineTotalRaw, safeQty * unitTotal)
          : safeQty * unitTotal;
      const conf = o.confidence != null ? toNum(o.confidence, 1) : undefined;
      const round4 = (n: number) => Math.round(n * 10000) / 10000;
      return {
        description: desc,
        qty: safeQty,
        unit,
        unit_price: round4(unitTotal),
        unit_price_net: round4(unitNet),
        unit_price_total: round4(unitTotal),
        iva_discriminado: discriminado,
        line_total: Math.round(lineTotal * 100) / 100,
        confidence: conf != null ? Math.max(0, Math.min(1, conf)) : undefined,
      };
    })
    .filter((x): x is ExtractedInvoiceItem => x !== null);

  const receiptTypeRaw = obj.receipt_type != null ? String(obj.receipt_type).trim().toLowerCase() : null;
  const receiptType = receiptTypeRaw && VALID_RECEIPTS.has(receiptTypeRaw) ? receiptTypeRaw : null;

  const extracted: ExtractedInvoice = {
    supplier_name: obj.supplier_name != null ? String(obj.supplier_name).trim() || null : null,
    receipt_type: receiptType,
    receipt_number: obj.receipt_number != null ? String(obj.receipt_number).trim() || null : null,
    purchased_at: toDate(obj.purchased_at),
    items,
  };

  return { extracted, raw };
}

async function callGemini(provider: Provider, buffer: Buffer, mimeType: string): Promise<ExtractResult> {
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType, data: buffer.toString("base64") } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  const res = await fetch(
    `${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini respondió ${res.status}: ${rawText.slice(0, 300)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error("Respuesta inválida de Gemini");
  }

  const candidateText =
    (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("") || "";

  const parsed = tryParseJson(candidateText);
  return { ...normalizeParsed(parsed, candidateText), usage: json };
}

async function callOpenAI(provider: Provider, buffer: Buffer, mimeType: string): Promise<ExtractResult> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const body = {
    model: provider.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Devolvé SOLO un JSON válido, sin texto adicional." },
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.name === "openrouter" || provider.name === "openrouter-free") {
    headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar";
    headers["X-Title"] = "Portal 659";
  }

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`${provider.name} respondió ${res.status}: ${rawText.slice(0, 300)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`Respuesta inválida de ${provider.name}`);
  }

  const content: string =
    (json as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content || "";

  const parsed = tryParseJson(content);
  return { ...normalizeParsed(parsed, content), usage: json };
}

export async function extractInvoice(
  buffer: Buffer,
  mimeType: string
): Promise<{ extracted: ExtractedInvoice; raw: string; usedProvider: string }> {
  const providers = buildProviders();
  const started = Date.now();
  if (providers.length === 0) {
    throw new Error("No hay proveedor de IA configurado (GEMINI_API_KEY/GROQ_API_KEY/OPENROUTER_API_KEY/LLM_API_KEY+LLM_VISION_MODEL)");
  }

  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      const result =
        provider.kind === "gemini"
          ? await callGemini(provider, buffer, mimeType)
          : await callOpenAI(provider, buffer, mimeType);
      const u = parseLlmUsage(result.usage, provider.name, provider.model);
      recordLlmUsage({
        source: "facturas", provider: provider.name, model: provider.model,
        ...u, success: true, latencyMs: Date.now() - started,
      });
      console.log("[extract:provider] ok", {
        provider: provider.name,
        model: provider.model,
        items: result.extracted.items.length,
        latencyMs: Date.now() - started,
      });
      return { ...result, usedProvider: provider.name };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn("[extract:provider] falló", {
        provider: provider.name,
        model: provider.model,
        error: lastError.message.slice(0, 240),
      });
      // Intentar el siguiente proveedor.
    }
  }

  recordLlmUsage({
    source: "facturas", provider: providers.at(-1)?.name || "desconocido",
    model: providers.at(-1)?.model || "desconocido", success: false,
    latencyMs: Date.now() - started,
  });
  throw lastError || new Error("No se pudo leer el comprobante");
}

// --- Matching de catálogo ---

function normalizeText(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  const stop = new Set(["de", "del", "la", "el", "los", "las", "y", "x", "kg", "gr", "g", "l", "ml", "u", "un", "una"]);
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length >= 2 && !stop.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

export function scoreMatch(description: string, candidate: string): number {
  const t1 = tokens(description);
  const t2 = tokens(candidate);
  if (t1.length === 0 || t2.length === 0) return 0;
  const set2 = new Set(t2);
  let overlap = 0;
  for (const t of t1) if (set2.has(t)) overlap++;
  const jaccard = overlap / new Set([...t1, ...t2]).size;
  const n1 = normalizeText(description);
  const n2 = normalizeText(candidate);
  let bonus = 0;
  if (n1.includes(n2) || n2.includes(n1)) bonus = 0.25;
  const maxLen = Math.max(n1.length, n2.length) || 1;
  const levSim = 1 - levenshtein(n1, n2) / maxLen;
  return Math.min(1, jaccard * 0.6 + levSim * 0.15 + bonus);
}

export function suggestMatches(
  description: string,
  catalog: CatalogItem[],
  limit = 3
): { id: string; name: string; kind: CatalogItem["kind"]; score: number }[] {
  return catalog
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, score: scoreMatch(description, c.name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export const MATCH_THRESHOLD = 0.35;