/**
 * Verificación del diseño del panel (Tasty Station UI) contra el theme del
 * usuario (spec v2).
 * Corre con: node scripts/check-panel-ui.mjs
 *
 * EL THEME DEL USUARIO ES LA FUENTE DE VERDAD: este script lo traduce a
 * tokens y lo vigila token por token, para que el panel no se desvíe sin
 * que nadie se entere. Si el theme cambia, se actualiza el CSS del panel y
 * este script (que falla si un token no coincide exactamente).
 *
 * Comprueba:
 *   1. los tokens del theme están con su valor exacto (claro y oscuro),
 *      incluido el accent ámbar y sus variantes de oscuro;
 *   2. los tokens viven bajo `.ts-ui`, NUNCA en `:root` (el sitio público
 *      no se puede repintar) y no quedó la lima de una versión anterior;
 *   3. la escala de sombras del theme está conectada a las utilidades
 *      shadow-* de Tailwind (en v4 hay que pisar `--tw-shadow`);
 *   4. los bordes por defecto usan el token, pero las utilidades de color
 *      (border-red-400…) siguen mandando (están en la capa components);
 *   5. el foco usa el aro del panel al 50%;
 *   6. la paleta de charts del theme existe (claro y oscuro);
 *   7. el switch de diseño sigue siendo POR NAVEGADORA y con default
 *      clásico (nadie cambia el look de producción sin apagarlo).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/app/styles/tasty-station.css"), "utf8");
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
const helper = readFileSync(join(root, "src/lib/panel-ui.ts"), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

/** Tokens que el spec fija con un valor literal (no se toleran desvíos). */
const SPEC_LIGHT = {
  "--color-background": "oklch(0.9789 0.0082 121.6272)",
  "--color-foreground": "oklch(0 0 0)",
  "--color-card": "oklch(1 0 0)",
  "--color-primary": "oklch(0.6341 0.1195 232.0836)",
  "--color-primary-foreground": "oklch(1 0 0)",
  "--color-secondary": "oklch(0.8153 0.2710 141.6680)",
  "--color-muted": "oklch(0.9551 0 0)",
  "--color-muted-foreground": "oklch(0.3211 0 0)",
  "--color-accent": "oklch(0.7686 0.1647 70.0804)",
  "--color-accent-foreground": "oklch(0 0 0)",
  "--color-destructive": "oklch(0.6368 0.2078 25.3313)",
  "--color-border": "oklch(0 0 0)",
  "--color-input": "oklch(0.5555 0 0)",
  "--color-ring": "oklch(0.7853 0.1041 274.7134)",
  "--color-sidebar": "oklch(0.9789 0.0082 121.6272)",
  "--color-sidebar-primary": "oklch(0.5106 0.2301 276.9656)",
  "--color-sidebar-primary-foreground": "oklch(1 0 0)",
  "--color-sidebar-accent": "oklch(0.7686 0.1647 70.0804)",
  "--color-sidebar-accent-foreground": "oklch(0 0 0)",
  "--color-sidebar-border": "oklch(0 0 0)",
  "--color-sidebar-ring": "oklch(0.7853 0.1041 274.7134)",
  "--color-chart-1": "oklch(0.5106 0.2301 276.9656)",
  "--color-chart-2": "oklch(0.7038 0.1230 182.5025)",
  "--color-chart-3": "oklch(0.7686 0.1647 70.0804)",
  "--color-chart-4": "oklch(0.6559 0.2118 354.3084)",
  "--color-chart-5": "oklch(0.7227 0.1920 149.5793)",
  "--radius-sm": "12px",
  "--radius-md": "14px",
  "--radius-lg": "16px",
  "--radius-xl": "20px",
};

const SPEC_DARK = {
  "--color-background": "oklch(0 0 0)",
  "--color-foreground": "oklch(1 0 0)",
  "--color-card": "oklch(0.2455 0.0217 257.2823)",
  "--color-primary": "oklch(0.6341 0.1195 232.0836)",
  "--color-primary-foreground": "oklch(0 0 0)",
  "--color-muted": "oklch(0.3211 0 0)",
  "--color-muted-foreground": "oklch(0.8452 0 0)",
  "--color-accent": "oklch(0.8790 0.1534 91.6054)",
  "--color-accent-foreground": "oklch(0 0 0)",
  "--color-destructive": "oklch(0.7467 0.2202 324.8734)",
  "--color-border": "oklch(0.4459 0 0)",
  "--color-input": "oklch(1 0 0)",
  "--color-ring": "oklch(0.6801 0.1583 276.9349)",
  "--color-sidebar": "oklch(0 0 0)",
  "--color-sidebar-foreground": "oklch(1 0 0)",
  "--color-sidebar-primary": "oklch(0.6801 0.1583 276.9349)",
  "--color-sidebar-primary-foreground": "oklch(0 0 0)",
  "--color-sidebar-accent": "oklch(0.8790 0.1534 91.6054)",
  "--color-sidebar-accent-foreground": "oklch(0 0 0)",
  "--color-sidebar-border": "oklch(1 0 0)",
  "--color-sidebar-ring": "oklch(0.6801 0.1583 276.9349)",
  "--color-chart-1": "oklch(0.6801 0.1583 276.9349)",
  "--color-chart-2": "oklch(0.7845 0.1325 181.9120)",
  "--color-chart-3": "oklch(0.8790 0.1534 91.6054)",
  "--color-chart-4": "oklch(0.7253 0.1752 349.7607)",
  "--color-chart-5": "oklch(0.8003 0.1821 151.7110)",
};

/** Bloque de tokens de un selector (`.ts-ui` o `html.dark .ts-ui`). */
const blockOf = (selector) => {
  const i = css.indexOf(selector + " {");
  if (i === -1) return "";
  const end = css.indexOf("\n}", i);
  return css.slice(i, end === -1 ? undefined : end);
};

const light = blockOf(".ts-ui");
const dark = blockOf("html.dark .ts-ui");

/** Sin comentarios: los valores se comparan contra el CSS real. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const lightCss = strip(light);
const darkCss = strip(dark);

console.log("panel-ui: verificación contra el theme del usuario (spec v2)");

// 1. Tokens del theme (claro y oscuro).
for (const [token, value] of Object.entries(SPEC_LIGHT)) {
  check(
    `claro ${token} = ${value}`,
    lightCss.includes(`${token}: ${value};`),
    light.match(new RegExp(`${token}:[^;]+;`))?.[0],
  );
}
for (const [token, value] of Object.entries(SPEC_DARK)) {
  check(
    `oscuro ${token} = ${value}`,
    darkCss.includes(`${token}: ${value};`),
    dark.match(new RegExp(`${token}:[^;]+;`))?.[0],
  );
}

// 2. Aislamiento: los tokens del panel NO pueden estar en :root.
const rootBlock = (() => {
  const i = globals.indexOf(":root {");
  if (i === -1) return "";
  const end = globals.indexOf("\n}", i);
  return globals.slice(i, end === -1 ? undefined : end);
})();
check(
  "los tokens del panel NO están en :root de globals.css",
  !Object.keys(SPEC_LIGHT).some((t) => rootBlock.includes(t)),
);
check(
  "el panel se aísla con la clase .ts-ui",
  css.includes(".ts-ui {") && !css.includes(":root {"),
);

// 2b. El theme manda: dentro del panel NO puede quedar la lima de antes
// (#a3e635) ni ningún color hardcodeado en los tokens del theme.
check(
  "no queda la lima #a3e635 en los tokens del panel",
  !lightCss.includes("#a3e635") && !darkCss.includes("#a3e635"),
);
check(
  "el ítem activo del riel y el 'Hoy' siguen al accent del theme",
  lightCss.includes("--color-primary-light: var(--color-accent)") &&
    lightCss.includes("--color-sun: var(--color-accent)") &&
    darkCss.includes("--color-primary-light: var(--color-accent)") &&
    darkCss.includes("--color-sun: var(--color-accent)"),
);

// 3. Sombras: en Tailwind v4 las shadow-* fijan --tw-shadow, hay que pisarla.
check(
  "las utilidades shadow-* pisan --tw-shadow",
  /\.shadow-sm[\s\S]{0,400}--tw-shadow:\s*var\(--ts-shadow-card\)/.test(css),
);
check(
  "shadow-lg usa la intensidad pop (no xl)",
  /\.shadow-lg\s*\{[^}]*--tw-shadow:\s*var\(--ts-shadow-pop\)/.test(css),
);
check(
  "shadow-xl usa la intensidad float",
  /\.shadow-xl\s*\{[^}]*--tw-shadow:\s*var\(--ts-shadow-float\)/.test(css),
);
check(
  "la escala --shadow-* del spec está declarada",
  ["--shadow-sm", "--shadow-md", "--shadow-lg", "--shadow-xl"].every((t) =>
    light.includes(`${t}: var(--ts-shadow`),
  ),
);

// 4. Bordes: por defecto el token; con color explícito manda la utilidad.
check(
  "el borde por defecto usa --color-border",
  /\.border,[\s\S]{0,400}border-color:\s*var\(--color-border\)/.test(css),
);
const borderRuleIdx = css.indexOf('html[data-panel-ui="tasty"] .ts-ui .border,');
const componentsIdx = css.indexOf("@layer components {");
check(
  "la regla de bordes está en la capa components (las utilidades ganan)",
  borderRuleIdx > -1 && componentsIdx > -1 && borderRuleIdx > componentsIdx,
);
check(
  "el remapeo de superficies (.bg-card) también está en components",
  /@layer components\s*\{[\s\S]{0,1200}\.bg-card\s*\{/.test(css),
);

// 5. Foco: aro del panel al 50%.
check(
  "el foco usa --ts-ring-focus (aro al 50%)",
  css.includes("--ts-ring-focus:") && css.includes("outline: 2px solid var(--ts-ring-focus)"),
);

// 6. Charts: la paleta del spec tiene que existir en claro y oscuro.
check(
  "los charts usan los tokens del spec",
  Object.keys(SPEC_LIGHT)
    .filter((t) => t.startsWith("--color-chart"))
    .every((t) => light.includes(t) && dark.includes(t)),
);

// 7. Switch por navegador, default clásico.
check("el default del panel sigue siendo clásico", helper.includes('PANEL_UI_DEFAULT: PanelUi = "classic"'));
check("el switch es por cookie de navegador", helper.includes('PANEL_UI_COOKIE = "portal659-panel-ui"'));
check("se puede probar con ?ui=tasty", helper.includes('get("ui")'));

if (failures > 0) {
  console.log(`\npanel-ui: ${failures} chequeo(s) FALLARON`);
  process.exit(1);
}
console.log("\npanel-ui: todo OK");
