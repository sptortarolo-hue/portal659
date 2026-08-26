import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { getServiceClient } from "@/lib/supabase";
import { NextResponse } from "next/server";

async function isAdmin(request: Request): Promise<boolean> {
  const supabase = getAuthSupabase(request);
  if (!supabase) return false;
  const userId = await getUserId(supabase);
  if (!userId) return false;
  const { data } = await supabase
    .from("vendors")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.is_admin === true;
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const serviceClient = getServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const perPage = parseInt(url.searchParams.get("per_page") || "50");
  const search = url.searchParams.get("search") || "";

  const { data: authUsers, error } = await serviceClient.auth.admin.listUsers({
    page,
    perPage,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let users = authUsers.users.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.user_metadata?.first_name || "",
    lastName: u.user_metadata?.last_name || "",
    full_name: u.user_metadata?.full_name || u.email,
    whatsapp: u.user_metadata?.whatsapp || "",
    role: u.user_metadata?.role || "vendor",
    vertical: u.user_metadata?.vertical || "",
    email_confirmed: !!u.email_confirmed_at,
    last_sign_in: u.last_sign_in_at,
    created_at: u.created_at,
  }));

  if (search) {
    const q = search.toLowerCase();
    users = users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.full_name?.toLowerCase().includes(q) ||
        u.firstName?.toLowerCase().includes(q) ||
        u.lastName?.toLowerCase().includes(q) ||
        u.whatsapp?.includes(q)
    );
  }

  return NextResponse.json({
    users,
    total: authUsers.total || users.length,
    page,
    perPage,
  });
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const serviceClient = getServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { email, password, firstName, lastName, whatsapp, role, vertical } = await request.json();

  if (!email || !password || !firstName || !lastName) {
    return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
  }

  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      whatsapp: whatsapp || "",
      role: role || "vendor",
      vertical: vertical || "gastronomia",
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user: { id: data.user.id, email: data.user.email } });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const serviceClient = getServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { userId } = await request.json();

  if (!userId) {
    return NextResponse.json({ error: "userId requerido" }, { status: 400 });
  }

  const { error } = await serviceClient.auth.admin.deleteUser(userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const serviceClient = getServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Error de conexión" }, { status: 503 });
  }

  const { userId, firstName, lastName, whatsapp, role, vertical } = await request.json();

  if (!userId) {
    return NextResponse.json({ error: "userId requerido" }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  if (firstName !== undefined) updates.first_name = firstName;
  if (lastName !== undefined) updates.last_name = lastName;
  if (whatsapp !== undefined) updates.whatsapp = whatsapp;
  if (role !== undefined) updates.role = role;
  if (vertical !== undefined) updates.vertical = vertical;
  updates.full_name = `${firstName || ""} ${lastName || ""}`.trim();

  const { error } = await serviceClient.auth.admin.updateUserById(userId, {
    user_metadata: updates,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
