import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { ADMIN_AS_COOKIE, seedDefaultCategories, VENDOR_COOKIE } from "@/lib/vendor-utils";
import { checkArgPhone, toE164Plus } from "@/lib/phone";

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=").trim();
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const VALID_VERTICALS = ["gastronomia", "comercio", "servicio", "moda", "estetica", "otro"];

/**
 * Alta de un comercio nuevo para un usuario que ya es dueño (multi-tienda).
 * Cada tienda arranca Gratuito, con su propia configuración/plan y
 * micrositio propio. Al crear, activa la cookie del nuevo comercio.
 *
 * Con `as: true` (solo admin, modo llave en mano) el comercio se crea a
 * nombre del DUEÑO del comercio impersonado y la impersonación se mueve al
 * nuevo (cookie admin-as).
 */
export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  // Solo dueños crean comercios. El equipo (staff) administra el local asignado.

  const body = await request.json().catch(() => ({}));
  const storeName = String(body?.store_name || "").trim();
  if (!storeName) {
    return NextResponse.json({ error: "Ingresá el nombre del comercio" }, { status: 400 });
  }
  const normalized = String(body?.vertical || "") === "salud" ? "comercio" : String(body?.vertical || "");
  const vertical = VALID_VERTICALS.includes(normalized) ? normalized : "gastronomia";
  const neighborhood = String(body?.neighborhood || "sicardi").trim().slice(0, 40) || "sicardi";

  const phoneCheck = checkArgPhone(String(body?.whatsapp || ""));
  if (!phoneCheck.ok) {
    return NextResponse.json(
      { error: "Ingresá un WhatsApp válido (celular argentino)" },
      { status: 400 }
    );
  }
  const phoneE164 = toE164Plus(body?.whatsapp) || String(body?.whatsapp).trim();

  // ¿A nombre de quién se crea? (admin llave en mano → dueño impersonado).
  const asAdmin = body?.as === true;
  let targetUserId: string = user.id;
  if (asAdmin) {
    if (!user.is_admin) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const asId = getCookie(request, ADMIN_AS_COOKIE);
    if (!asId) {
      return NextResponse.json({ error: "No hay comercio impersonado activo" }, { status: 400 });
    }
    const impersonated = await queryOne<{ user_id: string | null }>(
      `SELECT user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [asId]
    );
    if (!impersonated?.user_id) {
      return NextResponse.json(
        { error: "El comercio impersonado no tiene dueño asignado" },
        { status: 400 }
      );
    }
    targetUserId = impersonated.user_id;
  }

  // Slug único: base + sufijo numérico si colisiona (mismo usuario puede
  // tener dos locales con nombres parecidos).
  const baseSlug = slugify(storeName) || "comercio";
  let slug = baseSlug;
  for (let i = 2; i <= 20; i++) {
    const taken = await queryOne(`SELECT 1 FROM vendors WHERE slug = $1 LIMIT 1`, [slug]);
    if (!taken) break;
    slug = `${baseSlug}-${i}`;
  }

  const vendor = await queryOne<{ id: string; slug: string; store_name: string; vertical: string }>(
    `INSERT INTO vendors (user_id, store_name, slug, vertical, neighborhood, whatsapp)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, slug, store_name, vertical`,
    [targetUserId, storeName, slug, vertical, neighborhood, phoneE164]
  );
  if (!vendor) {
    return NextResponse.json({ error: "No se pudo crear el comercio" }, { status: 500 });
  }

  await seedDefaultCategories(vendor.id, vertical);

  const res = NextResponse.json({ vendor, ok: true });
  if (asAdmin) {
    // Mueve la impersonación al comercio nuevo (2h, mismo TTL del dashboard).
    res.cookies.set(ADMIN_AS_COOKIE, vendor.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 2,
    });
  } else {
    res.cookies.set(VENDOR_COOKIE, vendor.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 60,
    });
  }
  return res;
}

