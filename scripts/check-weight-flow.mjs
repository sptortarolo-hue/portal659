/**
 * Verificación del flujo de pedidos pesables en modo "confirmar"
 * ("pesar y cobrar el real"). Corre con: node scripts/check-weight-flow.mjs
 *
 * Invariantes que vigila (un refactor no debe romperlos):
 *
 *   1. El control de pesar vive solo en PREPARACIÓN (en "Nuevo" solo se avisa)
 *      y el server no deja marcar Listo sin el peso confirmado.
 *   2. Preparar es libre (el cliente no puede pagar antes del total real);
 *      despachar/entregar exige el pago (efectivo queda fuera a propósito).
 *   3. Al confirmar el peso se manda AUTOMÁTICO el WhatsApp al cliente
 *      ("preparado y pesado" + total real + datos de pago), con la misma
 *      lógica que el reenvío manual (helper compartido).
 *   4. El checkout tiene un solo botón de confirmar en modo confirmar
 *      (sin MP directo); MP es una opción más del selector, solo si el
 *      comercio la tiene conectada.
 *   5. No existe el paso "Aceptar total" (weight_approved_at): el cliente
 *      paga y listo.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const patchRoute = read("src/app/api/vendor/orders/[id]/route.ts");
const helper = read("src/lib/weighed-order-message.ts");
const sendRoute = read("src/app/api/vendor/orders/[id]/send-weighed-order/route.ts");
const waLib = read("src/lib/whatsapp-message.ts");
const modal = read("src/components/dashboard/order-detail-modal.tsx");
const kanban = read("src/components/dashboard/orders-kanban.tsx");
const checkout = read("src/app/checkout/page.tsx");
const payments = read("src/app/api/payments/route.ts");
const seguimiento = read("src/app/seguimiento/[token]/page.tsx");
const comercio = read("src/components/dashboard/dashboard-comercio.tsx");
const vendorMe = read("src/app/api/vendor/me/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

// --- 1. control de pesar en Preparación --------------------------------
check(
  "modal: canWeigh solo en preparing",
  /const canWeigh = weightPending && order\.status === "preparing";/.test(modal),
  "falta canWeigh"
);
check(
  "modal: el bloque de peso usa canWeigh",
  /!editing && \(canWeigh \|\| weightEditing\)/.test(modal)
);
check(
  "modal: en otros estados solo aviso (sin botón)",
  /weightPending && !canWeigh && !weightEditing/.test(modal)
);

// --- 2. gates del PATCH ------------------------------------------------
check(
  "server: preparar libre (new -> preparing no pide peso)",
  /status !== "preparing"[\s\S]{0,400}weight_not_confirmed/.test(patchRoute)
);
check(
  "server: Listo exige peso (ready en el gate)",
  /ADVANCE_STATUSES\.includes\(status\) &&\s*\r?\n\s*status !== "preparing"/.test(patchRoute)
);
check(
  "server: despachar/entregar exige pago",
  /DISPATCH_STATUSES\.includes\(status\)/.test(patchRoute) &&
    /weightUnpaidGate/.test(patchRoute)
);
check(
  "server: efectivo nunca bloqueado por pago",
  /weightUnpaidGate =\s*\r?\n\s*!!status &&\s*\r?\n\s*isWeightFlow &&\s*\r?\n\s*DISPATCH_STATUSES\.includes\(status\) &&\s*\r?\n\s*currentOrder\.payment_status === "pending" &&\s*\r?\n\s*\(currentOrder\.payment_method === "transferencia" \|\| currentOrder\.payment_method === "mercadopago"\)/.test(patchRoute)
);

// --- 3. WhatsApp automático --------------------------------------------
check(
  "server: importa el helper compartido",
  /import \{ sendWeighedOrder \} from "@\/lib\/weighed-order-message"/.test(patchRoute)
);
check(
  "server: manda el WA tras confirmar el peso (best-effort)",
  /weighedWa = await sendWeighedOrder\(/.test(patchRoute)
);
check(
  "server: devuelve weighed_wa al panel",
  /weighed_wa: weighedWa/.test(patchRoute)
);
check(
  "ruta manual reusa el helper",
  /import \{ sendWeighedOrder \} from "@\/lib\/weighed-order-message"/.test(sendRoute) &&
  !/buildWeighedOrderMessage/.test(sendRoute)
);
check(
  "mensaje: 'preparado y pesado'",
  /preparado y pesado/.test(waLib)
);
check(
  "mensaje: ramas efectivo / transferencia / MP / coordinar",
  /case "efectivo"/.test(waLib) && /case "transferencia"/.test(waLib) &&
    /case "mercadopago"/.test(waLib) && /default:/.test(waLib)
);
check(
  "mensaje: efectivo puede avisar aunque el pedido nazca pagado",
  /needsPending && order\.payment_status === "paid"/.test(helper)
);

// --- 4. checkout: un solo botón en modo confirmar ----------------------
check(
  "checkout: tipo paymentMethod incluye mercadopago",
  /useState<"whatsapp" \| "efectivo" \| "transferencia" \| "mercadopago">/.test(checkout)
);
check(
  "checkout: sin botón MP directo cuando mpDeferred",
  /mpConfigured && !isPreview && !mpDeferred/.test(checkout) &&
    !/Pedir y pagar despu/.test(checkout)
);
check(
  "checkout: MP como opción del selector (solo con MP conectada)",
  /mpDeferred && mpConfigured/.test(checkout) &&
    /setPaymentMethod\("mercadopago"\)/.test(checkout)
);
check(
  "checkout: éxito 'pendiente de peso' para cualquier método",
  /setDoneWeightPending\(mpDeferred\)/.test(checkout)
);

// --- 5. sin "Aceptar total" --------------------------------------------
check(
  "endpoint approve borrado",
  !existsSync(join(root, "src/app/api/orders/track/[token]/approve"))
);
check(
  "payments: sin gate approval_required",
  !/approval_required/.test(payments)
);
check(
  "seguimiento: sin botón Aceptar total",
  !/Aceptar total/.test(seguimiento)
);
check(
  "panel: sin input de tolerancia",
  !/Tolerancia sin aprobar/.test(comercio) && !/weight_tolerance_pct/.test(comercio)
);
check(
  "API no acepta weight_tolerance_pct",
  !/weight_tolerance_pct/.test(vendorMe)
);

// --- 6. Kanban / mobile -------------------------------------------------
check(
  "kanban: avance bloqueado sin pesar / sin pagar",
  /advanceBlockedCard/.test(kanban) && /weightPendingCard/.test(kanban)
);
check(
  "kanban: guarda server-side en handleNextStatus",
  /wPending && next !== "preparing"/.test(kanban)
);

console.log("");
if (failures > 0) {
  console.log(`✗ ${failures} invariante(s) rota(s)`);
  process.exit(1);
}
console.log("✓ flujo pesable modo confirmar: todas las invariantes en su lugar");
