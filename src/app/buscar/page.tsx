import Link from "next/link";
import { queryMany } from "@/lib/db";
import { VERTICALS } from "@/lib/config";
import { getZone } from "@/lib/zone";
import { vendorSellsOnline } from "@/lib/plans";
import { cashAppliesToItem, normalizeCashPct } from "@/lib/cash-discount";
import { sortTalles } from "@/lib/size-guides";
import { CashPrice } from "@/components/store/cash-price";
import type { Plan } from "@/types/database";
import { Card, CardContent } from "@/components/ui/card";
import { ProductImage } from "@/components/product-image";

export const dynamic = "force-dynamic";

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

/** Pill de modo de venta (compartida por las tarjetas de esta página). */
function OnlineBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full tabular-nums ${
        online ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
      }`}
    >
      {online ? "🛒 Pedí online" : "💬 Solo contacto"}
    </span>
  );
}

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
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "border-border text-muted-foreground hover:border-primary hover:text-primary"
    }`;

  const allVendors = (await queryMany<Record<string, unknown>>(
    `SELECT * FROM vendors
     WHERE neighborhood = ANY($1) AND visible = true
     ORDER BY store_name`,
    [zone.neighborhoods]
  )) as unknown as VendorRow[];

  if (!query) {
    let list = vertical ? allVendors.filter((v) => v.vertical === vertical) : allVendors;
    const onlineCount = list.filter((v) => isOnline(v)).length;
    if (onlineOnly) list = list.filter((v) => isOnline(v));
    return (
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-semibold mb-2">Explorar comercios</h1>
          <p className="text-muted-foreground text-sm">
            Comercios de {zone.name} · elegí una categoría para filtrar
          </p>
        </div>

        {/* Vertical filters */}
        <div className="flex flex-wrap gap-2 mb-8">
          <Link
            href={hrefVertical(null)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              !vertical ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            Todos
          </Link>
          {VERTICALS.map((vert) => (
            <Link
              key={vert.slug}
              href={hrefVertical(vert.slug)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                vertical === vert.slug
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              {vert.emoji} {vert.name}
            </Link>
          ))}
          <Link
            href={hrefOnline(!onlineOnly)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              onlineOnly
                ? "bg-green-600 text-white border-green-600"
                : "border-border text-muted-foreground hover:border-green-600 hover:text-green-700"
            }`}
          >
            🛒 Venden online{onlineCount > 0 ? ` (${onlineCount})` : ""}
          </Link>
        </div>

        {list.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-6xl mb-4">🏪</p>
            <p className="text-lg font-medium mb-2">Todavía no hay comercios en esta categoría</p>
            <p className="text-sm text-muted-foreground mb-6">Probá con otra categoría o volvé a todos.</p>
            <Link href="/buscar" className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary/90">
              Ver todos
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {list.map((v) => (
              <Link key={v.id} href={`/tienda/${v.slug}`} className="block">
                <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden h-full">
                  {v.image_url ? (
                    <div className="h-28 w-full">
                      <ProductImage src={v.image_url} name={v.store_name} vertical={v.vertical} alt={v.store_name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-28 w-full flex items-center justify-center overflow-hidden">
                      <ProductImage src={null} name={v.store_name} vertical={v.vertical} alt={v.store_name} className="w-full h-full" iconClassName="h-10 w-10" />
                    </div>
                  )}
                  <CardContent className="p-4">
                    <h3 className="font-semibold">{v.store_name}</h3>
                    {v.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{v.description}</p>}
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <p className="text-xs text-primary font-medium">
                        {!isOnline(v) || v.vertical === "servicio" ? "Ver y contactar →" : "Ver y pedir →"}
                      </p>
                      <OnlineBadge online={isOnline(v)} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
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
       WHERE neighborhood = ANY($2) AND visible = true AND (store_name ILIKE $1 OR description ILIKE $1 OR category ILIKE $1 OR services_list ILIKE $1)
       ORDER BY store_name`,
      [pattern, zone.neighborhoods]
    ),
    queryMany<Record<string, unknown>>(
      `SELECT p.*, json_build_object('id', v.id, 'slug', v.slug, 'store_name', v.store_name, 'vertical', v.vertical, 'image_url', v.image_url) AS vendors
       FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       WHERE p.available = true AND p.neighborhood = ANY($2) AND v.visible = true AND (p.name ILIKE $1 OR p.description ILIKE $1 OR p.category ILIKE $1)
       ORDER BY p.name`,
      [pattern, zone.neighborhoods]
    ),
  ]) as unknown as [VendorRow[], ProductRow[]];

  if (vertical) {
    vendors = vendors.filter((v) => v.vertical === vertical);
    products = products.filter((p) => p.vendors?.vertical === vertical);
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
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold mb-2">
          Resultados para &ldquo;{query}&rdquo;
        </h1>
        <p className="text-muted-foreground text-sm">
          {totalResults === 0
            ? "No encontramos nada"
            : `${totalResults} resultado${totalResults !== 1 ? "s" : ""}`}
          {vertical && ` en ${VERTICALS.find((v) => v.slug === vertical)?.name || vertical}`}
        </p>
      </div>

      {/* Vertical filters */}
      <div className="flex flex-wrap gap-2 mb-8">
        <Link
          href={hrefVertical(null)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            !vertical ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
        >
          Todos
        </Link>
        {VERTICALS.map((vert) => (
          <Link
            key={vert.slug}
            href={hrefVertical(vert.slug)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              vertical === vert.slug
                ? `bg-${vert.color} text-white border-${vert.color}`
                : `border-${vert.color}/30 text-${vert.color} hover:bg-${vert.color}/10`
            }`}
          >
            {vert.emoji} {vert.name}
          </Link>
        ))}
        <Link
          href={hrefOnline(!onlineOnly)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            onlineOnly
              ? "bg-green-600 text-white border-green-600"
              : "border-border text-muted-foreground hover:border-green-600 hover:text-green-700"
          }`}
        >
          🛒 Venden online
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
              className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
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
              className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
              aria-label="Precio máximo"
            />
            <button type="submit" className="h-8 rounded-full border border-border bg-card px-3 text-xs font-medium hover:border-primary">
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
          <p className="text-6xl mb-4">🔍</p>
          <p className="text-lg font-medium mb-2">No encontramos resultados para &ldquo;{query}&rdquo;</p>
          <p className="text-sm text-muted-foreground mb-6">Probá con otras palabras clave o explorá los comercios del barrio.</p>
          <Link href="/" className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary/90">
            Volver al inicio
          </Link>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Vendors */}
          {vendors.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold mb-4">Comercios ({vendors.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {vendors.map((v) => (
                  <Link key={v.id} href={`/tienda/${v.slug}`} className="block">
                    <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                      {v.image_url ? (
                        <div className="h-28 w-full">
                          <ProductImage src={v.image_url} name={v.store_name} vertical={v.vertical} alt={v.store_name} className="w-full h-full" />
                        </div>
                      ) : (
                        <div className="h-28 w-full bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
                          <span className="font-display text-4xl font-bold text-primary/30">{v.store_name.charAt(0)}</span>
                        </div>
                      )}
                      <CardContent className="p-4">
                        <h3 className="font-semibold">{v.store_name}</h3>
                        {v.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{v.description}</p>}
                        <div className="flex items-center justify-between gap-2 mt-2">
                          <p className="text-xs text-primary font-medium">
                            {!onlineById.get(v.id) || v.vertical === "servicio" ? "Ver y contactar →" : "Ver y pedir →"}
                          </p>
                          <OnlineBadge online={!!onlineById.get(v.id)} />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Products */}
          {products.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold mb-4">Productos ({products.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {products.map((p) => (
                  <Link key={p.id} href={`/tienda/${p.vendors?.slug || ""}`} className="block">
                    <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                      <div className="flex items-center gap-3 p-4">
                        {p.image_url ? (
                          <div className="h-16 w-16 rounded-lg overflow-hidden flex-shrink-0">
                            <ProductImage src={p.image_url} name={p.name} category={p.category} vertical={p.vendors?.vertical} alt={p.name} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="h-16 w-16 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                            <ProductImage src={null} name={p.name} category={p.category} vertical={p.vendors?.vertical} alt={p.name} className="w-full h-full" iconClassName="h-7 w-7" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm truncate">{p.name}</p>
                          {p.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.description}</p>}
                          <div className="flex items-center gap-2 mt-1 min-w-0">
                            <span className="text-xs text-muted-foreground truncate">{p.vendors?.store_name}</span>
                            {p.category && <span className="text-xs text-muted-foreground truncate shrink-0">· {p.category}</span>}
                          </div>
                        </div>
                        <span className="font-bold text-sm flex-shrink-0">
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
                                plainClassName="font-bold text-sm flex-shrink-0"
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
