/**
 * Datos de la Pantalla TV (lado servidor).
 *
 * Modelo híbrido: la CONFIGURACIÓN vive en `tv_screens` (draft → published) y
 * el CONTENIDO (nombres, precios, fotos, agotados) se lee del catálogo en cada
 * request. Un cambio de precio en el panel se ve en la TV en segundos, sin
 * "publicar": publicar solo manda el layout.
 *
 * Todo tolerante a que la migración no esté aplicada: `hasTvScreens()` decide
 * antes de consultar, y las rutas públicas responden 404 amable.
 */

import { hasTable, query, queryMany, queryOne } from "./db";
import { discountOf } from "./promo";
import { isStoreOpen, TZ_AR } from "./open-hours";
import {
  DEFAULT_TV_CONFIG,
  mergeScreenCategories,
  normalizeTvConfig,
  resolveDaypart,
  type TvConfig,
} from "./tv-config";
import type { TvItem, TvSection, TvSnapshot } from "./tv-snapshot";
import { randomBytes } from "node:crypto";
import {
  isGastroVendor,
  isModaVendor,
  isComercioVendor,
  isEsteticaVendor,
} from "./plans";
import { getPortalSetting } from "./portal-settings";
import { getSiteUrl } from "./site-url";
import QRCode from "qrcode";

export type TvScreenRow = {
  id: string;
  vendor_id: string;
  kind: string;
  name: string;
  token: string;
  draft: unknown;
  published: unknown;
  version: number;
  published_at: string | null;
  last_seen_at: string | null;
  client_version: string | null;
  created_at: string;
};

const SELECT_SCREEN = `SELECT * FROM tv_screens`;

/** ¿La migración de pantallas está aplicada? */
export async function hasTvScreens(
  querier: { query: <T extends { [k: string]: any }>(sql: string, params?: unknown[]) => Promise<T[]> } = { query: queryMany }
): Promise<boolean> {
  try {
    return await hasTable(querier as any, "tv_screens");
  } catch {
    return false;
  }
}

export function randomTvToken(): string {
  // Sin vocales ambiguas ni 0/O/1/I: se lee en voz alta por teléfono.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(24);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Config efectiva de la pantalla: lo publicado (o el default si nunca publicó). */
export function screenConfig(row: TvScreenRow): TvConfig {
  const raw = row.published ?? row.draft ?? {};
  return normalizeTvConfig(raw);
}

export async function findScreenByToken(token: string): Promise<TvScreenRow | null> {
  if (!token || token.length > 64) return null;
  try {
    const row = await queryOne<TvScreenRow>(
      `${SELECT_SCREEN} WHERE token = $1 LIMIT 1`,
      [token]
    );
    return row ?? null;
  } catch {
    return null;
  }
}

export type TvScreenListRow = TvScreenRow & { draftsDiffers: boolean };

export async function listVendorScreens(vendorId: string): Promise<TvScreenRow[]> {
  try {
    const rows = await queryMany<TvScreenRow>(
      `${SELECT_SCREEN} WHERE vendor_id = $1 ORDER BY created_at ASC`,
      [vendorId]
    );
    return rows || [];
  } catch {
    return [];
  }
}

/** ¿La pantalla tiene cambios sin publicar? (lo ve el panel como aviso) */
export function hasUnpublishedDraft(row: TvScreenRow): boolean {
  if (!row.published) return false;
  try {
    return JSON.stringify(row.draft ?? {}) !== JSON.stringify(row.published ?? {});
  } catch {
    return false;
  }
}

export async function createScreen(
  vendorId: string,
  name: string,
  kind: "menu" | "orders" = "menu"
): Promise<TvScreenRow | null> {
  try {
    const row = await queryOne<TvScreenRow>(
      `INSERT INTO tv_screens (vendor_id, name, kind, token, draft)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [vendorId, (name || "Pantalla 1").slice(0, 40), kind, randomTvToken(), JSON.stringify(DEFAULT_TV_CONFIG)]
    );
    return row ?? null;
  } catch {
    return null;
  }
}

export async function updateScreenDraft(id: string, vendorId: string, draft: TvConfig): Promise<boolean> {
  try {
    await query(
      `UPDATE tv_screens SET draft = $1, updated_at = now() WHERE id = $2 AND vendor_id = $3`,
      [JSON.stringify(draft), id, vendorId]
    );
    return true;

  } catch {
    return false;
  }
}

export async function publishScreen(id: string, vendorId: string): Promise<TvScreenRow | null> {
  try {
    const row = await queryOne<TvScreenRow>(
      `UPDATE tv_screens
          SET published = COALESCE(draft, published),
              version = version + 1,
              published_at = now(),
              updated_at = now()
        WHERE id = $1 AND vendor_id = $2
        RETURNING *`,
      [id, vendorId]
    );
    return row ?? null;
  } catch {
    return null;
  }
}

export async function rotateScreenToken(id: string, vendorId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ token: string }>(
      `UPDATE tv_screens SET token = $1, updated_at = now() WHERE id = $2 AND vendor_id = $3 RETURNING token`,
      [randomTvToken(), id, vendorId]
    );
    return row?.token ?? null;
  } catch {
    return null;
  }
}

export async function deleteScreen(id: string, vendorId: string): Promise<boolean> {
  try {
    await query(`DELETE FROM tv_screens WHERE id = $1 AND vendor_id = $2`, [id, vendorId]);
    return true;
  } catch {
    return false;
  }
}

/** Heartbeat de la TV: marca "pantalla conectada" en el panel. */
export async function touchScreen(token: string, clientVersion?: string | null): Promise<boolean> {
  try {
    await query(
      `UPDATE tv_screens SET last_seen_at = now(), client_version = $1 WHERE token = $2`,
      [clientVersion ?? null, token]
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Contenido: catálogo en vivo
// ---------------------------------------------------------------------------

const norm = (s: string | null | undefined) => (s || "").toLowerCase().trim();

function money(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `$${n.toLocaleString("es-AR")}`;
}

function badgeFor(o: any): string | null {
  const off = discountOf(o as any);
  if (off > 0) return `-${off}%`;
  if (o.featured_today === true) return "Hoy";
  if (o.promo_only === true && o.promo_price != null) return "Promo";
  return null;
}

function soldOut(o: any): boolean {
  if (o.available !== true) return true;
  const control = o.stock_control !== false;
  if (!control) return false;
  return Number(o.stock ?? 0) <= 0;
}

function toItem(o: any, hidePrices: boolean): TvItem {
  const price = o.promo_price != null ? Number(o.promo_price) : Number(o.price ?? 0);
  const list = Number(o.price ?? 0);
  const isPromo = o.promo_price != null && list > price;
  return {
    id: String(o.id),
    name: String(o.name ?? ""),
    desc: o.description ? String(o.description).trim().slice(0, 160) || null : null,
    priceLabel: hidePrices ? null : money(price > 0 ? price : 0),
    oldPriceLabel: !hidePrices && isPromo ? money(list) : null,
    badge: badgeFor(o) ?? (o.unit === "kg" ? "por kg" : null),
    imageUrl: o.image_url ? String(o.image_url) : null,
    soldOut: soldOut(o),
  };
}

/** Categorías + ítems desde el catálogo (misma agrupación que /carta/[slug]). */
export async function loadCatalogSections(vendorId: string): Promise<{
  categoryNames: string[];
  sections: Array<{ id: string; name: string; items: any[] }>;
}> {
  const offers =
    (await queryMany<any>(
      `SELECT * FROM products WHERE vendor_id = $1 AND available = true
       ORDER BY featured_today DESC, name ASC`,
      [vendorId]
    ).catch(() => [])) || [];

  const cats =
    (await queryMany<any>(
      `SELECT * FROM vendor_categories WHERE vendor_id = $1 ORDER BY position ASC`,
      [vendorId]
    ).catch(() => [])) || [];

  const menuOffers = offers.filter((o: any) => o.promo_only !== true);
  const sections: Array<{ id: string; name: string; items: any[] }> = [];

  if (cats.length > 0) {
    const used = new Set<string>();
    for (const c of cats) {
      const items = menuOffers.filter((o: any) => norm(o.category) === norm(c.name));
      if (items.length) {
        sections.push({ id: `cat:${c.name}`, name: String(c.name), items });
        used.add(norm(c.name));
      }
    }
    const leftovers = menuOffers.filter((o: any) => !used.has(norm(o.category)));
    if (leftovers.length) sections.push({ id: "cat:otros", name: "Otros", items: leftovers });
  } else if (menuOffers.length) {
    sections.push({ id: "cat:todos", name: "Menú", items: menuOffers });
  }

  return { categoryNames: cats.map((c: any) => String(c.name)), sections };
}

/**
 * Cuántas ofertas entran en el pool del banner. El reproductor rota entre
 * ellas (el destacado "Hoy" primero, después las promos por % de descuento).
 */
const HERO_POOL_MAX = 12;

/**
 * Pool de ofertas del banner: destacados ("Hoy") primero y después las promos
 * ordenadas por % de descuento. En modo manual manda el orden elegido por el
 * comercio. Sin ofertas cae al primer producto (el banner nunca queda vacío).
 */
function pickHero(sections: TvSection[], config: TvConfig, all: any[]): TvItem[] {
  if (config.hero.mode === "manual" && config.hero.productIds.length > 0) {
    const byId = new Map(sections.flatMap((s) => s.items).map((i) => [i.id, i]));
    const picked = config.hero.productIds.map((id) => byId.get(id)).filter(Boolean) as TvItem[];
    return picked.slice(0, 4);
  }
  const flat = sections.flatMap((s) => s.items);
  const featured = flat.filter((i) => i.badge === "Hoy");
  const promos = all
    .filter((o: any) => discountOf(o as any) > 0)
    .sort((a: any, b: any) => discountOf(b as any) - discountOf(a as any))
    .map((o: any) => String(o.id));
  const out: TvItem[] = [];
  const seen = new Set<string>();
  for (const it of featured) {
    if (!seen.has(it.id)) {
      out.push(it);
      seen.add(it.id);
    }
  }
  for (const id of promos) {
    if (out.length >= HERO_POOL_MAX) break;
    if (seen.has(id)) continue;
    const hit = flat.find((i) => i.id === id);
    if (hit) {
      out.push(hit);
      seen.add(hit.id);
    }
  }
  if (out.length === 0 && flat.length > 0) out.push(flat[0]);
  return out.slice(0, HERO_POOL_MAX);
}

/** Hora local (AR) como {day, minutes} para resolver franjas. */
export function arNow(at: Date = new Date()): { day: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ_AR,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const wd = parts.find((p) => p.type === "weekday")?.value || "";
    const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10) % 24;
    const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
    return { day: dayMap[wd] ?? 0, minutes: h * 60 + m };
  } catch {
    return { day: 0, minutes: 0 };
  }
}

/**
 * Snapshot completo de la pantalla para un momento dado. Es lo que sirve
 * `GET /api/pantalla/[token]` y lo que consume el preview del panel.
 */
export async function buildTvSnapshot(
  row: TvScreenRow,
  vendor: any,
  at: Date = new Date()
): Promise<TvSnapshot> {
  const base = screenConfig(row);
  const catalog = await loadCatalogSections(vendor.id);
  const merged = mergeScreenCategories(base, catalog.categoryNames);

  const now = arNow(at);
  const resolved = resolveDaypart(merged, now);
  let config = resolved.config;

  // Categorías apagadas en el panel salen del snapshot.
  const hidden = new Set(config.categories.filter((c) => !c.visible).map((c) => norm(c.id)));
  const sections: TvSection[] = catalog.sections
    .filter((s) => !hidden.has(norm(s.id.replace(/^cat:/, ""))))
    .map((s) => {
      const items = s.items
        .filter((o: any) => (config.hideSoldOut ? !soldOut(o) : true))
        .map((o: any) => toItem(o, !config.showPrices));
      return { id: s.id, name: s.name, items };
    })
    .filter((s) => s.items.length > 0);

  const hero = pickHero(
    sections,
    config,
    catalog.sections.flatMap((s) => s.items)
  );

  const openState = isStoreOpen(vendor, TZ_AR);
  // Sin horarios cargados no se decide nada (null = ni abierto ni cerrado).
  const isOpen = openState;

  // QR de pedidos online: solo si el admin lo habilitó, el comercio lo pidió
  // en esta pantalla, y el local realmente vende online (tiene slug + acepta
  // pedidos + su vertical tiene carrito). Servicios (plomero etc.) no lo ven.
  let qr: TvSnapshot["qr"] = null;
  try {
    const sellsOnline =
      !!vendor.slug &&
      vendor.accepts_online_orders !== false &&
      (isGastroVendor(vendor) ||
        isModaVendor(vendor) ||
        isComercioVendor(vendor) ||
        isEsteticaVendor(vendor));
    if (config.qr.enabled && sellsOnline && (await getPortalSetting("tv_qr_online"))) {
      const url = `${getSiteUrl()}/tienda/${vendor.slug}?menu=1`;
      const dataUrl = await QRCode.toDataURL(url, {
        width: 900,
        margin: 2,
        color: { dark: "#0b1220", light: "#ffffff" },
      });
      qr = { url, dataUrl };
    }
  } catch {
    qr = null;
  }

  return {
    version: Number(row.version ?? 0),
    generatedAt: at.toISOString(),
    vendor: {
      name: String(vendor.store_name ?? ""),
      logoUrl: vendor.logo_url || vendor.image_url || null,
      isOpen,
      hoursText: vendor.hours ? String(vendor.hours) : null,
      category: vendor.category ? String(vendor.category) : null,
      storeUrl: vendor.slug ? `/tienda/${vendor.slug}` : "/",
    },
    config,
    theme: config.theme,
    daypartLabel: resolved.label,
    sections,
    hero,
    qr,
  };
}
