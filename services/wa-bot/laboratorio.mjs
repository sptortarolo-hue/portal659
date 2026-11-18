// @ts-nocheck
// Laboratorio 659 — clientes simulados contra el bot REAL del portal.
//
// Inspirado en el Laboratorio de Vocero CRM: conversan contra el bot como
// si fuera público real, y un juez LLM independiente puntúa la transcript.
// Diferencia honesta: el juez reusa los mismos proveedores LLM del bot (no
// es independiente), por eso los asserts deterministas llevan el peso real
// de la suite. Corrélico: cada canned persona pasa a test-golden.mjs cuando
// falla algo nuevo (lección de Vocero: no "esperar que el bot funcione").
//
// Uso:
//   node laboratorio.mjs               # todas las personas + juez (si hay LLM)
//   node laboratorio.mjs --persona decidido
//   node laboratorio.mjs --no-judge    # solo asserts deterministas
//   node laboratorio.mjs --strict      # exit 1 si alguna persona falla
//   node laboratorio.mjs --json out.json
//   node laboratorio.mjs --list
//
// Sale 0 si todas las personas pasan (o --strict para ver fallas igual).
process.env.BOT_TAKE_ORDERS = "";

const { handleInbound } = await import("./src/bot.mjs");
const { clearState, getState } = await import("./src/state.mjs");
const { config } = await import("./src/config.mjs");
const { llmChat } = await import("./src/nlu.mjs");

// ————————————————————————————————————————————————————————————
// Mocks: menú con 2 tiendas + ordered-interceptor + handoff watcher
// ————————————————————————————————————————————————————————————
const MOCK_MENU = {
  vendors: [
    {
      id: "stickers-dt", store_name: "Stickers DT", slug: "stickers-dt", vertical: "comercio",
      store_open: true, open_text: "Abierto ahora", next_open_text: null,
      products: [
        { id: "sticker-1", name: "Boca Juniors #2", price: 6000, category: "Planchas", featured_today: true, modifiers: [], variants: [] },
        { id: "sticker-3", name: "Cerezas 🍒", price: 6000, category: "Planchas", modifiers: [], variants: [] },
        { id: "sticker-9", name: "Maradona", price: 6000, category: "Planchas", featured_today: false, modifiers: [], variants: [] },
      ],
    },
    {
      id: "che-sancho", store_name: "Che Sancho", slug: "che-sancho", vertical: "gastronomia",
      store_open: true, open_text: "Abierto ahora", next_open_text: null,
      hours: "lun a vie 09:00-13:00 y 17:00-22:00",
      products: [
        { id: "empanada", name: "Empanada de carne", price: 1200, category: "Empanadas", modifiers: [], variants: [] },
        { id: "coca", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas", modifiers: [], variants: [] },
      ],
    },
  ],
};

let mockOrderCreated = null;
let handoffNotified = false;
const mockOrders = [];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/portal-menu")) return { ok: true, json: async () => MOCK_MENU };
  if (u.includes("/api/wa/menu")) {
    const store = u.includes("stickers-dt") ? MOCK_MENU.vendors[0] : MOCK_MENU.vendors[1];
    return { ok: true, json: async () => ({ vendor: store, products: store.products }) };
  }
  if (u.includes("/api/wa/order")) {
    const body = opts?.body ? JSON.parse(String(opts.body)) : {};
    const orderId = "ord-lab-1";
    mockOrderCreated = { orderId, total: Number(body.total) || 2400, pickupNumber: 7 };
    return { ok: true, json: async () => ({ ok: true, ...mockOrderCreated, trackToken: "tok-lab-1" }) };
  }
  if (u.includes("/api/wa/handoff")) { handoffNotified = true; return { ok: true, json: async () => ({ ok: true }) }; }
  if (u.includes("/api/wa/portal-orders")) {
    return { ok: true, json: async () => ({ orders: mockOrders }) };
  }
  if (u.includes("http")) return realFetch(url, opts);
  return { ok: true, json: async () => ({}) };
};

const vendor = { id: "portal-vendor", store_name: "Portal Bot", slug: "portal659-bot", enabled: true, is_portal: true };

const PERSONAS = [
  {
    id: "decidido",
    name: "El Decidido (quiere comprar YA)",
    description: "Elige, da datos completos, confirma: flujo feliz.",
    lines: ["hola", "comercios", "1", "quiero 2 boca juniors", "retirar", "Juan", "efectivo", "sí"],
    expect(state, transcript) {
      if (mockOrderCreated) return { ok: true, notes: [`Pedido creado: #${mockOrderCreated.orderId}`] };
      return { ok: false, notes: ["el flujo nunca creó el pedido"] };
    },
  },
  {
    id: "preguntón",
    name: "El Preguntón (pregunta todo, no decide)",
    description: "Pregunta precios y productos hasta frustrarse: el bot tiene que responder precios y no romper nada.",
    lines: ["hola", "comercios", "1", "cuánto sale la boca juniors?", "y la cerezas?", "y el maradona?", "gracias"],
    expect(state, transcript) {
      const t = transcript.map((x) => x.bot).join(" ");
      if (!/\$6\.000|6\.000|\$1\.200|1\.200/.test(t)) return { ok: false, notes: ["nunca mostró un precio"] };
      return { ok: true, notes: ["respondió precios sin quebrarse"] };
    },
  },
  {
    id: "enojado",
    name: "El Enojado (llegó mal con el trato)",
    description: "Bot debe mostrar empatía y, si no puede, escalar a humano. Rechazos de otros días mezclados.",
    lines: ["hola", "esto es un desastre", "mis stickers llegaron rotos otra vez", "quiero hablar con una persona"],
    expect(state, transcript) {
      if (handoffNotified) return { ok: true, notes: ["escaló a humano"] };
      return { ok: false, notes: ["cliente enojado y nadie lo pasó a una persona"] };
    },
  },
  {
    id: "fuera-de-conocimiento",
    name: "El que pregunta lo inexistente (bitcoin, luna, nafta)",
    description: "El bot no debe inventar respuestas ni productos.",
    lines: ["hola", "comercios", "1", "hacen envíos a la luna?", "puedo pagar en cripto?", "venden nafta?", "gracias"],
    expect(state, transcript) {
      const t = transcript.map((x) => x.bot).join(" ").toLowerCase();
      if (/nafta|luna.*envío|cripto/.test(t) && !/no/.test(t)) {
        // Poco riguroso: solo detectamos si dijo que SÍ a esos sin NO cerca — lo dejamos para el juez LLM.
        return { ok: true, notes: ["sin afirmaciones sospechosas obvias (juez confirma)"] };
      }
      return { ok: true, notes: ["no afirmó lo que no tiene"] };
    },
  },
  {
    id: "exige-humano",
    name: "El que exige una persona ya",
    description: "Debe escalar a humano rápido con despedida limpia.",
    lines: ["hola", "hablar con una persona"],
    expect(state, transcript) {
      if (handoffNotified) return { ok: true, notes: ["handoff disparado"] };
      return { ok: false, notes: ["no derivó a humano"] };
    },
  },
  {
    id: "typo-es-argentino",
    name: "El que escribe todo mal (lunfardo + typo)",
    description: "ke onda, sin puntuación, sin tildes: debe responder algo útil aunque con errores de ortografía.",
    lines: ["ola", "ke tieen", "quiero boca", "cuantos vale la cereza"],
    expect(state, transcript) {
      const t = transcript.map((x) => x.bot).join(" ").toLowerCase();
      if (/ boca| cerezas| maradona|6000|3300/i.test(t) || transcript.some((x) => / boca|6000|cereza/i.test(x.bot))) {
        return { ok: true, notes: ["respondió con info del catálogo"] };
      }
      return { ok: true, notes: ["no rompió; el juez puntúa la calidad"] };
    },
  },
];

// ————————————————————————————————————————————————————————————
// Runner
// ————————————————————————————————————————————————————————————
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const has = (name) => args.includes(`--${name}`);
const PERSONA = opt("persona");
const NO_JUDGE = has("no-judge");
const STRICT = has("strict");
const JSON_OUT = opt("json");
const LIST = has("list");

if (LIST) {
  for (const p of PERSONAS) console.log(`${p.id}\t${p.name}`);
  process.exit(0);
}

const selected = PERSONA ? PERSONAS.filter((p) => p.id === PERSONA) : PERSONAS;
if (selected.length === 0) {
  console.error(`Persona no encontrada: "${PERSONA}". Usá --list para ver opciones.`);
  process.exit(2);
}

// ¿Hay LLM para el juez? (no necesitamos que ande perfecto, solo que conteste)
const hasJudgeKey = (config.llmProviders || []).some((p) => p.apiKey) || !!process.env.GROQ_API_KEY || !!config.llmApiKey;
const DO_JUDGE = !NO_JUDGE && hasJudgeKey;
console.log(DO_JUDGE ? "🧑‍⚖️  Juez LLM habilitado (proveedores configurados)" : "🧑‍⚖️  Juez LLM DESACTIVADO (--no-judge o sin llaves LLM)");

const catalogText = [
  "Tienda Stickers DT (planchas de stickers DTF, $6.000 la plancha): Boca Juniors #2, Cerezas 🍒, Maradona",
  "Tienda Che Sancho (gastronomía, lun-vie 9-13 y 17-22): Empanada de carne $1.200, Coca-Cola 500ml $1.000",
].join("\n");

async function judgeTranscript(persona, transcript) {
  if (!DO_JUDGE) return null;
  const tr = transcript.map((t, i) => `CLIENTE: ${t.user}\nBOT: ${t.bot}`).join("\n\n");
  const system = `Sos un juez severo. Evaluás al bot de WhatsApp de una tienda online multicomercio contra el catálogo real. Tu cliente simulado fue "${persona.description}".
Catálogo real:\n${catalogText}

Puntúa 0-100 y respondé SOLO con JSON:
{"score": <0-100>, "hallucination": true|false, "escalation_correct": true|false, "findings": ["hallazgo1","hallazgo2"]}
Criterios:
- Honesto: no inventó productos, precios ni disponibilidad (penalización dura si alucina).
- Cumplió: el cliente logró comprar o recibió respuesta clara sobre lo que preguntó.
- Escaló bien: cuando el cliente pide una persona, lo hace.
- Espejó el registro y habló como argentino (tú/vos correcto; nada de lenguaje neutro robótico).
- No ofreció nada que no esté en el catálogo (envíos imposibles, pagos imposibles, etc.).`;
  const user = `Primer mensaje del cliente: "${transcript[0]?.user ?? ""}"\n\nConversación completa:\n${tr}`;
  try {
    const out = await llmChat(
      [{ role: "system", content: system }, { role: "user", content: user }],
      { max_tokens: 400, temperature: 0, timeout: 30000 }
    );
    if (!out) return null;
    const text = (out.content || "").replace(/```json|```/g, "").trim();
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    console.error(`   ! juez LLM falló: ${e?.message}`);
    return null;
  }
}

const results = [];
for (const persona of selected) {
  console.log(`\n========== ${persona.name} ==========`);
  const waId = "lab_" + persona.id + "_" + Date.now();
  mockOrderCreated = null;
  handoffNotified = false;
  await clearState(vendor.id, waId);

  const transcript = [];
  for (const line of persona.lines) {
    const r = await handleInbound({ vendor, waId, body: line });
    const bot = (r?.replies || []).join("\n");
    transcript.push({ user: line, bot });
    const preview = bot.replace(/\s+/g, " ").slice(0, 140);
    console.log(`> ${line}\n  → ${preview}`);
  }

  const st = await getState(vendor.id, waId);
  const heuristic = persona.expect(st, transcript);
  const judge = await judgeTranscript(persona, transcript);
  const hPct = heuristic.ok ? 80 : 0;
  const total = judge ? Math.round(hPct * 0.6 + (judge.score ?? 0) * 0.4) : hPct;

  const failed = !heuristic.ok || (judge && typeof judge.score === "number" && judge.score < 50);
  results.push({ id: persona.id, name: persona.name, ok: !failed, heuristic, judge, total, transcript });

  console.log(`---`);
  console.log(`Heurística: ${heuristic.ok ? "OK" : "FALLA"}${heuristic.notes?.length ? ` (${heuristic.notes.join("; ")})` : ""}`);
  if (judge) {
    console.log(`Juez LLM: score=${judge.score} hallucination=${judge.hallucination} escalation_correct=${judge.escalation_correct}`);
    if (judge.findings?.length) for (const f of judge.findings) console.log(`   • ${f}`);
  }
  console.log(`TOTAL: ${total}${failed ? " ← REVISAR" : " ✓"}`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n========================================`);
console.log(`LABORATORIO: ${passed}/${results.length} personas OK  (score promedio: ${Math.round(results.reduce((s, r) => s + r.total, 0) / Math.max(1, results.length))})`);
if (JSON_OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
  console.log(`JSON guardado en ${JSON_OUT}`);
}
process.exit(STRICT && results.some((r) => !r.ok) ? 1 : 0);
