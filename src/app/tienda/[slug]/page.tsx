import { getSupabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";

export const dynamic = "force-dynamic";

export default async function TiendaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const supabase = getSupabase();
  if (!supabase) notFound();

  const { slug } = await params;

  const { data: vendor } = await supabase
    .from("vendors")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!vendor) notFound();

  const { data: offers } = await supabase
    .from("products")
    .select("*")
    .eq("vendor_id", vendor.id)
    .eq("available", true)
    .order("featured_today", { ascending: false })
    .order("name", { ascending: true });

  const { data: cats } = await supabase
    .from("vendor_categories")
    .select("*")
    .eq("vendor_id", vendor.id)
    .order("position", { ascending: true });

  const norm = (s: string | null) => (s || "").toLowerCase().trim();
  type Section = { name: string; items: any[] };
  const sections: Section[] = [];
  if (cats && cats.length > 0) {
    const used = new Set<string>();
    for (const c of cats as any[]) {
      const items = offers?.filter((o: any) => norm(o.category) === norm(c.name)) || [];
      if (items.length) {
        sections.push({ name: c.name, items });
        used.add(norm(c.name));
      }
    }
    const leftovers = offers?.filter((o: any) => !used.has(norm(o.category))) || [];
    if (leftovers.length) sections.push({ name: "Otros", items: leftovers });
  } else if (offers?.length) {
    sections.push({ name: "Menú", items: offers });
  }

  const v = vendor as any;
  const vendorBrief = {
    id: v.id,
    slug: v.slug,
    storeName: v.store_name,
    whatsapp: v.whatsapp || "",
  };

  const isService = v.vertical === "servicio";
  const waNumber = (v.whatsapp || "").replace(/[^0-9]/g, "");
  const waText = isService
    ? `Hola ${v.store_name}! Quiero consultar por tu servicio.`
    : `Hola ${v.store_name}! Quiero hacer un pedido.`;

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="rounded-2xl overflow-hidden border border-border bg-card mb-8">
        {v.image_url ? (
          <div className="h-48 w-full">
            <img
              src={v.image_url}
              alt={v.store_name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="h-48 w-full bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
            <span className="font-display text-7xl font-bold text-primary/70">
              {v.store_name.charAt(0)}
            </span>
          </div>
        )}
        <div className="p-6">
          {v.logo_url && (
            <img
              src={v.logo_url}
              alt={`Logo de ${v.store_name}`}
              className="h-16 w-16 rounded-full object-cover mb-3 border-2 border-white shadow"
            />
          )}
          <h1 className="font-display text-4xl font-semibold">
            {v.store_name}
          </h1>
          {v.description && (
            <p className="text-muted-foreground mt-2">{v.description}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-4 text-sm">
            {v.hours && (
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                Horarios: {v.hours}
              </span>
            )}
            {v.address && (
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                Dirección: {v.address}
              </span>
            )}
            {v.neighborhood && (
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground capitalize">
                {v.neighborhood}
              </span>
            )}
          </div>
          {waNumber && (
            <a
              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-whatsapp text-white px-5 py-2.5 text-sm font-medium hover:bg-whatsapp-dark"
            >
              {isService ? "Consultar por WhatsApp" : "Pedir por WhatsApp"}
            </a>
          )}
        </div>
      </div>

      {isService ? (
        <div className="border border-border rounded-2xl p-8 text-center bg-card">
          <h2 className="font-display text-2xl font-semibold mb-2">
            Servicio del barrio
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Este comercio ofrece un servicio en el barrio. Escribile por
            WhatsApp para consultar disponibilidad y coordinar el trabajo.
          </p>
          {waNumber && (
            <a
              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-whatsapp text-white px-6 py-3 text-sm font-medium hover:bg-whatsapp-dark"
            >
              Consultar por WhatsApp
            </a>
          )}
        </div>
      ) : (
        <>
      <h2 className="font-display text-2xl font-semibold mb-4">Menú</h2>
      {sections.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          Este local todavía no cargó su menú.
        </p>
      ) : (
        <>
          {sections.length > 1 && (
            <nav className="sticky top-16 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur-sm flex gap-2 overflow-x-auto mb-6">
              {sections.map((s, i) => (
                <a
                  key={s.name}
                  href={`#seccion-${i}`}
                  className="whitespace-nowrap rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
                >
                  {s.name}
                </a>
              ))}
            </nav>
          )}
          {sections.map((s, i) => (
            <section key={s.name} id={`seccion-${i}`} className="mb-10 scroll-mt-24">
              <h3 className="font-display text-xl font-semibold mb-4 border-b border-border pb-2">
                {s.name}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {s.items.map((o: any) => (
                  <div
                    key={o.id}
                    className="border border-border rounded-xl p-4 bg-card flex items-start justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {o.image_url ? (
                        <div className="h-16 w-16 rounded-lg overflow-hidden flex-shrink-0">
                          <img
                            src={o.image_url}
                            alt={o.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="h-16 w-16 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                          <span className="font-display text-2xl font-bold text-primary/60">
                            {o.name.charAt(0)}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold leading-tight">{o.name}</p>
                          {o.featured_today && (
                            <Badge className="bg-sun text-pine hover:bg-sun">
                              Hoy
                            </Badge>
                          )}
                        </div>
                        {o.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {o.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className="font-bold">
                        ${Number(o.price).toLocaleString("es-AR")}
                      </span>
                      <AddToCartButton
                        offerId={o.id}
                        name={o.name}
                        price={Number(o.price)}
                        vendor={vendorBrief}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      </>
      )}
    </main>
  );
}
