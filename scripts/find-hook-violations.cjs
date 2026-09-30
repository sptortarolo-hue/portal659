// Detecta componentes/hooks con early-return ANTES de hooks (causa del
// React #300: "Rendered fewer hooks than expected").
// Uso: node scripts/find-hook-violations.cjs
// Cubre: returns en la misma línea, multilínea (if { return }), hooks con y
// sin asignación, y custom hooks (function useX / const useX =).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "src");
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.tsx$/.test(f.name)) files.push(p);
  }
})(root);

const HOOK_RE = /(?:^|[^A-Za-z0-9_$])use(State|Effect|Memo|Callback|Ref|Context|Id|RenderGuard|ImperativeHandle|DebugValue|SyncExternalStore|InsertionEffect)\s*\(/;
const COMP_RE = /^(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)/;
const ARROW_RE = /^(?:export\s+)?const\s+([A-Z][A-Za-z0-9]*)\s*=/;
const HOOKFN_RE = /^(?:export\s+)?(?:(?:async\s+)?function\s+(use[A-Z][A-Za-z0-9]*)|const\s+(use[A-Z][A-Za-z0-9]*)\s*=)/;

function stripStrings(src) {
  return src
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\/\/[^\n]*/g, "");
}

// profundidad de llaves al INICIO de cada línea (scope del archivo)
function depths(lines) {
  const out = new Array(lines.length).fill(0);
  let d = 0;
  for (let i = 0; i < lines.length; i++) {
    out[i] = d;
    for (const ch of lines[i]) {
      if (ch === "{") d++;
      else if (ch === "}") d--;
    }
  }
  return out;
}

let hits = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, "utf8").split("\n");
  const src = stripStrings(raw.join("\n")).split("\n");
  const dep = depths(src);
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    let m = line.match(COMP_RE) || line.match(ARROW_RE) || line.match(HOOKFN_RE);
    if (!m) continue;
    const name = m[1] || m[2] || m[3];
    if (/^use(State|Effect|Memo|Callback|Ref|Context|Id)$/.test(name)) continue;
    const baseDepth = dep[i]; // profundidad donde abre el cuerpo
    let earlyReturn = -1;
    for (let j = i + 1; j < src.length; j++) {
      // fin del componente: otra declaración top-level (incluye export default)
      if (dep[j] === 0 && /^(export\s+default\s+)?(export\s+)?(function|const|class|type|interface)\s+[A-Z]/.test(src[j].trim()) && j > i + 1) break;
      if (j - i > 800) break;
      const t = src[j].trim();
      // return temprano en el cuerpo directo (una más que la base)
      if (dep[j] === baseDepth + 1 && /^if\s*\(.*\)\s*return(<| null|;|\s|$)/.test(t)) {
        if (earlyReturn < 0) earlyReturn = j + 1;
      }
      // if multilínea: if (...) { return ... } en la línea siguiente
      if (dep[j] === baseDepth + 1 && /^if\s*\(.*\)\s*\{\s*$/.test(t)) {
        const nx = (src[j + 1] || "").trim();
        if (/^return(<| null|;|\s|$)/.test(nx) && earlyReturn < 0) earlyReturn = j + 2;
      }
      if (dep[j] === baseDepth + 1 && HOOK_RE.test(t) && earlyReturn > 0) {
        console.log(
          `${path.relative(root, f)} :: ${name} :: RETURN@${earlyReturn} HOOK_AFTER@${j + 1} :: ${raw[j].trim().slice(0, 90)}`
        );
        hits++;
        break;
      }
    }
  }
}
console.log(hits === 0 ? "CLEAN: sin violaciones" : `VIOLACIONES: ${hits}`);
