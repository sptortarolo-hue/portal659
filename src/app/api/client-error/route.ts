import { logApiError } from "@/lib/api-error";
import { NextResponse } from "next/server";

/**
 * POST /api/client-error { message, stack?, url?, userAgent? }
 * Auto-reporte de errores JS del cliente (window.onerror / unhandledrejection).
 * No guarda nada en DB: solo cae en `docker logs` vía [API:client-error],
 * para detectar crashes reales en testers sin que tengan que reportarlos.
 * Rate-limit en memoria (30/min por IP): es un endpoint público.
 */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 30;

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
  const message =
    typeof body?.message === "string" ? body.message.slice(0, 500) : "";
  const stack =
    typeof body?.stack === "string" ? body.stack.slice(0, 2000) : "";
  const url = typeof body?.url === "string" ? body.url.slice(0, 500) : "";
  if (!message) return NextResponse.json({ ok: true });
  logApiError("client-error", `${ip} :: ${message} :: ${url} :: ${stack}`);
  return NextResponse.json({ ok: true });
}
