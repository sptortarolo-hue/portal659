import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne } from "@/lib/db";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { action } = body;

  if (action !== "moderate" && action !== "restore") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const review = await queryOne<{ id: string }>(
    `SELECT id FROM reviews WHERE id = $1 LIMIT 1`,
    [id]
  );

  if (!review) return NextResponse.json({ error: "Reseña no encontrada" }, { status: 404 });

  if (action === "moderate") {
    await queryOne(
      `UPDATE reviews SET moderated = TRUE, moderated_at = $1, moderated_by = $2 WHERE id = $3`,
      [new Date().toISOString(), "admin", id]
    );
  } else {
    await queryOne(
      `UPDATE reviews SET moderated = FALSE, moderated_at = NULL, moderated_by = NULL WHERE id = $1`,
      [id]
    );
  }

  return NextResponse.json({ ok: true });
}