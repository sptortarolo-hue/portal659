// @ts-nocheck — pendiente de conversación a TypeScript.
// Runner del Laboratorio reutilizable: corre personas simuladas contra el motor
// REAL (en sandbox: sin WhatsApp, sin pedidos, sin telemetría) y las puntúa con
// un juez LLM. Lo usa el panel /admin/bots y el CLI laboratorio.mjs.

import { runInSandbox } from "./sandbox.mjs";
import { handleInbound } from "./bot.mjs";
import { clearState } from "./state.mjs";
import { llmChat } from "./nlu.mjs";

export const PERSONAS = [
  {
    id: "decidido",
    name: "El Decidido",
    description: "Quiere comprar ya: elige, da datos y confirma.",
    lines: ["hola", "comercios", "1", "quiero 2 boca juniors", "retirar", "Juan", "efectivo", "sí"],
    expect: (ctx) => (ctx.mode === "orders" && !ctx.orderCreated
      ? { ok: false, note: "Modo órdenes: el flujo nunca creó el pedido" }
      : { ok: true, note: ctx.mode === "orders" ? "Pedido simulado creado" : "Conserje: respondió y/o derivó a una persona" }),
  },
  {
    id: "preguntón",
    name: "El Preguntón",
    description: "Pregunta precios y no decide.",
    lines: ["hola", "comercios", "1", "cuánto sale la boca juniors?", "y la cerezas?", "y el maradona?", "gracias"],
    expect: (ctx) => (ctx.answered ? { ok: true, note: "Mostró precios o explicó que no los tiene / derivó" } : { ok: false, note: "No respondió" }),
  },
  {
    id: "enojado",
    name: "El Enojado",
    description: "Cliente frustrado, pide una persona.",
    lines: ["hola", "esto es un desastre", "mis stickers llegaron rotos otra vez", "quiero hablar con una persona"],
    expect: (ctx) => (ctx.handoff ? { ok: true, note: "Escaló a humano" } : { ok: false, note: "No escaló" }),
  },
  {
    id: "inexistente",
    name: "Lo inexistente",
    description: "Pregunta cosas fuera del catálogo (luna, cripto, nafta).",
    lines: ["hola", "comercios", "1", "hacen envíos a la luna?", "puedo pagar en cripto?", "venden nafta?", "gracias"],
    expect: () => ({ ok: true, note: "Sin afirmaciones inventadas (lo revisa el juez)" }),
  },
  {
    id: "exige-humano",
    name: "Exige humano",
    description: "Pide hablar con una persona ya.",
    lines: ["hola", "hablar con una persona"],
    expect: (ctx) => (ctx.handoff ? { ok: true, note: "Handoff inmediato" } : { ok: false, note: "No derivó" }),
  },
  {
    id: "typo",
    name: "Escribe mal",
    description: "Lunfardo y errores de ortografía.",
    lines: ["ola", "ke tieen", "quiero boca", "cuantos vale la cereza"],
    expect: (ctx) => (ctx.answered ? { ok: true, note: "Entendió el mensaje (aunque derivó a una persona)" } : { ok: false, note: "No respondió" }),
  },
];

const JUDGE_SYSTEM = `Sos un juez severo que evalúa al asistente de WhatsApp de una tienda de barrio.
Puntuá 0-100 y respondé SOLO JSON: {"score": <0-100>, "hallucination": true|false, "escalation_correct": true|false, "findings": ["hallazgo1","hallazgo2"]}
Criterios: honestidad (no inventar productos/precios), cumplir el objetivo del cliente, escalar a humano cuando lo pide, tono argentino, no ofrecer lo que no existe.`;

async function judge(persona, transcript, catalogText) {
  const t = transcript.map((x) => `CLIENTE: ${x.user}\nBOT: ${x.bot}`).join("\n\n");
  try {
    const out = await llmChat([
      { role: "system", content: `${JUDGE_SYSTEM}\n\nCatálogo real:\n${catalogText}\n\nObjetivo del cliente simulado: ${persona.description}` },
      { role: "user", content: t },
    ], { max_tokens: 400, temperature: 0, timeout: 25000, source: "lab" });
    if (!out) return null;
    const raw = (out.content || "").replace(/```json|```/g, "").trim();
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    return a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : null;
  } catch { return null; }
}

/**
 * Corre el laboratorio en sandbox.
 * @param {object} args { vendor, agentConfig, sessionId, judgeEnabled, catalogText }
 */
export async function runLab({ vendor, agentConfig, sessionId = "lab", judgeEnabled = true, catalogText = "" }) {
  return runInSandbox(async () => {
    const results = [];
    for (const persona of PERSONAS) {
      const waId = `lab_${sessionId}_${persona.id}_${Date.now()}`;
      await clearState(vendor.id, waId);
      const transcript = [];
      let handoff = false;
      let orderCreated = false;
      for (const line of persona.lines) {
        try {
          const r = await handleInbound({
            vendor, waId, body: line,
            agentConfig,
          });
          const bot = (r?.replies || []).join("\n");
          transcript.push({ user: line, bot });
          if (/Enseguida te atiende una persona/.test(bot)) handoff = true;
          if (/¡Pedido confirmado|Pedido confirmado/.test(bot)) orderCreated = true;
        } catch (e) {
          transcript.push({ user: line, bot: `[error] ${e?.message || "fallo"}` });
        }
      }
      const text = transcript.map((x) => x.bot).join("\n");
      const answered = transcript.some((x) => x.bot.trim() && !x.bot.startsWith("[error]"));
      const heuristic = persona.expect({ transcript: text, handoff, orderCreated, answered, mode: agentConfig?.mode || "orders" });
      const verdict = judgeEnabled ? await judge(persona, transcript, catalogText) : null;
      // El juez entiende el contexto (modo conserje, derivación, tono); la
      // heurística es sólo un piso para cuando el juez no está disponible.
      const total = verdict ? Math.round(Number(verdict.score || 0) * 0.8 + (heuristic.ok ? 20 : 0))
        : (heuristic.ok ? 80 : 0);
      results.push({
        id: persona.id, name: persona.name,
        ok: verdict ? Number(verdict.score) >= 50 : heuristic.ok,
        heuristic, verdict, total, transcript,
      });
    }
    return { results, passed: results.filter((r) => r.ok).length, total: results.length };
  });
}

/** Una sola conversación de playground, en sandbox. */
export async function runPlaygroundTurn({ vendor, agentConfig, sessionId, message }) {
  return runInSandbox(async () => {
    const waId = `playground_${sessionId}`;
    const r = await handleInbound({ vendor, waId, body: message, agentConfig });
    return { replies: r?.replies || [], handoff: r?.handoff === true };
  });
}
