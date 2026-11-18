# Agente 659 — Del chatbot al agente (portal659)

> Cómo pasar el bot de WhatsApp de **responder turnos** a **perseguir objetivos**,
> sin reescribir lo que ya funciona. Complementa a `docs/piloto-whatsapp-bot.md`.

## El modelo que tenemos hoy (honesto)

```
cliente escribe → regex/reglas (¡siempre ganan!) → LLM-como-parser → bot ejecuta
```

El LLM solo aparece al final para "entender" el pedido; cada paso del pedido es
un `if (RE_X.test(text))` escrito a mano. Es un **autómata fijo**: si el
cliente dice algo fuera del guión (o pide dos cosas en un mensaje), se rompe
— como cuando dijo *"Boca quiero 3 y cerezas 8"* y el carrito entero se borró.

## Qué es un agente en este contexto

Un proceso con:
1. **Objetivo** declarado ("el cliente quiere comprar en Stickers DT"), no respuestas a mensajes sueltos.
2. **Estado de tarea** mantenido (qué falta para lograrlo / qué se hizo / qué bloqueó).
3. **Herramientas** que puede invocar y **verificar el efecto** de cada una.
4. **Límites** (cuántos pasos, cuánto gasta, cuándo escalar a un humano).
5. **Memoria** del historial relevante.
6. **Métricas** de su propio rendimiento (autónomo vs handoff).

## Lo que ya tenemos (y es la base)

| Capacidad | Dónde |
|---|---|
| Estado persistido por chat (`state`) | `state.mjs` (items, método, pago, pending X) |
| Memoria de último pedido / checkout exprés | `prefetchStoreMemory`, `_pendingReorder` |
| Function calling (LLM elige herramientas) | `nlu.mjs` + `tools.mjs` (registry) |
| Loops proactivos: abandoned-cart sweep, transferencia expirada, T-24, reviews | `wa-bot/index.mjs`, crons |
| Handoff a humano (opción 6, MAX_PARSE_MISSES) | `handoffHuman` |
| Idempotencia de pedido (`clientKey`) | `order-service.ts` |
| Embudo de conversión (`funnel_*` events) | `/admin/bots` |
| Suite de regresión de conversaciones reales | `test-golden.mjs` |
| Métricas de tokens + parseos LLM | `llmStats` (`nlu.mjs`), expuesto en `/health` |
| Back-stack de navegación del portal | `navStack`/`portalListContext` (nov-2026) |

## Punto de partida (nov-2026) — qué se hizo en Fase 1

- **Golden suite** (`test-golden.mjs`): 19+ checks que replayan casos reales de
  producción (notación `1 X3`, multi-edit del carrito, back-stack de navegación,
  sticky bar) como regresiones automáticas. Cada nuevo bug entra acá antes de
  seguir agregando features.
- **Tool registry** (`src/tools.mjs`): schema + handler de cada herramienta en un
  solo archivo. `TOOLS` para el LLM se deriva del registry (misma fuente de
  verdad, imposible divergencia). `dispatchTool` valida y ejecuta.
- **Métricas de tokens** en `llmStats.usage` para medir costo por pedido.

## Fase 2 — Agente planificador con objetivos (semanas, sin reescribir todo)

### Objetivo 1: `ORDER_PENDING` (compra)
El bot mantiene un objeto `task`:
```js
task = {
  goal: "order",            // único objetivo activo
  store: "stickers-dt",
  status: "building",       // building | awaiting_payment | ready | completed | blocked
  checkpoints: { picked: true, cartOk: true, methodSet: false, ... },
  missing: ["method", "payment"],
}
```
- El LLM deja de ser un parser: es el **decisor del siguiente paso** del objetivo
  (ReAct: Thought → Action → Observation). Las reglas de hoy quedan como
  **validadores/guardianes** (stock, tienda abierta, cupos, idempotencia).
- Después de cada tool call, el bot **observa el efecto** (ej.: pedido creado u
  ocasionó error 409/429) y se lo reporta al LLM en el siguiente turno — el LLM
  puede reaccionar ("no alcanza el stock, ofrezco 4 como máximo") en vez de
  volcar a "No te entendí".

### Objetivo 2: resume después de días/caídas
`state` sobrevive caídas de proceso; la tarea `ORDER_PENDING` se puede retomar a
los 3 días ("¿Seguimos con tu pedido de Stickers DT?"). La clave: persistir
`task` en el state (ya existe) y detectar al recibir un mensaje nuevo si hay
una tarea bloqueada reanudable.

### Objetivo 3: herramientas ampliadas
Mover el bot a tools en vez de regex para: `search_product`, `add_to_cart`,
`set_method`, `set_payment`, `apply_cart_edit`, `check_hours`,
`check_delivery_window`, `track_order`, `request_human`, `create_order`.
Las reglas actuales (`parseCatalogQtyPicks`, `applyCartEdit`…) se reusan como
handlers de tools — ya son funciones bien testeadas; el LLM solo las "invoca".

### Loop con límites (guards)
- Máx. N steps por turno (ej. 3). Cada uno consume presupuesto $.
- Timeout total por turno; si agota: fallback a "no entendí, ¿querés que te
  atienda una persona?".
- El LLM nunca configura montos ni stock: **el handler valida todo**.

### Métrica éxito
- % pedidos completados **sin handoff** (hoy medible con funnel_* events).
- % tool calls válidos al primer intento.
- Tasa de corrección del cliente tras la tool.

## Fase 3 — Agentes proactivos con políticas (on después de Fase 2)

Scripts-turned-policies: cada sweep actual se declara como política con
presupuesto y outs explícitos. Ej:
```
policy: abandono_carrito
when: carrito con items, 30 min sin actividad, tienda abierta/abre en < 2h
action: 1 recordatorio suave (1 vez), si no responde 30 min más → avisar al comercio
budget: 1 mensaje por conversación por política
out: handoff si responde pidiendo persona; cancela si abandonó o pidió
```

Idem: confirmación T-24 (turnos), avisos de transferencia vencida, re-engagement
de cliente inactivo 30d (pedidos) — todos como
`policy = { when, action, dedup_key, max_fires }` en un solo runner con
rate-limits por comercio y por número.

## Sistema de métricas para el agente (medir o no existe)

1. **Costo por pedido** (llmStats.usage por `funnel_order_created`).
2. **Resolución autónoma**: mensajes resueltos sin handoff / total.
3. **Corrección rate**: turnos donde el bot dijo "no entendí" (`nlu_not_understood`) por mensaje.
4. **Embudo**: store_selected → items_added → confirm_shown → order_created (ya existe).
5. **Tool accuracy**: % tool calls que pasan validación a la primera.

Exponer en `/admin/bots` como sección "Salud del agente" (solo admin).

## Menú Laboratorio (`npm run lab`)

`laboratorio.mjs`: 6 clientes simulados (decidido, preguntón, enojado, fuera-de-conocimiento, exige-humano, typo-argentino) hablan con el bot REAL usando mocks del portal-menu. Asserts deterministas (el peso real de la suite) + juez LLM opcional que puntúa 0-100 leyendo la transcripción (usa el mismo proveedor configurado; en local sin llaves corre solo los asserts; como en Vocero, cada personaje nuevo que falle debe convertirse en caso del `test-golden.mjs`).

- `node laboratorio.mjs` — todas
- `node laboratorio.mjs --list`
- `node laboratorio.mjs --strict` — exit 1 si alguna persona falla
- `node laboratorio.mjs --json out.json`

## Principios de diseño (lo que NO se diluye)

1. **Nada toca la DB sin handler**. El LLM emite intención-argument; el handler
   ejecuta con sus propios límites (cantidad ≤ 99, montos ≤ tope, store ≠ stock).
2. **El cliente nunca recibe texto del LLM sin filtrar**. Fuentes de verdad =
   DB/handlers; el LLM produce texto solo si pasó validación, si no → fallback
   honesto ("no te entendí…, probar con…").
3. **Handoff siempre disponible** y mejorado: escalar con contexto (último
   mensaje + carrito + qué falló), no un simple "le aviso a alguien".
4. **Prueba antes de producción**: `test-golden.mjs` corre en CI/local cada push
   que toca `services/wa-bot`. Ningún bug vuelve a entrar sin un caso en el golden.
5. **Kill switches**: `BOT_TAKE_ORDERS`, `wa_bots.enabled` por comercio — todo lo
   del agente corre dentro de estos anillos.

## Roadmap sugerido (priorizado por ROI)

1. ~~Golden suite + tool registry~~ (Fase 1 — hecho)
2. Tool `search_product` + tool `track_order` con sus handlers (2h/tools, ~0 riesgo)
3. Loop ReAct para `ORDER_PENDING` detrás de `LLM_ORDER_LOOP=1` (canary por comercio)
4. `task` persistente + resumible en `state` (1 día)
5. Observación post-tool en el prompt (el bot "ve" el efecto antes de responder)
6. Métricas de salud del agente en `/admin/bots`
7. Políticas-como-código para los sweeps (sin LLM, solo runner unificado)
