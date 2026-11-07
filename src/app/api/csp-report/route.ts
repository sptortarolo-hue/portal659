import { logApiError } from "@/lib/api-error";
import { NextResponse } from "next/server";

/**
 * POST /api/csp-report
 * Recibe los reportes de violación de la CSP que está en Report-Only
 * (ver next.config.ts). El navegador manda un POST con
 * `Content-Type: application/csp-report` y body `{ "csp-report": {...} }`.
 * No guarda nada: cae en `docker logs` vía [API:csp-report] para decidir
 * qué directivas se pueden enforzar sin romper nada.
 * Rate-limit en memoria (30/min por IP): es un endpoint público y los
 * reportes viajan con cada violación, no con cada vista.
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

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return new NextResponse(null, { status: 429 });
  }
  // application/csp-report (legacy report-uri) o application/reports+json
  // (report-to): parseamos el JSON crudo y tomamos el primer objeto.
  const body = (await request.json().catch(() => null)) as
    | { "csp-report"?: Record<string, unknown> }
    | Record<string, unknown>[]
    | null;
  const report = (Array.isArray(body)
    ? body[0]
    : (body?.["csp-report"] as Record<string, unknown> | undefined) || body) as
    | Record<string, unknown>
    | null;
  if (!report || typeof report !== "object") {
    return new NextResponse(null, { status: 204 });
  }
  const r = report as Record<string, unknown>;
  const doc = str(r["document-uri"], 200);
  const directive = str(r["violated-directive"] ?? r["effective-directive"], 100);
  const blocked = str(r["blocked-uri"], 300);
  const source = str(r["source-file"], 200);
  logApiError(
    "csp-report",
    `${ip} :: ${doc || "?"} :: ${directive || "?"} :: blocked=${blocked || "-"} :: src=${source || "-"}`
  );
  return new NextResponse(null, { status: 204 });
}
