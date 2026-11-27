import Link from "next/link";
import { queryMany } from "@/lib/db";
import { VERTICALS } from "@/lib/config";
import { getZone } from "@/lib/zone";
import { vendorSellsOnline, resolveVendorPlan } from "@/lib/plans";
import { cashAppliesToItem, normalizeCashPct } from "@/lib/cash-discount";
import { sortTalles } from "@/lib/size-guides";
import { verticalSeoName } from "@/lib/json-ld";
import { fetchRankStats, rankVendors } from "@/lib/ranking";
import { CashPrice } from "@/components/store/cash-price";
import { VendorCard } from "@/components/store/vendor-card";
import { VerticalIcon } from "@/components/home/vertical-icon";
import { SearchX, ShoppingBag, Store } from "lucide-react";
import type { Plan } from "@/types/database";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { ProductImage } from "@/components/product-image";

export const dynamic = "force-dynamic";

/**
 * SEO del buscador: título/description según q/vertical, con keywords de la
 * zona (las búsquedas objetivo: "kioscos en Sicardi", "delivery Garibaldi").
 * Canonical propio por vertical (cada rubro puede rankear); los filtros de
 * moda/precio nunca van al canonical (evita variantes duplicadas).
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vertical?: string; online?: string }>;
}): Promise<Metadata> {
  const zone = await getZone();
  const sp = await searchParams;
  const q = (sp?.q || "").trim();
  const vert = sp?.vertical || null;

  let title: string;
  let description: string;
  if (q) {
    title = `${q} en ${zone.name} | Portal 659`;
    description = `Buscá "${q}" en los comercios de ${zone.name}: ${q} cerca tuyo, con pedido online o contacto directo por WhatsApp. 0% comisión.`;
  } else if (vert) {
    const name = verticalSeoName(vert);
    title = `${name} en ${zone.name} | Portal 659`;
    description = `${name} de ${zone.name} (La Plata): catálogo, precios, pedidos online y contacto directo por WhatsApp. El centro comercial de tu barrio, 0% comisión.`;
  } else {
    title = `Comercios y delivery en ${zone.name} | Portal 659`;
    description = `Buscá comercios, kioscos, almacenes, gastronomía y servicios de ${zone.name}. Pedí online o contactá directo por WhatsApp, 0% comisión.`;
  }

  return {
    title,
    description,
    alternates: { canonical: vert && !q ? `/buscar?vertical=${encodeURIComponent(vert)}` : "/buscar" },
  };
}

type VendorRow = {
  id: string;
  slug: string | null;
  store_name: string;
  image_url: string | null;
  vertical: string | null;
  description: string | null;
  plan_id: string | null;
  plan_status: string | null;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
  accepts_online_orders?: boolean | null;
  payment_methods?: string | null;
  cash_discount_pct?: number | null;
  // Columnas que usa el ranking (vienen por SELECT *; declararlas evita que
  // un recorte futuro de la query degrade el orden en silencio).
  featured?: boolean | null;
  created_at?: string | null;
  hours?: string | null;
  open_override?: boolean | null;
};

type ProductRow = {
  id: string;
  name: string;
  image_url: string | null;
  category: string | null;
  description: string | null;
  price: number | null;
  promo_price?: number | null;
  cash_discount_excluded?: boolean | null;
  vendor_id: string;
  vendors?: { vertical: string | null; store_name: string | null; slug: string | null } | null;
};

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vertical?: string; online?: string; talle?: string; color?: string; min?: string; max?: string }>;
}) {
  const zone = await getZone();
  const { q, vertical, online, talle, color, min, max } = await searchParams;
  const query = (q || "").trim();
  const onlineOnly = online === "1";
  const talleSel = talle || null;
  const colorSel = color || null;
  const minVal = min != null && min !== "" && !isNaN(Number(min)) ? Number(min) : null;
  const maxVal = max != null && max !== "" && !isNaN(Number(max)) ? Number(max) : null;

  const plans = await queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`);
  const isOnline = (v: VendorRow) => vendorSellsOnline(v, plans || []);
  // Cambiar de vertical (o a Todos) descarta los facets de moda (talle/color/
  // precio no aplican a otros verticales). Cambiar "online" los conserva.
  const hrefVertical = (slug: string | null) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (slug) sp.set("vertical", slug);
    if (onlineOnly) sp.set("online", "1");
    const s = sp.toString();
    return `/buscar${s ? `?${s}` : ""}`;
  };
  const hrefOnline = (on: boolean) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (vertical) sp.set("vertical", vertical);
    if (on) sp.set("online", "1");
    if (talleSel) sp.set("talle", talleSel);
    if (colorSel) sp.set("color", colorSel);
    if (minVal != null) sp.set("min", String(minVal));
    if (maxVal != null) sp.set("max", String(maxVal));
    const s = sp.toString();
    return `/buscar${s ? `?${s}` : ""}`;
  };
  const hrefWith = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (vertical) sp.set("vertical", vertical);
    if (onlineOnly) sp.set("online", "1");
    if (talleSel) sp.set("talle", talleSel);
    if (colorSel) sp.set("color", colorSel);
    if (minVal != null) sp.set("min", String(minVal));
    if (maxVal != null) sp.set("max", String(maxVal));
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) sp.delete(k);
      else sp.set(k, v);
    }
    const s = sp.toString();
    return `/buscar${s ? `?${s}` : ""}`;
  };
  const pillCls = (active: boolean) =>
    `pv2-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${active ? "pv2-active" : ""}`;

  const allVendors = (await queryMany<Record<string, unknown>>(
    `SELECT * FROM vendors
     WHERE neighborhood = ANY($1) AND visibility = 'public'
     ORDER BY store_name`,
    [zone.neighborhoods]
  )) as unknown as VendorRow[];

  if (!query) {
    let list = vertical ? allVendors.filter((v) => v.vertical === vertical) : allVendors;
    const onlineCount = list.filter((v) => isOnline(v)).length;
    if (onlineOnly) list = list.filter((v) => isOnline(v));
    // Mismo ranking de la home (src/lib/ranking.ts). Best-effort.
    list = rankVendors(list, await fetchRankStats(list.map((v) => v.id)));
    // SEO: el h1 acompaña al title por vertical ("Kioscos, almacenes y
    // comercios en Sicardi y Garibaldi") + párrafo indexable con la
    // descripción del rubro. Sin vertical, encabezado genérico.
    const activeVert = vertical ? VERTICALS.find((vt) => vt.slug === vertical) : null;
    const vertSeo = vertical ? verticalSeoName(vertical) : null;
    return (
      <main className="pv2 container mx-auto px-4 py-10 sm:py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="pv2-title text-3xl mb-2">
            {activeVert && vertSeo ? `${vertSeo} en ${zone.name}` : "Explorar comercios"}
          </h1>
          <p className="pv2-subtitle text-sm">
            {activeVert
              ? `${activeVert.description} en ${zone.name} (La Plata): mirá catálogos y precios, pedí online o contactá directo por WhatsApp, 0% comisión.`
              : `Comercios de ${zone.name} · elegí una categoría para filtrar`}
          </p>
        </div>

        {/* Vertical filters */}
        <div className="flex flex-wrap gap-2 mb-8">
          <Link href={hrefVertical(null)} className={pillCls(!vertical)}>Todos</Link>
          {VERTICALS.map((vert) => (
            <Link
              key={vert.slug}
              href={hrefVertical(vert.slug)}
              className={pillCls(vertical === vert.slug)}
            >
              <VerticalIcon slug={vert.slug} className="h-3.5 w-3.5" />
              {vert.name}
            </Link>
          ))}
          <Link href={hrefOnline(!onlineOnly)} className={pillCls(onlineOnly)}>
            <ShoppingBag className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Venden online{onlineCount > 0 ? ` (${onlineCount})` : ""}
          </Link>
        </div>

        {list.length === 0 ? (
          <div className="text-center py-16">
            <span className="pv2-section-icon mx-auto mb-4 h-14 w-14">
              <Store className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <p className="pv2-title text-lg mb-2">Todavía no hay comercios en esta categoría</p>
            <p className="pv2-subtitle text-sm mb-6">Probá con otra categoría o volvé a todos.</p>
            <Link href="/buscar" className="pv2-btn pv2-btn-primary px-5 py-2.5 text-sm">
              Ver todos
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {list.map((v) => (
              <VendorCard
                key={v.id}
                id={v.id}
                slug={v.slug}
                store_name={v.store_name}
                image_url={v.image_url}
                description={v.description}
                vertical={v.vertical}
                hours={v.hours}
                open_override={v.open_override ?? null}
                acceptsCart={isOnline(v)}
              />
            ))}
          </div>
        )}
      </main>
    );
  }

  const pattern = `%${query}%`;

  let [vendors, products]: [VendorRow[], ProductRow[]] = await Promise.all([
    queryMany<Record<string, unknown>>(
      `SELECT * FROM vendors
       WHERE neighborhood = ANY($2) AND visibility = 'public' AND (store_name ILIKE $1 OR description ILIKE $1 OR category ILIKE $1 OR services_list ILIKE $1)
       ORDER BY store_name`,
      [pattern, zone.neighborhoods]
    ),
    queryMany<Record<string, unknown>>(
       `SELECT p.*, json_build_object('id', v.id, 'slug', v.slug, 'store_name', v.store_name, 'vertical', v.vertical, 'image_url', v.image_url) AS vendors
        FROM products p
        JOIN vendors v ON v.id = p.vendor_id
        WHERE p.available = true AND p.neighborhood = ANY($2) AND v.visibility = 'public' AND COALESCE(to_jsonb(v)->>'carta_visibility', 'public') = 'public' AND (p.name ILIKE $1 OR p.description ILIKE $1 OR p.category ILIKE $1)
        ORDER BY p.name`,
      [pattern, zone.neighborhoods]
    ),
  ]) as unknown as [VendorRow[], ProductRow[]];

  if (vertical) {
    vendors = vendors.filter((v) => v.vertical === vertical);
    products = products.filter((p) => p.vendors?.vertical === vertical);
  }

  // Prioridad del plan Oficios: en el vertical servicios, los comercios con
  // plan vigente van primero (estable; el resto sigue alfabético).
  if (vertical === "servicio" && vendors.length > 1) {
    const isOficiosActive = (v: VendorRow): boolean => {
      try {
        const eff = resolveVendorPlan(v as never, plans || []);
        return eff.slug === "oficios" && (eff.trialActive || eff.active);
      } catch {
        return false;
      }
    };
    vendors = [...vendors].sort((a, b) => {
      const pa = isOficiosActive(a) ? 0 : 1;
      const pb = isOficiosActive(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (a.store_name || "").localeCompare(b.store_name || "", "es");
    });
  }

  // Facets moda (fase A): talles/colores/precios desde variantes con stock.
  // Tolerante a migración/tabla sin variantes: facets vacíos y sin filtros.
  const isModaSearch = vertical === "moda";
  const variantsByProduct: Record<string, { color: string; talle: string; price: number }[]> = {};
  let facetTalles: string[] = [];
  let facetColors: string[] = [];
  if (isModaSearch && products.length > 0) {
    try {
      const varRows = await queryMany<{ product_id: string; color: string; talle: string; price: number; promo: number | null; stock: number }>(
        `SELECT product_id, color, talle, price, promo, stock FROM product_variants WHERE product_id = ANY($1) AND stock > 0`,
        [products.map((p) => p.id)]
      );
      for (const v of varRows || []) {
        (variantsByProduct[v.product_id] ||= []).push({
          color: v.color,
          talle: v.talle,
          price: v.promo != null ? Number(v.promo) : Number(v.price),
        });
      }
      facetTalles = sortTalles(Array.from(new Set(varRows.map((v) => v.talle).filter(Boolean))));
      facetColors = Array.from(new Set(varRows.map((v) => v.color).filter(Boolean))).sort().slice(0, 12);
    } catch {
      // sin variantes o tabla sin migrar: sin facets
    }
  }

  // Filtros moda: talle/color (al menos una variante en stock que los matchee)
  // y rango de precio (alguna opción comprable dentro del rango).
  const productMatchesTalleColor = (p: ProductRow) => {
    if (!talleSel && !colorSel) return true;
    const vs = variantsByProduct[p.id] || [];
    if (vs.length === 0) return false;
    return vs.some((v) => (!talleSel || v.talle === talleSel) && (!colorSel || v.color === colorSel));
  };
  const productMatchesPrice = (p: ProductRow) => {
    if (minVal == null && maxVal == null) return true;
    const vs = variantsByProduct[p.id] || [];
    const opts = vs.length > 0
      ? vs.map((v) => v.price)
      : [Number(p.promo_price ?? p.price)];
    return opts.some((pr) => (minVal == null || pr >= minVal) && (maxVal == null || pr <= maxVal));
  };
  if (isModaSearch) {
    products = products.filter((p) => productMatchesTalleColor(p) && productMatchesPrice(p));
  }

  // Precio para la card de producto en búsqueda: con variantes muestra
  // "Desde $X" (mínimo efectivo); sin variantes mantiene el comportamiento actual.
  const priceInfo = (p: ProductRow): { label: string; hasPromo: boolean } => {
    const vs = variantsByProduct[p.id] || [];
    if (vs.length > 0) {
      const vmin = Math.min(...vs.map((v) => v.price));
      const vmax = Math.max(...vs.map((v) => v.price));
      return {
        label: vmin === vmax ? `$${vmin.toLocaleString("es-AR")}` : `Desde $${vmin.toLocaleString("es-AR")}`,
        hasPromo: false,
      };
    }
    const hasPromo = p.promo_price != null;
    return { label: `$${Number(hasPromo ? p.promo_price : p.price).toLocaleString("es-AR")}`, hasPromo };
  };

  const onlineById = new Map(vendors.map((v) => [v.id, isOnline(v)]));
  // % de descuento en efectivo por vendor (0 si no ofrece Efectivo).
  const cashByVendor = new Map(
    vendors.map((v) => [
      v.id,
      String(v.payment_methods || "")
        .split(",")
        .map((s: string) => s.trim())
        .includes("Efectivo") && Number(v.cash_discount_pct) > 0
        ? Number(v.cash_discount_pct)
        : 0,
    ])
  );
  if (onlineOnly) {
    vendors = vendors.filter((v) => onlineById.get(v.id));
    products = products.filter((p) => onlineById.get(p.vendor_id));
  }

  const totalResults = vendors.length + products.length;

  return (
    <main className="pv2 container mx-auto px-4 py-10 sm:py-12 max-w-4xl">
      <div className="mb-8">
        <h1 className="pv2-title text-3xl mb-2">
          Resultados para &ldquo;{query}&rdquo;
        </h1>
        <p className="pv2-subtitle text-sm">
          {totalResults === 0
            ? "No encontramos nada"
            : `${totalResults} resultado${totalResults !== 1 ? "s" : ""}`}
          {vertical && ` en ${VERTICALS.find((v) => v.slug === vertical)?.name || vertical}`}
        </p>
      </div>

      {/* Vertical filters */}
      <div className="flex flex-wrap gap-2 mb-8">
        <Link href={hrefVertical(null)} className={pillCls(!vertical)}>Todos</Link>
        {VERTICALS.map((vert) => (
          <Link
            key={vert.slug}
            href={hrefVertical(vert.slug)}
            className={pillCls(vertical === vert.slug)}
          >
            <VerticalIcon slug={vert.slug} className="h-3.5 w-3.5" />
            {vert.name}
          </Link>
        ))}
        <Link href={hrefOnline(!onlineOnly)} className={pillCls(onlineOnly)}>
          <ShoppingBag className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Venden online
        </Link>
      </div>

      {/* Filtros moda (fase A): talle / color / precio desde variantes con stock */}
      {isModaSearch && (facetTalles.length > 0 || facetColors.length > 0) && (
        <div className="space-y-2 mb-8">
          {facetTalles.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-medium text-muted-foreground w-12">Talle</span>
              <Link href={hrefWith({ talle: null })} className={pillCls(!talleSel)}>Todos</Link>
              {facetTalles.map((t) => (
                <Link key={t} href={hrefWith({ talle: talleSel === t ? null : t })} className={pillCls(talleSel === t)}>
                  {t}
                </Link>
              ))}
            </div>
          )}
          {facetColors.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-medium text-muted-foreground w-12">Color</span>
              <Link href={hrefWith({ color: null })} className={pillCls(!colorSel)}>Todos</Link>
              {facetColors.map((c) => (
                <Link key={c} href={hrefWith({ color: colorSel === c ? null : c })} className={pillCls(colorSel === c)}>
                  {c}
                </Link>
              ))}
            </div>
          )}
          <form action="/buscar" method="get" className="flex flex-wrap gap-2 items-center">
            <input type="hidden" name="q" value={query} />
            {vertical && <input type="hidden" name="vertical" value={vertical} />}
            {onlineOnly && <input type="hidden" name="online" value="1" />}
            {talleSel && <input type="hidden" name="talle" value={talleSel} />}
            {colorSel && <input type="hidden" name="color" value={colorSel} />}
            <span className="text-xs font-medium text-muted-foreground w-12">Precio</span>
            <input
              type="number"
              name="min"
              min={0}
              step="any"
              placeholder="mín"
              defaultValue={min ?? ""}
              className="h-9 w-24 rounded-lg border border-input bg-background px-2 text-xs"
              aria-label="Precio mínimo"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <input
              type="number"
              name="max"
              min={0}
              step="any"
              placeholder="máx"
              defaultValue={max ?? ""}
              className="h-9 w-24 rounded-lg border border-input bg-background px-2 text-xs"
              aria-label="Precio máximo"
            />
            <button type="submit" className="pv2-btn pv2-btn-primary h-9 px-4 text-xs">
              Filtrar
            </button>
            {(minVal != null || maxVal != null) && (
              <Link href={hrefWith({ min: null, max: null })} className="text-xs text-muted-foreground hover:text-primary">
                Limpiar
              </Link>
            )}
          </form>
        </div>
      )}

      {totalResults === 0 ? (
        <div className="text-center py-16">
          <span className="pv2-section-icon mx-auto mb-4 h-14 w-14">
            <SearchX className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
          </span>
          <p className="pv2-title text-lg mb-2">No encontramos resultados para &ldquo;{query}&rdquo;</p>
          <p className="pv2-subtitle text-sm mb-6">Probá con otras palabras clave o explorá los comercios del barrio.</p>
          <Link href="/" className="pv2-btn pv2-btn-primary px-5 py-2.5 text-sm">
            Volver al inicio
          </Link>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Vendors */}
          {vendors.length > 0 && (
            <section>
              <h2 className="pv2-title text-xl mb-5">Comercios ({vendors.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {vendors.map((v) => (
                  <VendorCard
                    key={v.id}
                    id={v.id}
                    slug={v.slug}
                    store_name={v.store_name}
                    image_url={v.image_url}
                    description={v.description}
                    vertical={v.vertical}
                    hours={v.hours}
                    open_override={v.open_override ?? null}
                    acceptsCart={onlineById.get(v.id) ?? null}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Products */}
          {products.length > 0 && (
            <section>
              <h2 className="pv2-title text-xl mb-5">Productos ({products.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {products.map((p) => (
                  <Link key={p.id} href={`/tienda/${p.vendors?.slug || ""}`} className="block h-full">
                    <Card className="pv2-card flex h-full items-center overflow-hidden">
                      <div className="flex w-full items-center gap-4 p-4">
                        {p.image_url ? (
                          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl">
                            <ProductImage src={p.image_url} name={p.name} category={p.category} vertical={p.vendors?.vertical} alt={p.name} className="h-full w-full object-cover" />
                          </div>
                        ) : (
                          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl">
                            <ProductImage src={null} name={p.name} category={p.category} vertical={p.vendors?.vertical} alt={p.name} className="h-full w-full" iconClassName="h-7 w-7" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="pv2-title truncate text-sm">{p.name}</p>
                          {p.description && <p className="pv2-subtitle mt-0.5 line-clamp-2 text-xs">{p.description}</p>}
                          <div className="mt-2 flex items-center gap-2 min-w-0">
                            <span className="pv2-chip pv2-chip-muted truncate">{p.vendors?.store_name}</span>
                            {p.category && <span className="truncate text-xs text-muted-foreground">{p.category}</span>}
                          </div>
                        </div>
                        <span className="pv2-price flex-shrink-0 text-base">
                          {(() => {
                            const info = priceInfo(p);
                            const pct = cashByVendor.get(p.vendor_id) ?? 0;
                            const show =
                              !info.hasPromo
                                ? false
                                : normalizeCashPct(pct) > 0 &&
                                  cashAppliesToItem({ hasPromo: info.hasPromo, excluded: p.cash_discount_excluded });
                            return show ? (
                              <CashPrice
                                price={Number(p.promo_price ?? p.price)}
                                hasPromo={info.hasPromo}
                                excluded={p.cash_discount_excluded}
                                cashPct={pct}
                                size="sm"
                                plainClassName="pv2-price text-base flex-shrink-0"
                              />
                            ) : (
                              <>{info.label}</>
                            );
                          })()}
                        </span>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
