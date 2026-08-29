import { getUserId } from "@/lib/auth-utils";
import {
  DEVICE_COOKIE,
  deviceCookieOptions,
  getDeviceId,
  newDeviceId,
} from "@/lib/device";
import { mergeDeviceFavorites } from "@/lib/device-merge";
import { queryMany, queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

const FAV_COLUMNS = `f.vendor_id, json_build_object('id', v.id, 'store_name', v.store_name, 'slug', v.slug, 'logo_url', v.logo_url, 'vertical', v.vertical, 'neighborhood', v.neighborhood) AS vendors`;

async function favoritesByUser(userId: string) {
  return queryMany<Record<string, unknown>>(
    `SELECT ${FAV_COLUMNS}
     FROM favorites f
     JOIN vendors v ON v.id = f.vendor_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  );
}

async function favoritesByDevice(deviceId: string) {
  return queryMany<Record<string, unknown>>(
    `SELECT ${FAV_COLUMNS}
     FROM favorites f
     JOIN vendors v ON v.id = f.vendor_id
     WHERE f.device_id = $1
     ORDER BY f.created_at DESC`,
    [deviceId]
  );
}

export async function GET(request: Request) {
  const userId = await getUserId(request);
  const deviceId = getDeviceId(request);

  if (!userId) {
    if (!deviceId) return NextResponse.json({ favorites: [] });
    const favorites = await favoritesByDevice(deviceId);
    return NextResponse.json({ favorites: favorites || [] });
  }

  if (deviceId) {
    await mergeDeviceFavorites(userId, deviceId);
  }

  const favorites = await favoritesByUser(userId);
  return NextResponse.json({ favorites: favorites || [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { vendorId } = body;
  if (!vendorId) return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });

  const userId = await getUserId(request);
  const deviceId = getDeviceId(request);

  if (userId) {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM favorites WHERE user_id = $1 AND vendor_id = $2 LIMIT 1`,
      [userId, vendorId]
    );
    if (existing) {
      await query(`DELETE FROM favorites WHERE id = $1`, [existing.id]);
      return NextResponse.json({ ok: true, favorited: false });
    }
    await query(`INSERT INTO favorites (user_id, vendor_id) VALUES ($1, $2)`, [userId, vendorId]);
    return NextResponse.json({ ok: true, favorited: true });
  }

  const did = deviceId || newDeviceId();
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM favorites WHERE device_id = $1 AND vendor_id = $2 LIMIT 1`,
    [did, vendorId]
  );
  if (existing) {
    await query(`DELETE FROM favorites WHERE id = $1`, [existing.id]);
  } else {
    await query(`INSERT INTO favorites (device_id, vendor_id) VALUES ($1, $2)`, [did, vendorId]);
  }

  const response = NextResponse.json({ ok: true, favorited: !existing });
  if (!deviceId) {
    response.cookies.set(DEVICE_COOKIE, did, deviceCookieOptions());
  }
  return response;
}