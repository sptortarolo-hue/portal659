import { gateRequest, gateError } from "@/lib/subscription-gate";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json({ error: "Las mesas forman parte del plan Gestión integral" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const payload: Record<string, unknown> = {};
  if (body.name !== undefined) payload.name = String(body.name).trim();
  if (body.capacity !== undefined) payload.capacity = Number(body.capacity) > 0 ? Number(body.capacity) : 4;
  if (body.status !== undefined && ["libre", "ocupada", "reservada"].includes(body.status)) {
    payload.status = body.status;
  }
  if (body.position !== undefined) payload.position = Number(body.position);

  const { data, error } = await gate.supabase
    .from("tables")
    .update(payload)
    .eq("id", id)
    .eq("vendor_id", gate.vendor.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ table: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json({ error: "Las mesas forman parte del plan Gestión integral" }, { status: 403 });
  }

  const { id } = await params;

  // Una mesa ocupada no se puede borrar
  const { data: table } = await gate.supabase
    .from("tables")
    .select("status")
    .eq("id", id)
    .eq("vendor_id", gate.vendor.id)
    .single();

  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  if (table.status === "ocupada") {
    return NextResponse.json({ error: "La mesa está ocupada. Cerrá la mesa antes de eliminarla." }, { status: 400 });
  }

  const { error } = await gate.supabase.from("tables").delete().eq("id", id).eq("vendor_id", gate.vendor.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}