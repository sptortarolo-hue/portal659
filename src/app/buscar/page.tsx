import Link from "next/link";
import { queryMany } from "@/lib/db";
import { VERTICALS } from "@/lib/config";
import { getZone } from "@/lib/zone";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vertical?: string }>;
}) {
  const zone = await getZone();
  const { q, vertical } = await searchParams;
  const query = (q || "").trim();

  if (!query) {
    return (
      <main className="container mx-auto px-4 py-12 text-center">
        <h1 className="font-display text-3xl font-semibold mb-4">Buscar</h1>
        <p className="text-muted-foreground">
          Escribí algo en la barra de búsqueda para encontrar comercios y productos.
        </p>
        <Link href="/" className="text-primary text-sm mt-4 inline-block hover:underline">
          Volver al inicio
        </Link>
      </main>
    );
  }

  const pattern = `%${query}%`;

  let [vendors, products] = await Promise.all([
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
  ]);

  if (vertical) {
    vendors = vendors.filter((v: any) => v.vertical === vertical);
    products = products.filter((p: any) => p.vendors?.vertical === vertical);
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
          href={`/buscar?q=${encodeURIComponent(query)}`}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            !vertical ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
        >
          Todos
        </Link>
        {VERTICALS.map((vert) => (
          <Link
            key={vert.slug}
            href={`/buscar?q=${encodeURIComponent(query)}&vertical=${vert.slug}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              vertical === vert.slug
                ? `bg-${vert.color} text-white border-${vert.color}`
                : `border-${vert.color}/30 text-${vert.color} hover:bg-${vert.color}/10`
            }`}
          >
            {vert.emoji} {vert.name}
          </Link>
        ))}
      </div>

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
                {vendors.map((v: any) => (
                  <Link key={v.id} href={`/tienda/${v.slug}`} className="block">
                    <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                      {v.image_url ? (
                        <div className="h-28 w-full">
                          <img src={v.image_url} alt={v.store_name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="h-28 w-full bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
                          <span className="font-display text-4xl font-bold text-primary/30">{v.store_name.charAt(0)}</span>
                        </div>
                      )}
                      <CardContent className="p-4">
                        <h3 className="font-semibold">{v.store_name}</h3>
                        {v.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{v.description}</p>}
                        <p className="text-xs text-primary mt-2 font-medium">
                          {v.vertical === "servicio" ? "Ver y contactar →" : "Ver y pedir →"}
                        </p>
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
                {products.map((p: any) => (
                  <Link key={p.id} href={`/tienda/${p.vendors?.slug || ""}`} className="block">
                    <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                      <div className="flex items-center gap-3 p-4">
                        {p.image_url ? (
                          <div className="h-16 w-16 rounded-lg overflow-hidden flex-shrink-0">
                            <img src={p.image_url} alt={p.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="h-16 w-16 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                            <span className="font-display text-2xl font-bold text-primary/40">{p.name.charAt(0)}</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm truncate">{p.name}</p>
                          {p.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.description}</p>}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">{p.vendors?.store_name}</span>
                            {p.category && <span className="text-xs text-muted-foreground">· {p.category}</span>}
                          </div>
                        </div>
                        <span className="font-bold text-sm flex-shrink-0">${Number(p.price).toLocaleString("es-AR")}</span>
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
