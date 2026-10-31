import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { setPortalSetting, type PortalSettingKey } from "@/lib/portal-settings";

const KEYS: PortalSettingKey[] = ["wa_float", "tv_qr_online"];

export async function PATCH(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const key = body?.key;
    const value = body?.value;
    if (!KEYS.includes(key)) {
      return NextResponse.json({ error: `key inválida (${KEYS.join("|")})` }, { status: 400 });
    }
    if (typeof value !== "boolean") {
      return NextResponse.json({ error: "value debe ser boolean" }, { status: 400 });
    }
    await setPortalSetting(key, value);
    return NextResponse.json({ ok: true, key, value });
  } catch (e) {
    console.error("[api/admin/settings] PATCH error:", e);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}
