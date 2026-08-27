import { gateRequest, gateError } from "@/lib/subscription-gate";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las mesas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const { data, error } = await gate.supabase
    .from("tables")
    .select("*")
    .eq("vendor_id", gate.vendor.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tables: data || [] });
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las mesas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { name, capacity, position } = body;

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: "El nombre de la mesa es requerido" }, { status: 400 });
  }

  const { data, error } = await gate.supabase
    .from("tables")
    .insert({
      vendor_id: gate.vendor.id,
      name: String(name).trim(),
      capacity: capacity && Number(capacity) > 0 ? Number(capacity) : 4,
      position: position != null ? Number(position) : 0,
      status: "libre",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ table: data });
}