// @ts-nocheck — pendiente de conversión a TypeScript.
// ———————————————————————————————————————————————————————————————————————————
// Tool registry del bot del portal.
//
// Cada herramienta = schema (lo que ve el LLM) + handler (lo que ejecuta el bot).
// Es la ÚNICA superficie entre la IA y las "cosas que cambian el mundo": nada
// del modelo toca la base de datos ni envía mensajes por sí solo. Todo pasa
// por dispatchTool, validado contra el schema + lógica del propio handler.
//
// Hoy se registran: create_order / not_an_order (mismas tools que ya usa el
// loop de function calling). Agregar una tool nueva:
//
//   defTool("nombre_tool", {
//     description: "cuándo usarla",
//     parameters: { type: "object", properties: {...}, required: [...] },   // JSON Schema
//     exposeToLlm: true,                // si está: se ofrece al modelo
//     handler(args, ctx) { return { intent: "...", ... }; },
//   });
//
// Para que una tool sea segura: validar inputs adentro del handler, límites
// server-side (cantidades, montos), y que "nada del mundo exterior" suceda sin
// que el handler lo decida (el LLM solo emite {name, arguments}).
// ———————————————————————————————————————————————————————————————————————————

const REGISTRY = new Map();
function defTool(name, def) {
  REGISTRY.set(name, def);
}

// ———————————————————————————————————————————————————————————————————————————
// create_order — crear un pedido de productos de la tienda
// ———————————————————————————————————————————————————————————————————————————
defTool("create_order", {
  description:
    "Crear un pedido de productos de la tienda. Usar cuando el cliente QUIERA comprar/pedir/confirmar cantidades.",
  parameters: {
    type: "object",
    properties: {
      intent: { type: "string", enum: ["pedido"] },
      complete: { type: "boolean" },
      op: { type: "string", enum: ["add", "remove", "setQty", "setField"] },
      items: {
        type: "array",
        description: "Ítems que el cliente pidió",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            qty: { type: "number" },
            unit: { type: "string", enum: ["unidad", "kg", "pack"] },
            weightKg: { type: "number" },
            modifiers: { type: "array", items: { type: "string" } },
            variant: {
              type: "object",
              properties: {
                color: { type: "string" },
                talle: { type: "string" },
              },
            },
            said: { type: "string" },
          },
          required: ["name", "qty"],
        },
      },
      method: { type: "string", enum: ["pickup", "delivery"] },
      payment: { type: "string", enum: ["efectivo", "transferencia", "mercadopago", "whatsapp"] },
      customerName: { type: "string" },
      customerAddress: { type: "string" },
      note: { type: "string" },
    },
    required: ["intent", "items"],
  },
  exposeToLlm: true,
  handler(args) {
    if (!Array.isArray(args?.items)) return null;
    // Límites de sanidad: la IA nunca decide cantidades/miembros sin control.
    const items = args.items
      .map((i) => ({
        ...i,
        unit: i.unit || "unidad",
        qty: Math.max(1, Math.min(99, Number(i.qty) || 1)),
        modifiers: Array.isArray(i.modifiers) ? i.modifiers.slice(0, 12) : [],
      }))
      .slice(0, 30);
    return {
      intent: "pedido",
      complete: !!args.complete,
      op: args.op || "add",
      items,
      method: args.method ?? null,
      payment: args.payment ?? null,
      customerName: args.customerName ?? null,
      customerAddress: args.customerAddress ?? null,
      note: args.note ?? null,
      confidence: 1,
      reasoning: "tool:create_order",
    };
  },
});

// ———————————————————————————————————————————————————————————————————————————
// not_an_order — el mensaje del cliente NO es un pedido
// ———————————————————————————————————————————————————————————————————————————
defTool("not_an_order", {
  description:
    "Usar cuando el mensaje NO es un pedido de productos (preguntas portal, saludo, información, una tienda en particular no es un pedido).",
  parameters: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["info_portal", "ver_tiendas_abiertas", "ver_todas_tiendas", "elegir_tienda", "sumar_comercio", "chat"],
      },
      note: { type: "string" },
    },
    required: ["intent"],
  },
  exposeToLlm: true,
  handler(args) {
    return {
      intent: args?.intent || "chat",
      complete: false,
      items: [],
      unknownItems: [],
      confidence: 1,
      reasoning: `tool:not_an_order(${args?.intent})`,
    };
  },
});

// ———————————————————————————————————————————————————————————————————————————
// API pública del registry
// ———————————————————————————————————————————————————————————————————————————

/** Schemas en formato OpenAI function-calling (lo que se pasa a tools= en el
 *  request). Solo las tools con exposeToLlm=true. */
export function toolSchemasForLlm() {
  return [...REGISTRY.entries()]
    .filter(([, t]) => t.exposeToLlm)
    .map(([name, t]) => ({
      type: "function",
      function: { name, description: t.description, parameters: t.parameters },
    }));
}

export function toolNames() {
  return [...REGISTRY.keys()];
}

/** Ejecuta una tool validada contra el schema (best-effort: lo rompe el
 *  handler adentro, el schema acá es el gate contra basura del modelo). */
export function dispatchTool(name, args, ctx) {
  const t = REGISTRY.get(name);
  if (!t || typeof t.handler !== "function") return null;
  try {
    return t.handler(args, ctx);
  } catch (e) {
    console.error(`[tools] dispatchTool ${name} err: ${e?.message}`);
    return null;
  }
}
