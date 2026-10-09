"use client";

import { useState } from "react";
import { ProductImage } from "@/components/product-image";
import { WeeklyHours } from "@/components/store/weekly-hours";
import { IrAComprarButton } from "@/components/store/ir-a-comprar-button";
import { FavoriteButton } from "@/components/favorites/favorite-button";
import { WhatsAppShareButton } from "@/components/store/whatsapp-share-button";
import { VendorShareButton } from "@/components/store/vendor-share-button";
import { Badge } from "@/components/ui/badge";
import { isStoreOpen } from "@/lib/open-hours";
import { neighborhoodLabel } from "@/lib/json-ld";

type VendorData = {
  id: string;
  slug: string;
  store_name: string;
  logo_url: string | null;
  image_url: string | null;
  description: string | null;
  category: string | null;
  vertical: string;
  neighborhood: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  hours: string | null;
  open_override: boolean | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  payment_methods: string | null;
  delivery_options: string;
  delivery_fee: number | null;
  free_delivery_min: number | null;
  delivery_prep_min: number | null;
  delivery_area_text: string | null;
  cash_discount_pct: number | null;
  prep_time_min: number | null;
  verified: boolean;
  accepts_online_orders: boolean;
  carta_visibility: string;
  services_list: string | null;
  service_area: string | null;
  free_estimate: boolean | null;
  urgent_enabled: boolean | null;
  quote_pref_enabled: boolean | null;
  quote_days: string[] | null;
  quote_slots: string[] | null;
  bookings_enabled: boolean | null;
  accepting_quotes: boolean | null;
};

type StoreHeaderProps = {
  vendor: VendorData;
  planBadge: string | null;
  acceptsCart: boolean;
  isService: boolean;
  isModa: boolean;
  isCatalog: boolean;
  isGastro: boolean;
  menuHidden: boolean;
  offersCount: number;
  avgRating: number | null;
  reviewCount: number;
  storeBlurb: string;
  waUrl: string;
  waNumber: string;
  retailSlots: { id: string; label: string; range: string; isToday: boolean; isTomorrow: boolean }[];
  retailDeliveryOpen: boolean | null;
  retailDeliveryPaused: boolean;
  retailPauseMsg: string | null;
  isEstetica: boolean;
  urgentSurcharge: number | null;
};

export function StoreHeader({
  vendor: v,
  planBadge,
  acceptsCart,
  isService,
  isModa,
  isCatalog,
  isGastro,
  menuHidden,
  offersCount,
  avgRating,
  reviewCount,
  storeBlurb,
  waUrl,
  waNumber,
  retailSlots,
  retailDeliveryOpen,
  retailDeliveryPaused,
  retailPauseMsg,
  isEstetica,
  urgentSurcharge,
}: StoreHeaderProps) {
  const [showMap, setShowMap] = useState(false);
  const openNow = isStoreOpen(v as any);
  const hood = neighborhoodLabel(v.neighborhood);
  const rubro = v.category || v.vertical;

  const mapsUrl = v.lat != null && v.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`
    : v.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address + ", La Plata")}`
      : null;

  const deliveryLabel = v.delivery_options === "retiro"
    ? "Solo retiro"
    : v.delivery_options === "domicilio"
      ? "Solo delivery"
      : "Retiro y delivery";

  const deliveryFeeLabel = v.delivery_fee != null && Number(v.delivery_fee) > 0
    ? `$${Number(v.delivery_fee).toLocaleString("es-AR")}`
    : "Gratis";

  const freeDeliveryLabel = v.free_delivery_min != null && Number(v.free_delivery_min) > 0
    ? `Gratis desde $${Number(v.free_delivery_min).toLocaleString("es-AR")}`
    : null;

  const prepLabel = v.delivery_prep_min != null && Number(v.delivery_prep_min) > 0
    ? `~${Number(v.delivery_prep_min)} min`
    : v.prep_time_min != null && Number(v.prep_time_min) > 0
      ? `~${Number(v.prep_time_min)} min`
      : null;

  const cashDiscountLabel = v.cash_discount_pct != null && Number(v.cash_discount_pct) > 0
    ? `−${Number(v.cash_discount_pct)}% efectivo`
    : null;

  const paymentMethods = v.payment_methods
    ? v.payment_methods.split(",").map((s: string) => s.trim()).filter(Boolean)
    : [];

  const socials = [
    { label: "Instagram", url: v.instagram?.startsWith("http") ? v.instagram : `https://instagram.com/${v.instagram?.replace("@", "")}`, icon: "📷" },
    { label: "Facebook", url: v.facebook?.startsWith("http") ? v.facebook : `https://facebook.com/${v.facebook}`, icon: "📘" },
  ].filter((s) => s.url);

  // Servicios: días y franjas de atención (mismo vocabulario que QuoteForm).
  const DAY_LABELS: Record<string, string> = {
    lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom",
  };
  const attentionDays = Array.isArray(v.quote_days) && v.quote_pref_enabled !== false
    ? v.quote_days.map((d: string) => DAY_LABELS[d] || d).filter(Boolean)
    : [];
  const attentionSlots = Array.isArray(v.quote_slots) && v.quote_pref_enabled !== false
    ? v.quote_slots.map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).filter(Boolean)
    : [];
  const showUrgency = isService && !isEstetica && v.urgent_enabled === true;

  return (
    <div id="store-header" className="relative">
      {/* Zona 1: Hero con info superpuesta */}
      <div className="relative h-64 sm:h-80 w-full">
        {v.image_url ? (
          <ProductImage
            src={v.image_url}
            name={v.store_name}
            vertical={v.vertical}
            alt={v.store_name}
            className="w-full h-full object-cover"
            eager
          />
        ) : (
          <ProductImage
            src={null}
            name={v.store_name}
            vertical={v.vertical}
            alt={v.store_name}
            className="w-full h-full"
            iconClassName="h-24 w-24"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />

        {/* Info superpuesta */}
        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
          <div className="container mx-auto max-w-4xl">
            {/* Logo + nombre + rating */}
            <div className="flex items-end gap-3">
              {v.logo_url && (
                <ProductImage
                  src={v.logo_url}
                  name={v.store_name}
                  vertical={v.vertical}
                  alt={`Logo de ${v.store_name}`}
                  className="h-14 w-14 sm:h-16 sm:w-16 rounded-full border-2 border-white shadow-lg flex-shrink-0"
                  eager
                />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-white truncate">
                  {v.store_name}
                </h1>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <span className="text-white/80 text-sm">{rubro}{hood ? ` · ${hood}` : ""}</span>
                  {avgRating != null && (
                    <span className="flex items-center gap-1 text-sm">
                      <span className="text-yellow-400">★</span>
                      <span className="text-white font-semibold">{avgRating.toFixed(1)}</span>
                      <span className="text-white/60">({reviewCount})</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap mt-3">
              {openNow !== null && (
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  openNow ? "bg-green-500 text-white" : "bg-red-500 text-white"
                }`}>
                  {openNow ? "Abierto ahora" : "Cerrado"}
                </span>
              )}
              {v.verified && (
                <span className="rounded-full bg-blue-600/90 text-white px-3 py-1 text-xs font-semibold">
                  ✓ Verificado
                </span>
              )}
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                acceptsCart ? "bg-white/20 text-white" : "bg-white/10 text-white/70"
              }`}>
                {acceptsCart ? "Pedí online" : "Solo contacto"}
              </span>
              {planBadge && planBadge !== "Gratuito" && (
                <span className="rounded-full bg-white/20 text-white px-3 py-1 text-xs font-semibold">
                  {planBadge}
                </span>
              )}
            </div>

            {/* Acciones: favorito + compartir */}
            <div className="flex items-center gap-2 mt-4">
              <div className="flex items-center gap-2 ml-auto">
                <FavoriteButton vendorId={v.id} />
                <WhatsAppShareButton slug={v.slug} storeName={v.store_name} catalog={isCatalog} menuHidden={menuHidden} isService={isService} />
                <VendorShareButton slug={v.slug} storeName={v.store_name} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Zona 3 (arriba): Tags secundarios + descripción */}
      <div className="container mx-auto px-4 max-w-4xl -mt-6 relative z-10">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-lg">
          {v.description && (
            <p className="text-muted-foreground text-sm mb-3">{v.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {isGastro && acceptsCart && v.prep_time_min != null && Number(v.prep_time_min) > 0 && (
              <span className="rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium">
                ⏱️ {v.prep_time_min} min
              </span>
            )}
            {v.neighborhood && (
              <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground capitalize">
                📍 {v.neighborhood}
              </span>
            )}
            {(v as any).carta_visibility === "public" && !isService && (
              <a
                href={`/carta/${v.slug}`}
                className="rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium hover:bg-primary/20 transition-colors"
              >
                {isCatalog ? "Ver catálogo" : "Ver carta de mesa"}
              </a>
            )}
            {!isService && !isModa && !menuHidden && offersCount > 0 && (
              <IrAComprarButton label={acceptsCart ? undefined : isCatalog ? "Ver el catálogo" : "Ver la carta"} />
            )}
          </div>
        </div>
      </div>

      {/* Zona 2: Grid de info cards */}
      <div className="container mx-auto px-4 max-w-4xl mt-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* Ubicación (servicios: zona de cobertura si no hay dirección física) */}
          <div className="col-span-2 sm:col-span-1 rounded-2xl border border-border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">📍</span>
              <span className="font-semibold text-sm">
                {isService && !v.address ? "Zona de atención" : "Ubicación"}
              </span>
            </div>
            {v.address && (
              <p className="text-sm text-muted-foreground line-clamp-2">{v.address}</p>
            )}
            {isService && !v.address && v.service_area && (
              <p className="text-sm text-muted-foreground line-clamp-2">{v.service_area}</p>
            )}
            {hood && (
              <p className="text-xs text-muted-foreground mt-1 capitalize">{hood}</p>
            )}
            {mapsUrl && (
              <div className="flex items-center gap-2 mt-2">
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary font-medium hover:underline"
                >
                  Cómo llegar
                </a>
                <button
                  type="button"
                  onClick={() => setShowMap(!showMap)}
                  className="text-xs text-primary font-medium hover:underline"
                >
                  {showMap ? "Ocultar mapa" : "Ver mapa"}
                </button>
              </div>
            )}
            {showMap && mapsUrl && (
              <div className="mt-2 rounded-xl overflow-hidden border border-border">
                <iframe
                  title="Mapa del comercio"
                  src={`https://www.google.com/maps?q=${v.lat != null && v.lng != null ? `${v.lat},${v.lng}` : encodeURIComponent(v.address + ", La Plata")}&output=embed`}
                  width="100%"
                  height="150"
                  style={{ border: 0 }}
                  loading="lazy"
                  allowFullScreen
                />
              </div>
            )}
          </div>

          {/* Horarios */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🕐</span>
              <span className="font-semibold text-sm">Horarios</span>
            </div>
            {v.hours ? (
              <WeeklyHours hours={v.hours} openNow={openNow} />
            ) : (
              <p className="text-sm text-muted-foreground">No disponible</p>
            )}
          </div>

          {/* Servicios: atención en lugar de delivery (no tienen repartidor) */}
          {isService ? (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔧</span>
                <span className="font-semibold text-sm">Atención</span>
              </div>
              {v.service_area && (
                <p className="text-sm font-medium line-clamp-2">{v.service_area}</p>
              )}
              {!isEstetica && v.free_estimate !== false && (
                <p className="text-xs text-green-600 font-medium mt-1">Presupuesto sin cargo</p>
              )}
              {showUrgency && (
                <p className="text-xs text-red-600 font-medium mt-1">
                  🚨 Urgencias 24 h{urgentSurcharge != null ? ` (+${urgentSurcharge} %)` : ""}
                </p>
              )}
              {(attentionDays.length > 0 || attentionSlots.length > 0) && (
                <p className="text-xs text-muted-foreground mt-1">
                  {attentionDays.length > 0 ? attentionDays.join(" · ") : ""}
                  {attentionDays.length > 0 && attentionSlots.length > 0 ? " · " : ""}
                  {attentionSlots.length > 0 ? attentionSlots.join(" y ") : ""}
                </p>
              )}
              {v.bookings_enabled !== false && (
                <p className="text-xs text-muted-foreground mt-1">📅 Con turno online</p>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🛵</span>
                <span className="font-semibold text-sm">Delivery</span>
              </div>
              <p className="text-sm font-medium">{deliveryLabel}</p>
              {v.delivery_options !== "retiro" && (
                <div className="mt-1 space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    Envío: {deliveryFeeLabel}
                    {freeDeliveryLabel && ` · ${freeDeliveryLabel}`}
                  </p>
                  {prepLabel && (
                    <p className="text-xs text-muted-foreground">Tiempo: {prepLabel}</p>
                  )}
                </div>
              )}
              {v.delivery_area_text && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{v.delivery_area_text}</p>
              )}
              {isCatalog && retailSlots.length > 0 && v.delivery_options !== "retiro" && (
                <div className="mt-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    retailDeliveryPaused
                      ? "bg-amber-100 text-amber-800"
                      : retailDeliveryOpen === false
                        ? "bg-gray-100 text-gray-600"
                        : "bg-green-100 text-green-700"
                  }`}>
                    {retailDeliveryPaused
                      ? `Pausado · sale ${retailSlots[0].label}`
                      : retailDeliveryOpen === false
                        ? `Próximo: ${retailSlots[0].label}`
                        : `Llega ${retailSlots[0].label}`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Reseñas */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">⭐</span>
              <span className="font-semibold text-sm">Reseñas</span>
            </div>
            {avgRating != null ? (
              <>
                <div className="flex items-center gap-1">
                  <span className="text-2xl font-bold text-yellow-500">★</span>
                  <span className="text-xl font-bold">{avgRating.toFixed(1)}</span>
                  <span className="text-sm text-muted-foreground">({reviewCount})</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {reviewCount === 1 ? "1 reseña" : `${reviewCount} reseñas`}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Sin reseñas aún</p>
            )}
          </div>

          {/* Pagos */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">💳</span>
              <span className="font-semibold text-sm">Pagos</span>
            </div>
            {paymentMethods.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {paymentMethods.map((m: string) => (
                  <span key={m} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {m}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No especificado</p>
            )}
            {cashDiscountLabel && (
              <p className="text-xs text-green-600 font-medium mt-1">{cashDiscountLabel}</p>
            )}
          </div>

          {/* Redes y contacto */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">📱</span>
              <span className="font-semibold text-sm">Contacto</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {waNumber && (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
                >
                  💬 WhatsApp
                </a>
              )}
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
                >
                  {s.icon} {s.label}
                </a>
              ))}
              {v.phone && (
                <a
                  href={`tel:${v.phone}`}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
                >
                  ☎ Tel
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
