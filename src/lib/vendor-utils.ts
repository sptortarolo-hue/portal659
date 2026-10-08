import { getAuthUser } from "./auth";
import { query, queryMany, queryOne } from "./db";
import { getPreviewSessionVendorId } from "./preview-session";

const COMERCIO_CATEGORIES = [
  "verdulería", "carnicería", "pollajería", "kiosko", "almacén",
  "fiambrería", "panadería", "licorería", "ferretería", "librería",
  "farmacia", "droguería", "floristería", "pet shop", "peluquería canina",
  "veterinaria", "alimentos", "accesorios", "guardería", "papelería",
  "óptica", "otros",
];

const ADMIN_AS_COOKIE = "portal659-admin-as";

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=").trim();
  }
  return null;
}

export { ADMIN_AS_COOKIE };

export type StaffRole = "owner" | "delivery" | "staff" | null;

/** Nivel del usuario del local (solo cuando staffRole === "staff"). */
export type StaffLevel = "admin" | "empleado" | null;

/**
 * Obtiene el vendor (comercio) del usuario autenticado.
 * - Owner: vendors.user_id = user.id.
 * - Staff: vendor_staff.profile_id = user.id (repartidor / delivery, o
 *   usuario del local / staff con su staff_level).
 * - Admin con `portal659-admin-as`: resuelve por id (modo llave en mano).
 * - Sesión de prueba (`portal659-preview-dashboard`): acceso temporal al
 *   panel de UN comercio, sin cuenta. `previewSession: true`, `userId: null`.
 * Devuelve también `staffRole` ("owner" para sesión de prueba, null si es
 * dueño, "delivery" si es repartidor, "staff" si es usuario del local) y
 * `staffLevel` ("admin" = Encargado / "empleado" = Empleado, solo staff).
 */
export async function getVendorByRequest(request: Request): Promise<{
  userId: string | null;
  vendor: { id: string; user_id: string | null } | null;
  staffRole: StaffRole;
  staffLevel: StaffLevel;
  previewSession: boolean;
}> {
  // Sesión de prueba: no requiere usuario registrado.
  const previewVendorId = await getPreviewSessionVendorId(request);
  if (previewVendorId) {
    const vendor = await queryOne<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [previewVendorId]
    );
    return { userId: null, vendor: vendor ?? null, staffRole: "owner", staffLevel: null, previewSession: true };
  }

  const user = await getAuthUser(request);
  if (!user) return { userId: null, vendor: null, staffRole: null, staffLevel: null, previewSession: false };

  const asVendorId = getCookie(request, ADMIN_AS_COOKIE);
  if (asVendorId && user.is_admin) {
    const vendor = await queryOne<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [asVendorId]
    );
    return { userId: user.id, vendor: vendor ?? null, staffRole: null, staffLevel: null, previewSession: false };
  }

  const vendor = await queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );
  if (vendor) return { userId: user.id, vendor, staffRole: null, staffLevel: null, previewSession: false };

  // No es dueño: ¿staff vinculado y activo? (repartidor o usuario del
  // local). Tolerante a migración sin aplicar (sin columnas nuevas cae al
  // SELECT legacy de role).
  let staff: { vendor_id: string; role: string; staff_level?: string | null } | null = null;
  try {
    staff =
      (await queryOne<{ vendor_id: string; role: string; staff_level: string | null }>(
        `SELECT vendor_id, role, staff_level FROM vendor_staff WHERE profile_id = $1 AND status = 'active' LIMIT 1`,
        [user.id]
      )) ?? null;
  } catch {
    staff =
      (await queryOne<{ vendor_id: string; role: string }>(
        `SELECT vendor_id, role FROM vendor_staff WHERE profile_id = $1 AND status = 'active' LIMIT 1`,
        [user.id]
      )) ?? null;
  }
  if (staff) {
    const sv = await queryOne<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [staff.vendor_id]
    );
    if (staff.role === "delivery") {
      return { userId: user.id, vendor: sv ?? null, staffRole: "delivery", staffLevel: null, previewSession: false };
    }
    if (staff.role === "staff") {
      const level: StaffLevel = staff.staff_level === "admin" ? "admin" : "empleado";
      return { userId: user.id, vendor: sv ?? null, staffRole: "staff", staffLevel: level, previewSession: false };
    }
    return {
      userId: user.id,
      vendor: sv ?? null,
      staffRole: "owner" as const,
      staffLevel: null,
      previewSession: false,
    };
  }

  return { userId: user.id, vendor: null, staffRole: null, staffLevel: null, previewSession: false };
}

/**
 * Normaliza la categoría de un producto: trim + usa el nombre canónico de
 * `vendor_categories` si coincide (case-insensitive), para no generar
 * variantes ("Pizzas" vs "pizzas") que después se ven como chips duplicados.
 * Si no hay coincidencia, devuelve el texto recortado (o "otras" si está vacío).
 */
export async function resolveCategoryName(
  vendorId: string,
  raw: unknown,
  fallback = "otras"
): Promise<string> {
  const text = typeof raw === "string" ? raw.trim() : "";
  const base = text || fallback;
  try {
    const cats = await queryMany<{ name: string }>(
      `SELECT name FROM vendor_categories WHERE vendor_id = $1`,
      [vendorId]
    );
    const match = (cats || []).find(
      (c) => c.name.trim().toLowerCase() === base.toLowerCase()
    );
     if (match) return match.name;
   } catch { /* sin categorías: usar el texto tal cual */ }
   return base;
}

/**
 * Si el vertical es comercio, seedea las categorías de producto por
 * defecto en vendor_categories al crear el vendor.
 */
export async function seedDefaultCategories(vendorId: string, vertical: string): Promise<void> {
  if (vertical !== "comercio") return;
  // El índice único real es (vendor_id, lower(name)): el ON CONFLICT por
  // columnas fallaba con 42P10 y tumbaba el alta. Con ON CONSTRAINT + catch,
  // el seed nunca rompe la creación del comercio.
  try {
    for (let i = 0; i < COMERCIO_CATEGORIES.length; i++) {
      await query(
        `INSERT INTO vendor_categories (vendor_id, name, position) VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT vendor_categories_vendor_name_key DO NOTHING`,
        [vendorId, COMERCIO_CATEGORIES[i], i]
      );
    }
  } catch (e) {
    const { logApiError } = await import("@/lib/api-error");
    logApiError("seedDefaultCategories", e);
  }
}