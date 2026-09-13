import { logApiError } from "@/lib/api-error";
import { NextResponse } from "next/server";

/**
 * POST /api/img-error { src }
 * Telemetría mínima de fotos que agotan los reintentos del cliente
 * (ProductImage). No guarda nada: solo cae en `docker logs` vía
 * [API:img-client], para detectar fotos problemáticas reales.
 * Rate-limit en memoria (20/min por IP): es un endpoint público.
 */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 20;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 1000) hits.delete(hits.keys().next().value as string);
  return arr.length > MAX_HITS;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const src =
    typeof body?.src === "string" ? body.src.slice(0, 500) : "";
  if (!src) return NextResponse.json({ ok: true });
  logApiError("img-client", `${ip} :: ${src}`);
  return NextResponse.json({ ok: true });
}
