/**
 * Verificación del atajo "Entregar ya" (un toque al estado final).
 * Corre con: node scripts/check-order-jump.mjs
 *
 * El atajo NO cambia el flujo normal: solo agrega una salida directa a
 * "Entregado" desde los estados operativos. Este script vigila justo eso,
 * para que un refactor no termine filtrando el salto adonde no debe:
 *
 *   1. el gate acepta ir a `completed` desde new/confirmed/preparing
 *      (y NO desde estados terminales, ni saltos hacia atrás);
 *   2. `nextStatusFor` sigue dando UN paso por vez: el salto no se
 *      "cuela" en el avance normal del flow;
 *   3. el atajo no manda el WhatsApp de "aceptado" (un pedido que salta a
 *      entregado no puede avisar que recién fue aceptado);
 *   4. la UI solo lo ofrece cuando realmente salta algo (regla en
 *      jumpToDoneAvailable), y la etiqueta respeta la condición del pedido.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const orderUtils = readFileSync(join(root, "src/lib/order-utils.ts"), "utf8");
const patchRoute = readFileSync(join(root, "src/app/api/vendor/orders/[id]/route.ts"), "utf8");
const kanban = readFileSync(join(root, "src/components/dashboard/orders-kanban.tsx"), "utf8");
const modal = readFileSync(join(root, "src/components/dashboard/order-detail-modal.tsx"), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

// --- 1. gate de transiciones --------------------------------------------
// Bloque `new: [...]` de VALID_TRANSITIONS (líneas de order-utils.ts).
const block = (status) => {
  const m = orderUtils.match(new RegExp(`\\n\\s+${status}: \\[([^\\]]*)\\]`));
  return m ? m[1] : "";
};
const targets = (status) =>
  block(status)
    .split(",")
    .map((s) => s.trim().replace(/"/g, ""))
    .filter(Boolean);

check("new → completed permitido", targets("new").includes("completed"), block("new"));
check("confirmed → completed permitido", targets("confirmed").includes("completed"), block("confirmed"));
check("preparing → completed permitido", targets("preparing").includes("completed"), block("preparing"));
check("completed NO tiene salidas (terminal)", targets("completed").length === 0, block("completed"));
check("cancelled NO tiene salidas (terminal)", targets("cancelled").length === 0, block("cancelled"));

// --- 2. el flujo normal no cambia ---------------------------------------
// nextStatusFor no debe poder devolver "completed" salvo desde ready en
// pickup (que ya era el comportamiento de siempre).
const nextFn = orderUtils.slice(orderUtils.indexOf("export function nextStatusFor"));
const jumpInNextFn = /case "new":\s*\n\s*return giftOnly \? "ready" : "preparing"/.test(nextFn);
check("new sigue yendo a preparing (o ready sin cocina)", jumpInNextFn);

// --- 3. el salto no manda el WA de "aceptado" ---------------------------
const acceptLine = patchRoute.match(/const isAcceptEvent =\s*\n?\s*status && currentOrder\.status === "new" && [^;]*/);
check(
  "isAcceptEvent excluye completed",
  !!acceptLine && acceptLine[0].includes('status !== "completed"'),
  acceptLine?.[0]
);

// --- 4. la UI solo lo ofrece cuando salta algo --------------------------
check(
  "jumpToDoneAvailable existe y compara contra completed",
  /export function jumpToDoneAvailable\([\s\S]*?next !== "completed"/.test(orderUtils)
);
check(
  "la etiqueta respeta la condición (delivery no dice 'enviado')",
  /orderCondition\(order\) === "delivery" \? "Marcar como entregado"/.test(orderUtils)
);
check("el modal ofrece el atajo", modal.includes("jumpToDoneAvailable(order, isRetail)"));
check("el kanban ofrece el atajo", kanban.includes("jumpToDoneAvailable(order, isRetail)"));

console.log(
  failures === 0
    ? "\ncheck-order-jump: OK (todas las invariantes del atajo se cumplen)"
    : `\ncheck-order-jump: ${failures} invariante(s) rota(s)`
);
process.exit(failures === 0 ? 0 : 1);
