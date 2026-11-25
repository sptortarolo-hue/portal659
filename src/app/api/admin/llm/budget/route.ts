import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { setLlmBudget, type LlmProvider } from "@/lib/llm-budgets";

/** PATCH /api/admin/llm/budget { provider, value: number|null } */
export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const provider = String(body?.provider || "") as LlmProvider;
    const value = body?.value === null || body?.value === "" || body?.value === undefined
      ? null
      : Number(body.value);
    await setLlmBudget(provider, value);
    return NextResponse.json({ ok: true, provider, value });
  } catch (e: any) {
    const msg = e?.code === "42P01"
      ? "Falta aplicar supabase/self-host/migrate-llm-usage.sql en el contenedor de DB"
      : (e?.message || "No se pudo guardar");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
