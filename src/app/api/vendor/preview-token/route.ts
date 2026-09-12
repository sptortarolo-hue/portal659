import { query, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { generatePreviewToken } from "@/lib/preview";
import { NextResponse } from "next/server";

/**
 * Link de preview compartible del comercio.
 * POST { action: "generate", expiresInDays?: number } → crea/rota el token.
 * POST { action: "revoke" } → revoca el link.
 * Solo dueño o admin (no repartidores ni sesiones de prueba con el link).
 */
export async function POST(request: Request) {
  const { vendor: resolved, staffRole, previewSession } = await getVendorByRequest(request);
  if (!resolved || staffRole === "delivery" || previewSession) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, expiresInDays } = body as {
    action?: string;
    expiresInDays?: number;
  };

  if (action === "revoke") {
    await query(
      `UPDATE vendors SET preview_token = NULL, preview_token_expires_at = NULL WHERE id = $1`,
      [resolved.id]
    );
    return NextResponse.json({ ok: true, preview_token: null });
  }

  if (action === "generate") {
    const days = Number(expiresInDays) > 0 ? Math.min(365, Math.floor(Number(expiresInDays))) : 30;
    const token = generatePreviewToken();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await query(
      `UPDATE vendors SET preview_token = $1, preview_token_expires_at = $2 WHERE id = $3`,
      [token, expiresAt, resolved.id]
    );
    const vendor = await queryOne<{ slug: string | null }>(
      `SELECT slug FROM vendors WHERE id = $1 LIMIT 1`,
      [resolved.id]
    );
    return NextResponse.json({
      ok: true,
      preview_token: token,
      preview_token_expires_at: expiresAt,
      slug: vendor?.slug ?? null,
    });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
