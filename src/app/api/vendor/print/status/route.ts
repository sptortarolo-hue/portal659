import { query, queryOne } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { generatePrintToken } from "@/lib/print-token";
import { NextResponse } from "next/server";

type VendorPrintRow = {
  id: string;
  print_mode: string;
  print_token: string | null;
  printer_ip: string | null;
  printer_port: number | null;
  paper_size: string | null;
  auto_print: boolean;
  last_print_at: string | null;
  last_print_ok: boolean | null;
  last_print_error: string | null;
};

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { vendor: v } = await getVendorByRequest(request);

  if (!v) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const vendor = await queryOne<VendorPrintRow>(
    `SELECT id, print_mode, print_token, printer_ip, printer_port, paper_size, auto_print,
            last_print_at, last_print_ok, last_print_error
     FROM vendors WHERE id = $1 LIMIT 1`,
    [v.id]
  );

  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  if (vendor.print_mode === "app" && !vendor.print_token) {
    const token = generatePrintToken();
    await query(`UPDATE vendors SET print_token = $1 WHERE id = $2`, [token, vendor.id]);
    vendor.print_token = token;
  }

  const bridgeUrl = (process.env.PRINT_BRIDGE_URL || "").replace(/\/$/, "");
  const secret = process.env.PRINT_BRIDGE_SECRET || "";
  let agent: { online: boolean; lastSeen?: string | null } = { online: false };

  if (bridgeUrl && vendor.print_token) {
    try {
      const res = await fetch(
        `${bridgeUrl}/status?token=${encodeURIComponent(vendor.print_token)}`,
        { headers: { "x-bridge-secret": secret }, signal: AbortSignal.timeout(5000) }
      );
      agent = (await res.json()) as { online: boolean; lastSeen?: string | null };
    } catch {
      agent = { online: false };
    }
  }

  return NextResponse.json({
    vendor: {
      print_mode: vendor.print_mode,
      print_token: vendor.print_token,
      printer_ip: vendor.printer_ip,
      printer_port: vendor.printer_port,
      paper_size: vendor.paper_size,
      auto_print: vendor.auto_print,
      last_print_at: vendor.last_print_at,
      last_print_ok: vendor.last_print_ok,
      last_print_error: vendor.last_print_error,
    },
    agent,
    bridgeConfigured: !!bridgeUrl,
  });
}