// @ts-nocheck — pendiente de conversación a TypeScript.
// Configuración de agentes leída desde la DB (tabla bot_agents).
// Falla ABIERTO: si no hay DATABASE_URL, la tabla no existe o la query falla,
// devuelve null y el motor decide por slug/env exactamente como antes.

import { queryOne, queryMany } from "./db.mjs";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { value, at }

export async function getBotConfig(vendorId, isPortal) {
  const key = isPortal ? "portal" : String(vendorId || "");
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value = null;
  try {
    const row = await queryOne(
      `SELECT key, vendor_id, name, mode, enabled, tone, greeting, handoff_phone, brief, model,
              temperature, max_tokens, memory_limit
       FROM bot_agents WHERE key = $1 LIMIT 1`,
      [key]
    );
    if (row) {
      const faqs = await queryMany(
        `SELECT question, answer FROM bot_agent_faqs
         WHERE agent_key = $1 AND active = true ORDER BY created_at ASC LIMIT 40`,
        [key]
      ).catch(() => []);
      value = {
        key: row.key,
        vendorId: row.vendor_id ? String(row.vendor_id) : null,
        name: row.name,
        mode: row.mode === "orders" ? "orders" : "concierge",
        enabled: row.enabled === true,
        tone: row.tone === "clasico" ? "clasico" : "humano",
        greeting: row.greeting || null,
        handoffPhone: row.handoff_phone || null,
        brief: row.brief && typeof row.brief === "object" ? row.brief : {},
        model: row.model || null,
        temperature: Number(row.temperature ?? 0),
        maxTokens: Number(row.max_tokens ?? 600),
        memoryLimit: Number(row.memory_limit ?? 16),
        faqs: (faqs || []).map((f) => ({ question: f.question, answer: f.answer })),
      };
    }
  } catch {
    // tabla ausente / DB caída → fallback al comportamiento histórico
    value = null;
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

/**
 * Bloque aditivo que se agrega al system prompt del LLM SOLO si el agente
 * tiene brief o FAQs cargados. Sin contenido → devuelve "" y el prompt queda
 * idéntico al de hoy (no reintroducimos el bug del prompt de ayer).
 */
export function buildAgentPrompt(cfg) {
  if (!cfg) return "";
  const b = cfg.brief || {};
  const lines = [];
  const add = (title, text) => {
    const t = String(text || "").trim();
    if (t) lines.push(`### ${title}\n${t}`);
  };
  add("Tu trabajo", b.instructions);
  add("El negocio", [b.business, b.products, b.audience, b.policies].filter(Boolean).join("\n"));
  const rules = [
    ...(Array.isArray(b.always) ? b.always.map((x) => `- SIEMPRE: ${x}`) : []),
    ...(Array.isArray(b.never) ? b.never.map((x) => `- NUNCA: ${x}`) : []),
  ];
  if (rules.length) lines.push(`### Reglas\n${rules.join("\n")}`);
  if (cfg.faqs?.length) {
    lines.push(
      `### Conocimiento (preguntas frecuentes)\n${cfg.faqs
        .map((f) => `P: ${f.question}\nR: ${f.answer}`)
        .join("\n\n")}\n\nUsá este conocimiento si encaja con lo que pregunta el cliente. Nunca inventes lo que no está acá.`
    );
  }
  if (!lines.length) return "";
  return `\n\nINFORMACIÓN DE ESTE AGENTE (${cfg.name || "comercio"}):\n${lines.join("\n\n")}`;
}

/** Solo para tests: limpiar cache entre escenarios. */
export function clearBotConfigCache() {
  cache.clear();
}
