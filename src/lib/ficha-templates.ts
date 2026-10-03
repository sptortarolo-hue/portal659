/**
 * Presets de fichas dinámicas de estética (punto de partida del constructor).
 * El comercio los instancia con "Crear desde plantilla" y edita su copia.
 * Tipos de campo: section | text | textarea | date | scale | check |
 * multiselect | select-one | photo | signature | consent.
 * - `show_if: { field, equals }` = lógica condicional (muestra el campo solo
 *   si otro vale lo indicado; `equals` puede ser escalar o array).
 * - `check`: respuesta No/Sí (+detalle opcional con `detail`).
 * - `alert: true` = si la respuesta es afirmativa/riesgosa levanta 🚨 en el
 *   turno y la ficha (patrón contraindicaciones).
 */

export type FormFieldType =
  | "section"
  | "text"
  | "textarea"
  | "date"
  | "scale"
  | "check"
  | "multiselect"
  | "select-one"
  | "photo"
  | "signature"
  | "consent";

export type ShowIf = {
  field: string;
  equals: string | number | boolean | (string | number | boolean)[];
};

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  /** multiselect / select-one */
  options?: string[];
  /** multiselect: permite "Otra" con texto libre */
  allowOther?: boolean;
  /** check: pide detalle (ej. "¿Cuál?") */
  detail?: boolean;
  detailLabel?: string;
  /** scale */
  min?: number;
  max?: number;
  /** photo */
  maxPhotos?: number;
  /** consent: texto legal a aceptar */
  text?: string;
  /** lógica condicional */
  show_if?: ShowIf | null;
  /** bandera de riesgo */
  alert?: boolean;
  alertLabel?: string;
};

export type FormPreset = {
  key: string;
  name: string;
  description: string;
  fields: FormField[];
};

const OTRO = "Otro";

export const FICHA_PRESETS: FormPreset[] = [
  {
    key: "masajes",
    name: "Ficha de masajes",
    description: "Motivo, zonas, antecedentes y evolución por sesión (tensión 0-10).",
    fields: [
      { id: "sec_motivo", type: "section", label: "Motivo de la consulta" },
      {
        id: "tipo_masaje", type: "multiselect", label: "¿Qué tipo de masaje realiza?",
        options: ["Relajante", "Descontracturante", "Cráneo-facial", "Bruxismo"],
        allowOther: true, required: true,
      },
      {
        id: "zonas", type: "multiselect", label: "Zonas a trabajar",
        options: ["Espalda", "Cuello", "Hombros", "Brazos", "Manos", "Piernas", "Pies", "Rostro/cráneo"],
        allowOther: true, required: true,
      },
      { id: "sec_antec", type: "section", label: "Antecedentes / información importante" },
      { id: "lesion", type: "textarea", label: "¿Presenta actualmente alguna lesión, dolor o molestia?" },
      { id: "condicion", type: "textarea", label: "¿Tiene alguna condición o situación que debamos tener en cuenta para la sesión?" },
      { id: "medicacion", type: "textarea", label: "¿Está tomando alguna medicación?" },
      { id: "sec_durante", type: "section", label: "Durante la sesión" },
      { id: "zona_tension", type: "text", label: "Zona/s con mayor tensión" },
      { id: "tension_antes", type: "scale", label: "Nivel de tensión/dolor antes", min: 0, max: 10 },
      { id: "obs_durante", type: "textarea", label: "Observaciones" },
      { id: "sec_despues", type: "section", label: "Después de la sesión" },
      { id: "tension_despues", type: "scale", label: "Nivel de tensión/dolor después", min: 0, max: 10 },
      { id: "como_sintio", type: "textarea", label: "¿Cómo se sintió?" },
      { id: "obs_despues", type: "textarea", label: "Observaciones" },
      { id: "firma", type: "signature", label: "Firma de la clienta" },
    ],
  },
  {
    key: "lifting",
    name: "Ficha lifting de pestañas y perfilado/laminado",
    description: "Antecedentes oculares, evaluación, prueba de sensibilidad y servicio.",
    fields: [
      { id: "sec_antec", type: "section", label: "Antecedentes y salud" },
      { id: "alergia_cosmetico", type: "check", label: "¿Es alérgica a algún producto cosmético?", detail: true, detailLabel: "¿Cuál?", alert: true, alertLabel: "ALERGIA" },
      { id: "reaccion_ojos", type: "check", label: "¿Ha tenido reacciones alérgicas en los ojos o zona ocular?", detail: true, detailLabel: "¿Cuál?", alert: true, alertLabel: "REACCIÓN OCULAR" },
      { id: "ojos_sensibles", type: "check", label: "¿Tiene ojos sensibles o irritados actualmente?" },
      { id: "conjuntivitis", type: "check", label: "¿Presenta conjuntivitis, infección o inflamación ocular actualmente?", alert: true, alertLabel: "INFECCIÓN OCULAR" },
      { id: "lentes", type: "check", label: "¿Usa lentes de contacto?" },
      { id: "afeccion_ocular", type: "check", label: "¿Tiene alguna afección o tratamiento médico en la zona ocular?", detail: true, detailLabel: "Detalle" },
      { id: "medicamento_ocular", type: "check", label: "¿Está utilizando algún medicamento o producto en la zona ocular?", detail: true, detailLabel: "¿Cuál?" },
      { id: "quimico_reciente", type: "check", label: "¿Se realizó lifting, permanente o algún tratamiento químico de pestañas recientemente?", detail: true, detailLabel: "Fecha aproximada" },
      { id: "extensiones", type: "check", label: "¿Utiliza extensiones de pestañas actualmente?" },
      { id: "sec_historial", type: "section", label: "Historial del servicio" },
      { id: "ult_lifting", type: "date", label: "Último lifting de pestañas" },
      { id: "ult_laminado", type: "date", label: "Último laminado de cejas" },
      { id: "ult_perfilado", type: "date", label: "Último perfilado" },
      { id: "ult_tinte", type: "date", label: "Último tinte de pestañas" },
      { id: "obs_anteriores", type: "textarea", label: "Observaciones sobre trabajos anteriores" },
      { id: "sec_eval", type: "section", label: "Evaluación previa" },
      {
        id: "estado_pestanas", type: "multiselect", label: "Estado de las pestañas",
        options: ["Buen estado", "Finas", "Débiles", "Secas", "Cortas", "Quebradizas"],
      },
      {
        id: "sensibilidad", type: "select-one", label: "Sensibilidad observada",
        options: ["Normal", "Sensible", "Muy sensible"],
      },
      { id: "obs_eval", type: "textarea", label: "Observaciones" },
      { id: "sec_prueba", type: "section", label: "Prueba de sensibilidad" },
      { id: "prueba_hecha", type: "check", label: "Realizada" },
      { id: "prueba_fecha", type: "date", label: "Fecha", show_if: { field: "prueba_hecha", equals: "sí" } },
      {
        id: "prueba_resultado", type: "select-one", label: "Resultado",
        options: ["Sin reacción", "Reacción"],
        show_if: { field: "prueba_hecha", equals: "sí" },
      },
      { id: "prueba_obs", type: "textarea", label: "Observaciones" },
      { id: "sec_servicio", type: "section", label: "Servicio realizado" },
      { id: "serv_fecha", type: "date", label: "Fecha" },
      { id: "serv_lifting", type: "check", label: "Lifting" },
      { id: "serv_tinte", type: "check", label: "Tinte" },
      { id: "serv_perfilado", type: "text", label: "Perfilado" },
      { id: "serv_laminado", type: "text", label: "Laminado" },
      { id: "producto_marca", type: "text", label: "Producto / marca utilizada" },
      { id: "tiempo_exposicion", type: "text", label: "Tiempo de exposición" },
      { id: "molde", type: "text", label: "Molde utilizado" },
      { id: "resultado", type: "textarea", label: "Resultado / observaciones" },
      { id: "sec_cuidados", type: "section", label: "Cuidados posteriores" },
      { id: "cuidados_ok", type: "check", label: "Se explicaron los cuidados posteriores al servicio" },
      { id: "cuidados_obs", type: "textarea", label: "Observaciones / recomendaciones" },
      { id: "firma", type: "signature", label: "Firma de la clienta" },
    ],
  },
  {
    key: "nota",
    name: "Nota de sesión",
    description: "Registro libre por sesión (fecha, detalle y firma).",
    fields: [
      { id: "fecha", type: "date", label: "Fecha" },
      { id: "detalle", type: "textarea", label: "Detalle de la sesión", required: true },
      { id: "fotos", type: "photo", label: "Fotos", maxPhotos: 3 },
      { id: "firma", type: "signature", label: "Firma de la clienta" },
    ],
  },
];

/** Valida un schema de fields (constructor): tipos conocidos y show_if válido. */
export function validateFields(raw: unknown): { ok: boolean; error?: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "fields debe ser una lista" };
  if (raw.length === 0) return { ok: false, error: "La ficha necesita al menos un campo" };
  if (raw.length > 80) return { ok: false, error: "Máximo 80 campos por ficha" };
  const validTypes = new Set([
    "section", "text", "textarea", "date", "scale",
    "check", "multiselect", "select-one", "photo", "signature", "consent",
  ]);
  const ids = new Set<string>();
  for (const f of raw as Record<string, unknown>[]) {
    if (!f || typeof f !== "object") return { ok: false, error: "Campo inválido" };
    const id = String((f as Record<string, unknown>).id || "").trim().slice(0, 60);
    const type = String((f as Record<string, unknown>).type || "");
    if (!id || !validTypes.has(type as never)) return { ok: false, error: `Campo inválido: ${id || "?"}` };
    if (ids.has(id)) return { ok: false, error: `Campo duplicado: ${id}` };
    ids.add(id);
  }
  for (const f of raw as Record<string, unknown>[]) {
    const showIf = (f as Record<string, unknown>).show_if as { field?: unknown } | null | undefined;
    if (showIf && typeof showIf === "object") {
      const ref = String(showIf.field || "");
      if (!ids.has(ref)) return { ok: false, error: `Condición inválida en ${(f as Record<string, unknown>).id}` };
    }
  }
  return { ok: true };
}

/** Respuesta afirmativa/riesgosa de un check (para alerts). */
export function isAffirmative(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "sí" || v === "si" || v === "true" || v === "1";
}

/** Normaliza respuestas crudas al schema (recorta strings, limita fotos). */
export function sanitizeAnswers(fields: FormField[], raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const f of fields) {
    if (f.type === "section") continue;
    const v = src[f.id];
    if (v == null) continue;
    if (f.type === "multiselect") {
      const arr = Array.isArray(v) ? v : [v];
      out[f.id] = arr.map((x) => String(x).slice(0, 120)).slice(0, 30);
      const otherKey = `${f.id}__other`;
      if (typeof src[otherKey] === "string" && src[otherKey].trim()) {
        out[otherKey] = String(src[otherKey]).slice(0, 200);
      }
      continue;
    }
    if (f.type === "photo") {
      const arr = Array.isArray(v) ? v : [v];
      const max = Math.min(Math.max(f.maxPhotos || 3, 1), 6);
      out[f.id] = arr.map((x) => String(x).slice(0, 500)).slice(0, max);
      continue;
    }
    if (f.type === "check") {
      out[f.id] = String(v).slice(0, 10);
      const dKey = `${f.id}__detail`;
      if (f.detail && typeof src[dKey] === "string" && src[dKey].trim()) {
        out[dKey] = String(src[dKey]).slice(0, 500);
      }
      continue;
    }
    if (f.type === "signature") {
      const s = String(v);
      // dataURL PNG del canvas (tope ~500KB de texto).
      if (s.startsWith("data:image/png;base64,") && s.length < 700000) out[f.id] = s;
      continue;
    }
    out[f.id] = String(v).slice(0, f.type === "textarea" ? 2000 : 500);
  }
  return out;
}

/** Campos con alerta disparada por las respuestas (para 🚨 en turno/ficha). */
export function triggeredAlerts(fields: FormField[], answers: Record<string, unknown>): { fieldId: string; label: string }[] {
  const out: { fieldId: string; label: string }[] = [];
  for (const f of fields) {
    if (!f.alert) continue;
    if (f.type === "check" && isAffirmative(answers[f.id])) {
      out.push({ fieldId: f.id, label: f.alertLabel || f.label });
    }
  }
  return out;
}

export { OTRO };
