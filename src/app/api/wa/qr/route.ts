import { Redis } from "@upstash/redis";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { NextResponse } from "next/server";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * GET /api/wa/qr — devuelve el QR de vinculación del bot de WhatsApp del comercio
 * actual (el que genera el relay en el celular y el cerebro guarda en Redis con TTL).
 * Devuelve `{ qr: string | null }`; el panel /vendor/wa-bot lo renderiza como imagen.
 */
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis no inicializado" }, { status: 500 });
  }

  const value = await redis.get<string>(`wa:qr:${vendor.id}`);
  return NextResponse.json({ qr: value ?? null });
}