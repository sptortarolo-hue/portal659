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

  const v = vendor as any;
  const vendorBrief = {
    id: v.id,
    slug: v.slug,
    storeName: v.store_name,
    whatsapp: v.whatsapp || "",
  };

  const waNumber = (v.whatsapp || "").replace(/[^0-9]/g, "");

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
          <div className="h-48 w-full bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center">
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
              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(
                `Hola ${v.store_name}! Quiero hacer un pedido.`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-whatsapp text-white px-5 py-2.5 text-sm font-medium hover:bg-whatsapp-dark"
            >
              Pedir por WhatsApp
            </a>
          )}
        </div>
      </div>

      <h2 className="font-display text-2xl font-semibold mb-4">Menú</h2>
      {!offers || offers.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">
          Este local todavía no cargó su menú.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {offers.map((o: any) => (
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
                      <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                        Hoy
                      </Badge>
                    )}
                  </div>
                  {o.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {o.description}
                    </p>
                  )}
                  {o.category && (
                    <p className="text-xs text-muted-foreground mt-1 capitalize">
                      {o.category}
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
      )}
    </main>
  );
}
