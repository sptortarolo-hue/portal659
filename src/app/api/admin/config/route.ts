import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, query } from "@/lib/db";

export async function GET(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const [neighborhoods, categories] = await Promise.all([
      queryMany(`SELECT * FROM neighborhoods ORDER BY name`),
      queryMany(`SELECT * FROM categories ORDER BY name`),
    ]);

    return NextResponse.json({ neighborhoods, categories });
  } catch (e) {
    console.error("[api/admin/config] GET error:", e);
    return NextResponse.json({ error: "No se pudo cargar la configuración" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const { type, id, data: updateData } = body ?? {};

    if (!type || !id || !updateData) {
      return NextResponse.json({ error: "type, id y data son requeridos" }, { status: 400 });
    }

    if (type !== "neighborhood" && type !== "category") {
      return NextResponse.json({ error: "type inválido (neighborhood|category)" }, { status: 400 });
    }
    const table = type === "neighborhood" ? "neighborhoods" : "categories";
    const allowed =
      type === "neighborhood"
        ? ["name", "slug", "lat", "lng"]
        : ["name", "slug", "description", "vertical"];

    const clean: Record<string, unknown> = {};
    for (const k of Object.keys(updateData)) {
      if (allowed.includes(k)) clean[k] = updateData[k];
    }
    const cols = Object.keys(clean);
    if (cols.length === 0) return NextResponse.json({ ok: true });
    const runUpdate = (keys: string[]) => {
      const setClauses = keys.map((k, i) => `"${k}" = $${i + 2}`).join(", ");
      // `id` es el uuid de la fila (ver migrate-admin-config-ids.sql).
      return query(
        `UPDATE ${table} SET ${setClauses} WHERE id = $1`,
        [id, ...keys.map((k) => clean[k])]
      );
    };
    try {
      await runUpdate(cols);
    } catch (e: any) {
      // Tolerante a migración pendiente: si `vertical` aún no existe en
      // categories, se guarda el resto igual.
      if (e?.code === "42703" && clean.vertical !== undefined) {
        delete clean.vertical;
        const rest = Object.keys(clean);
        if (rest.length === 0) return NextResponse.json({ ok: true });
        await runUpdate(rest);
      } else {
        throw e;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/admin/config] PATCH error:", e);
    return NextResponse.json({ error: "No se pudo guardar el cambio" }, { status: 500 });
  }
}
