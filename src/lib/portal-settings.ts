import { queryOne, query } from "@/lib/db";

/**
 * Configuración global del portal (tabla portal_settings), editable desde
 * /admin/config. Tolerante a migración pendiente: sin tabla (o sin fila)
 * devuelve el default, que replica el comportamiento histórico.
 */
export type PortalSettingKey = "wa_float" | "tv_qr_online";

const DEFAULTS: Record<PortalSettingKey, boolean> = {
  wa_float: true,
  // QR de pedidos online en la Pantalla TV: ENCENDIDO por defecto. El QR
  // igual solo aparece donde el comercio lo activa en su pantalla y vende
  // online, así que el switch global no hace falta para "proteger" nada:
  // sirve como interruptor de emergencia para sacarlo de todas las pantallas
  // a la vez. Antes estaba en false y el QR no aparecía nunca (el comercio
  // activaba su switch y no veía nada: el bug reportado).
  tv_qr_online: true,
};

export async function getPortalSetting(key: PortalSettingKey): Promise<boolean> {
  try {
    const r = await queryOne<{ value: unknown }>(
      `SELECT value FROM portal_settings WHERE key = $1`,
      [key]
    );
    if (!r) return DEFAULTS[key];
    // pg devuelve el escalar jsonb ya parseado; por las dudas, si viene string.
    const v = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
    return typeof v === "boolean" ? v : DEFAULTS[key];
  } catch {
    return DEFAULTS[key];
  }
}

export async function setPortalSetting(key: PortalSettingKey, value: boolean): Promise<void> {
  try {
    await query(
      `INSERT INTO portal_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  } catch (e: any) {
    // 42P01 = tabla inexistente (migración pendiente): error claro, no genérico.
    if (e?.code === "42P01") {
      throw new Error(
        "Falta aplicar la migración supabase/self-host/migrate-portal-settings.sql en la base"
      );
    }
    throw e;
  }
}
