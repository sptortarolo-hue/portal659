import { logApiError } from "@/lib/api-error";
import { NextResponse } from "next/server";

/**
 * POST /api/client-error { message, stack?, digest?, pathname? }
 * Telemetría mínima de crashes de render capturados por el error boundary
 * global (src/app/error.tsx). No guarda nada: solo cae en `docker logs` vía
 * [API:client-error], para diagnosticar páginas de "Algo salió mal" reales.
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

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const body = await request.json().catch(() => null);
  const message = str(body?.message, 300);
  if (!message) return NextResponse.json({ ok: true });
  const stack = str(body?.stack, 2000);
  const digest = str(body?.digest, 100);
  const pathname = str(body?.pathname, 200);
  const ua = (request.headers.get("user-agent") || "").slice(0, 200);
  logApiError(
    "client-error",
    `${ip} :: ${pathname || "?"} :: ${digest || "-"} :: ${message} :: ${stack} :: ${ua}`
  );
  return NextResponse.json({ ok: true });
}
