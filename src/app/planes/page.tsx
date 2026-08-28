import { queryMany } from "@/lib/db";
import { activePromo, formatPrice } from "@/lib/plans";
import type { Plan } from "@/types/database";
import { PlanesCta } from "@/components/subscription/planes-cta";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const FEATURE_LABELS: Record<string, string> = {
  info: "Ficha de comercio + menú informativo",
  cart: "Carrito y pedido online",
  emits_orders: "Pedidos por la app con avisos",
  mp_payments: "Cobros online con Mercado Pago",
  kds: "Comanda digital",
  printer: "Impresión de tickets y comandas",
  variants: "Variedades (talle, color, gustos)",
  modifiers: "Modificadores y extras",
  urgent: "Pedidos urgentes",
  pos: "Mostrador (armá pedido y cobrá)",
  mesas: "Gestión de mesas",
  reviews_manage: "Respondé reseñas",
  priority: "Prioridad en el buscador",
};

const FEATURE_ORDER = [
  "info",
  "cart",
  "emits_orders",
  "mp_payments",
  "kds",
  "printer",
  "variants",
  "modifiers",
  "urgent",
  "pos",
  "mesas",
  "reviews_manage",
  "priority",
];

export default async function PlanesPage() {
  const plans = await queryMany<Plan>(
    `SELECT * FROM plans ORDER BY sort ASC`
  );

  const list = plans || [];

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10 sm:py-16 max-w-5xl">
        <div className="text-center mb-10">
          <Badge variant="secondary" className="rounded-full mb-3 text-[11px]">
            0% de comisión por venta
          </Badge>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold mb-3">
            Planes para tu comercio
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base max-w-xl mx-auto">
            Arrancás gratis y crecés cuando quieras. Pagos y cobros a la medida de un
            comercio de barrio.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Los planes pagos están disponibles por ahora para <b>gastronomía</b>.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {list.map((plan) => {
            const paid = plan.slug !== "gratuito";
            const promo = activePromo(plan);
            const products = plan.max_products == null
              ? "Productos ilimitados"
              : `${plan.max_products} productos`;
            const analyticsLabel =
              plan.features.analytics_days != null && plan.features.analytics_days > 0
                ? `Estadísticas (${plan.features.analytics_days} días)`
                : plan.features.analytics_days === 0
                  ? null
                  : "Estadísticas ilimitadas";

            const features = FEATURE_ORDER.filter((key) =>
              (plan.features as Record<string, unknown>)[key] === true
            )
              .map((key) => FEATURE_LABELS[key])
              .concat(analyticsLabel ? [analyticsLabel] : []);

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border bg-card p-6 ${
                  plan.popular
                    ? "border-primary shadow-lg shadow-primary/10"
                    : "border-border"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1">
                    MÁS ELEGIDO
                  </span>
                )}
                {plan.badge && plan.badge !== "Gratuito" && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-sun text-ink text-[10px] font-bold px-3 py-1">
                    {plan.badge}
                  </span>
                )}

                <h2 className="font-display text-lg font-semibold">{plan.name}</h2>
                <p className="text-xs text-muted-foreground mt-0.5 min-h-8">{plan.description}</p>

                <div className="mt-3 mb-4">
                  {promo ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-2xl font-bold">
                        {formatPrice(promo.price)}
                      </span>
                      <span className="font-display text-lg font-semibold text-muted-foreground line-through">
                        {formatPrice(promo.listPrice)}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[11px] font-bold px-2 py-0.5">
                        -{promo.offPct}%
                      </span>
                    </div>
                  ) : (
                    <span className="font-display text-2xl font-bold">
                      {plan.price_monthly === 0 ? "Gratis" : formatPrice(plan.price_monthly)}
                    </span>
                  )}
                  {paid && (
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      {promo
                        ? `por mes · ${promo.months} ${promo.months === 1 ? "mes" : "meses"} por adelantado`
                        : "por mes"}
                    </span>
                  )}
                  {promo?.label && (
                    <span className="block text-[11px] font-semibold text-red-500 mt-0.5">
                      {promo.label}
                    </span>
                  )}
                  {promo?.endsAt && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Válido hasta {new Date(promo.endsAt).toLocaleDateString("es-AR")} para nuevos suscriptores
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">{products}</p>
                </div>

                <ul className="space-y-2 mb-6 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 flex-shrink-0 text-primary">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="border-t border-border pt-4">
                  <div className="mb-3 text-center text-[11px] text-muted-foreground">
                    {paid ? "30 días de prueba gratis" : "Sin tarjeta, sin contrato"}
                  </div>
                  <PlanesCta slug={plan.slug} planName={plan.name} trial={paid} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 rounded-2xl border border-border bg-card p-6 text-center">
          <h3 className="font-display text-lg font-semibold mb-1">
            ¿Tu rubro todavía no tiene planes?
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Estamos habilitando planes para otros rubros muy pronto. Mientras tanto,
            arrancá gratis con tu vidriera.
          </p>
        </div>
      </div>
    </main>
  );
}