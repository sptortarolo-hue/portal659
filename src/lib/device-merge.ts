import { query } from "@/lib/db";
import { formatPhone } from "@/lib/order-utils";

export async function mergeDeviceFavorites(userId: string, deviceId: string | null): Promise<void> {
  if (!deviceId) return;
  await query(
    `INSERT INTO favorites (user_id, vendor_id)
     SELECT $1, vendor_id FROM favorites WHERE device_id = $2 AND user_id IS NULL
     ON CONFLICT DO NOTHING`,
    [userId, deviceId]
  );
  await query(`DELETE FROM favorites WHERE device_id = $1 AND user_id IS NULL`, [deviceId]);
}

export function phoneVariants(raw: string): string[] {
  const digits = formatPhone(raw);
  const out = new Set<string>([digits]);
  if (digits.startsWith("549")) out.add(digits.slice(2));
  if (digits.startsWith("54")) out.add(digits.slice(2));
  if (digits.startsWith("9") && digits.length === 11) out.add(digits.slice(1));
  if (digits.startsWith("0")) out.add(digits.slice(1));
  out.add(digits.replace(/^549/, "9"));
  return Array.from(out);
}