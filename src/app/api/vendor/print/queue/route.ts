import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";

async function resolveToken(request: Request): Promise<string | null> {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return null;
  const v = await queryOne<{ print_token: string | null }>(
    `SELECT print_token FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  return v?.print_token ?? null;
}

async function bridgeFetch(path: string, method: string) {
  const base = (process.env.PRINT_BRIDGE_URL || "").replace(/\/$/, "");
  const secret = process.env.PRINT_BRIDGE_SECRET || "";
  if (!base) return null;
  try {
    const res = await fetch(path, {
      method,
      headers: { "x-bridge-secret": secret },
      signal: AbortSignal.timeout(5000),
    });
    return (await res.json()) as any;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const token = await resolveToken(request);
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const url = new URL(request.url);
  const jobId = url.searchParams.get("id") ?? "";
  const base = (process.env.PRINT_BRIDGE_URL || "").replace(/\/$/, "");
  const path = jobId
    ? `${base}/queue/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`
    : `${base}/queue?token=${encodeURIComponent(token)}`;
  const data = await bridgeFetch(path, "GET");
  if (!data) return NextResponse.json({ error: "Puente no disponible" }, { status: 502 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const token = await resolveToken(request);
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const url = new URL(request.url);
  const jobId = url.searchParams.get("id") ?? "";
  const base = (process.env.PRINT_BRIDGE_URL || "").replace(/\/$/, "");
  const path = jobId
    ? `${base}/queue/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`
    : `${base}/queue?token=${encodeURIComponent(token)}`;
  const data = await bridgeFetch(path, "DELETE");
  if (!data) return NextResponse.json({ error: "Puente no disponible" }, { status: 502 });
  return NextResponse.json(data);
}