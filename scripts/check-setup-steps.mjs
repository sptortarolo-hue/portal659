/**
 * Verificación del paso a paso de arranque (onboarding del comercio).
 * Corre con: node scripts/check-setup-steps.mjs
 *
 * Cubre las dos invariantes que le dan sentido a la feature:
 *
 *   1. los comercios que YA están operativos no ven nada (el wizard solo
 *      corre en el alta y la tarjeta está gateada por isNewVendor);
 *   2. la secuencia canónica (perfil → ubicación → contacto → pagos →
 *      catálogo → publicar) es la misma en los checks, los pasos del wizard
 *      y las secciones de Config, y respeta las diferencias por vertical.
 *
 * La primera parte importa el módulo real (funciones puras, client-safe);
 * la segunda lee el cableado en los archivos que lo montan.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

console.log("setup-steps: secuencia y estados");
const {
  setupKind,
  catalogNoun,
  setupChecks,
  setupProgress,
  wizardSteps,
  isNewVendor,
} = await import(pathToFileURL(join(root, "src/lib/setup-steps.ts")).href);

// --- 1. tipos por vertical + sustantivo del catálogo ----------------------
check("setupKind: híbridos (estética/salud/taller)", ["estetica", "salud", "taller"].every((v) => setupKind(v) === "hibrido"));
check("setupKind: servicio", setupKind("servicio") === "servicio");
check("setupKind: el resto es venta", ["gastronomia", "comercio", "moda", "otro", null].every((v) => setupKind(v) === "venta"));
check("catalogNoun por vertical", catalogNoun("gastronomia") === "plato" && catalogNoun("taller") === "servicio" && catalogNoun("moda") === "producto");

// --- 2. secuencia canónica ------------------------------------------------
const venta = wizardSteps("venta").map((s) => s.id);
check("7 pasos en el wizard", venta.length === 7, venta.join(","));
check(
  "orden canónico del wizard",
  venta.join(",") === "negocio,ubicacion,contacto,fotos,operacion,catalogo,listo",
  venta.join(",")
);
check("paso de operación por tipo", wizardSteps("venta")[4].title === "Pagos y entrega" && wizardSteps("hibrido")[4].title === "Turnos y presupuestos");
check("paso de catálogo por tipo", wizardSteps("venta")[5].title === "Tu catálogo" && wizardSteps("servicio")[5].title === "Tus servicios");

const checksVenta = setupChecks({}, {}, "venta").map((c) => c.id);
check(
  "checks de venta",
  ["perfil", "fotos", "descripcion", "ubicacion", "horarios", "whatsapp", "pagos", "catalogo", "cobros_online", "publicar"].every((id) =>
    checksVenta.includes(id)
  ),
  checksVenta.join(",")
);
const checksServicio = setupChecks({}, {}, "servicio").map((c) => c.id);
check("servicios no piden medios de pago", !checksServicio.includes("pagos"));
check("el catálogo manda al tab/página correcto", (() => {
  const target = (kind) => setupChecks({}, {}, kind).find((c) => c.id === "catalogo").target;
  const t = target("venta");
  return t.kind === "tab" && t.tab === "menu" && target("hibrido").tab === "servicios" && target("servicio").section === "servicios";
})());

// --- 3. progreso: los opcionales no bajan el % ----------------------------
const vacio = setupChecks({}, {}, "venta");
const lleno = setupChecks(
  {
    store_name: "Don Nicolás", category: "Pizzería", description: "Pizzas a la piedra para llevar.",
    image_url: "/x.jpg", address: "Av. 13 1234", lat: 1, lng: 2, hours: "lun: 09:00-21:00",
    whatsapp: "2215550000", payment_methods: "Efectivo",
  },
  { offers: 2 },
  "venta"
);
check("progreso 0% sin datos", setupProgress(vacio).pct === 0 && setupProgress(vacio).total === 8);
check("progreso 100% con lo obligatorio", setupProgress(lleno).pct === 100, String(setupProgress(lleno).pct));
check("los opcionales no cuentan para el %", setupProgress(lleno).pending.length === 2);
check("MP/publicar son opcionales", vacio.filter((c) => c.optional).map((c) => c.id).join(",") === "cobros_online,publicar");

// --- 4. ventana de "comercio nuevo" ---------------------------------------
const dias = (n) => new Date(Date.now() - n * 86400000).toISOString();
check("nuevo: creado hoy", isNewVendor({ created_at: dias(0) }));
check("nuevo: dentro de los 14 días", isNewVendor({ created_at: dias(13) }));
check("viejo: no se muestra", !isNewVendor({ created_at: dias(15) }));
check("sin fecha: se muestra (fail-open)", isNewVendor({}) && isNewVendor(null));

// --- 5. gating: los operativos no ven nada --------------------------------
const page = read("src/app/vendor/dashboard/page.tsx");
check("el wizard se monta en el branch de alta", /if \(!vendor \|\| \(altaOpen && !altaClosed\)\)/.test(page));
check("queda salida al formulario de siempre", /if \(!vendor && altaClosed\)/.test(page));
check("la tarjeta está gateada por isNewVendor", /setupCardNode[\s\S]{0,400}isNewVendor\(vendor\)/.test(page));
check("la tarjeta no sale en prueba ni para el equipo", /setupCardNode[\s\S]{0,300}previewSession[\s\S]{0,120}staffRole === "staff"/.test(page));
check("el modal 'completar' se abre con ?setup=1", /searchParams\.get\("setup"\) === "1"/.test(page));

const home = read("src/components/dashboard/dashboard-home.tsx");
check("el home acepta la tarjeta y la ubica arriba", /setupCard\?: ReactNode/.test(home) && /\{setupCard\}/.test(home));

const switcher = read("src/components/vendor/store-switcher.tsx");
check("la tienda Nº2 abre el paso a paso", switcher.includes("/vendor/dashboard?setup=1") && switcher.includes('url.searchParams.set("setup", "1")'));

const nav = read("src/components/dashboard/config-nav.ts");
check("los dots de Config cubren perfil/ubicación/contacto", nav.includes('id === "perfil"') && nav.includes('id === "ubicacion"') && nav.includes('id === "contacto"'));

const wizard = read("src/components/dashboard/onboarding/vendor-setup-wizard.tsx");
check("el wizard persiste borrador de 24h", wizard.includes('saveDraft(draftId, "setup"') && wizard.includes('loadDraft<'));
check("el paso final pide la publicación", wizard.includes("/api/vendor/publish-request"));
check("un solo modal de crop", (wizard.match(/<ImageCropModal/g) || []).length === 1);

console.log(failures === 0 ? "\nOK: paso a paso de arranque verificado." : `\n${failures} checks fallaron.`);
process.exit(failures === 0 ? 0 : 1);
