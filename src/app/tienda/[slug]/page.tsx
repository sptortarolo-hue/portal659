import { getSupabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";

export const dynamic = "force-dynamic";

export default async function TiendaPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = getSupabase();
  if (!supabase) notFound();

  const { data: vendor } = await supabase
    .from("vendors")
    .select("*")
    .eq("slug", params.slug)
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

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="rounded-2xl overflow-hidden border mb-8">
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
            <span className="text-6xl font-bold text-orange-400">
              {v.store_name.charAt(0)}
            </span>
          </div>
        )}
        <div className="p-6">
          <h1 className="text-3xl font-bold">{v.store_name}</h1>
          {v.description && (
            <p className="text-gray-600 mt-2">{v.description}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-sm text-gray-600">
            {v.hours && <span>Horarios: {v.hours}</span>}
            {v.address && <span>Dirección: {v.address}</span>}
            {v.neighborhood && (
              <span className="capitalize">Barrio: {v.neighborhood}</span>
            )}
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold mb-4">Menú</h2>
      {!offers || offers.length === 0 ? (
        <p className="text-gray-500 text-center py-12">
          Este local todavía no cargó su menú.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {offers.map((o: any) => (
            <div
              key={o.id}
              className="border rounded-xl p-4 flex items-start justify-between gap-4"
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
                  <div className="h-16 w-16 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <span className="text-2xl font-bold text-orange-300">
                      {o.name.charAt(0)}
                    </span>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold leading-tight">{o.name}</p>
                    {o.featured_today && <Badge>Hoy</Badge>}
                  </div>
                  {o.description && (
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                      {o.description}
                    </p>
                  )}
                  {o.category && (
                    <p className="text-xs text-gray-400 mt-1 capitalize">
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
