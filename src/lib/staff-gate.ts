import type { StaffLevel, StaffRole } from "./vendor-utils";

/**
 * Niveles de usuario del local (por comercio, se cargan en
 * Configuración → Equipo):
 * - "admin" = Encargado: opera todo + edita la config del local.
 * - "empleado" = Empleado: opera (pedidos, mostrador, mesas, caja con
 *   cierre Z, impresión) sin tocar la config.
 * El dueño (staffRole null / "owner" / preview) puede todo.
 */
export const STAFF_LEVELS = {
  admin: "Encargado",
  empleado: "Empleado",
} as const;

export type ResolvedRole = {
  staffRole: StaffRole;
  staffLevel: StaffLevel;
  previewSession: boolean;
};

/** Dueño o equivalente (preview, admin-as, legacy owner): acceso total. */
export function isOwnerLike(r: ResolvedRole): boolean {
  if (r.previewSession) return true;
  return r.staffRole === null || r.staffRole === "owner";
}

/** ¿Puede editar la config del local? Dueño + Encargado (no Empleado). */
export function canManageConfig(r: ResolvedRole): boolean {
  if (isOwnerLike(r)) return true;
  return r.staffRole === "staff" && r.staffLevel === "admin";
}

/**
 * ¿Puede gestionar usuarios? SOLO el dueño (ni el Encargado: evita
 * escaladas — un encargado no puede crear otro encargado ni cambiar
 * claves ajenas).
 */
export function canManageUsers(r: ResolvedRole): boolean {
  if (r.previewSession) return false;
  return r.staffRole === null || r.staffRole === "owner";
}

/** ¿Puede operar (pedidos/mostrador/mesas/caja+Z/impresión)? Todos salvo repartidor. */
export function canOperate(r: ResolvedRole): boolean {
  return r.staffRole !== "delivery";
}

/** ¿Es empleado raso (sin config)? Para ocultar tabs en la UI. */
export function isEmployeeOnly(r: ResolvedRole): boolean {
  return r.staffRole === "staff" && r.staffLevel !== "admin";
}
