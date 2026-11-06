import { queryMany } from "@/lib/db";
import { activePromo, formatPrice } from "@/lib/plans";
import type { Plan } from "@/types/database";
import { PlanesCta } from "@/components/subscription/planes-cta";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Planes para comercios de barrio — precios y funciones | Portal 659",
  description:
    "Planes para tu comercio, kiosco, almacén, gastronomía, peluquería, taller o servicio: gratis para empezar (vidriera + contacto por WhatsApp), pedidos online ilimitados, POS con mostrador y caja, impresión de tickets y cobro online. 0% comisión por venta.",
  alternates: { canonical: "/planes" },
};

export const FEATURE_LABELS: Record<string, string> = {
  info: "Ficha de comercio + contacto por WhatsApp",
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
  quotes_respond: "Cotizá presupuestos con precio (servicios)",
  deposits: "Cobrá seña online con Mercado Pago (servicios)",
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
  "quotes_respond",
  "deposits",
];

/**
 * Detalle por vertical (copy de la web; los precios salen de la tabla plans).
 * El plan del medio se llama "Oficios" en servicios y "Básico" en el resto.
 */
const VERTICAL_DETAIL: {
  key: string;
  name: string;
  gratuito: string[];
  medio: string[];
  gestion: string[];
}[] = [
  {
    key: "gastronomia",
    name: "Gastronomía",
    gratuito: [
      "Ficha del local y contacto por WhatsApp",
      "Carta informativa (hasta 10 platos)",
      "Sin carrito, sin pedidos online",
    ],
    medio: [
      "Carrito + checkout online",
      "Pedidos ilimitados por mes",
      "Analítica 7 días y gestión de reseñas",
      "Seña por Mercado Pago",
    ],
    gestion: [
      "Mostrador (POS) y Caja con arqueo Z",
      "Mesas + Comanda (cocina)",
      "Impresión de tickets y comandas",
      "Clientes (CRM) y Preparación y Costo",
      "Analítica completa y 2 pantallas TV",
    ],
  },
  {
    key: "comercio",
    name: "Comercio de barrio",
    gratuito: [
      "Vidriera de productos (hasta 10)",
      "Contacto directo por WhatsApp",
      "Sin carrito, sin pedidos online",
    ],
    medio: [
      "Carrito + checkout online",
      "Retiro y/o delivery por la app",
      "Pedidos ilimitados por mes",
      "Analítica 7 días y gestión de reseñas",
      "Seña por Mercado Pago",
    ],
    gestion: [
      "Mostrador (POS) y Caja con arqueo Z",
      "Clientes (CRM) e impresión de tickets",
      "Analítica completa y 2 pantallas TV",
      "Sin cocina ni mesas (no aplican al rubro)",
    ],
  },
  {
    key: "moda",
    name: "Moda",
    gratuito: [
      "Catálogo de productos (hasta 10)",
      "Variantes color y talle para ver",
      "Contacto directo por WhatsApp",
      "Sin carrito, sin pedidos online",
    ],
    medio: [
      "Carrito + checkout online",
      "Variantes color × talle activas para compra",
      "Pedidos ilimitados por mes",
      "Analítica 7 días y gestión de reseñas",
      "Seña por Mercado Pago",
    ],
    gestion: [
      "Mostrador (POS) y Caja con arqueo Z",
      "Clientes (CRM) e impresión de tickets",
      "Analítica completa y 2 pantallas TV",
    ],
  },
  {
    key: "estetica",
    name: "Peluquería y Estética",
    gratuito: [
      "Ficha de servicios (hasta 10)",
      "Contacto directo por WhatsApp",
      "Sin turnos online, sin carrito",
    ],
    medio: [
      "Turnos y consultas ilimitados",
      "Carrito de productos + checkout",
      "Cotización con precio y seña por Mercado Pago",
      "Analítica 7 días y gestión de reseñas",
    ],
    gestion: [
      "Mostrador (POS) y Caja con arqueo Z",
      "Clientes (historial de turnos y pedidos)",
      "Impresión de tickets",
      "Analítica completa y 2 pantallas TV",
    ],
  },
  {
    key: "taller",
    name: "Talleres y Reparaciones",
    gratuito: [
      "Ficha de servicios (hasta 10)",
      "Contacto directo por WhatsApp",
      "Sin presupuestos online, sin carrito",
    ],
    medio: [
      "Presupuestos y turnos ilimitados",
      "Presupuesto con partidas (material + mano de obra)",
      "Carrito de repuestos + checkout",
      "Seña por Mercado Pago y analítica 7 días",
      "Gestión de reseñas",
    ],
    gestion: [
      "Mostrador (POS) y Caja con arqueo Z",
      "Clientes (historial por equipo)",
      "Impresión de tickets y presupuestos A4",
      "Analítica completa y 2 pantallas TV",
    ],
  },
  {
    key: "servicio",
    name: "Servicios (plomero, electricista…)",
    gratuito: [
      "Ficha de contacto y WhatsApp",
      "Sin cotizaciones ni turnos online",
    ],
    medio: [
      "Solicitudes ilimitadas (presupuestos + turnos)",
      "Cotización con precio visible online",
      "Seña por Mercado Pago",
      "Urgencia con recargo %",
      "Reseñas y analítica 30 días",
    ],
    gestion: [
      "Clientes (CRM) e historial de trabajos",
      "Analítica completa",
      "El Mostrador y la Caja no aplican al rubro",
    ],
  },
];

export default async function PlanesPage() {
  const plans = await queryMany<Plan>(
    `SELECT * FROM plans ORDER BY sort ASC`
  );

  // La fila histórica del gratuito (grandfathering) no se muestra al público.
  const list = (plans || []).filter((p) => String(p.slug) !== "gratuito_legacy");

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
            Empezás con tu vidriera y contacto por WhatsApp, gratis. La venta online
            (carrito, pedidos, turnos) arranca en el plan Básico.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Los planes pagos están disponibles para <b>gastronomía</b>, <b>comercios de barrio</b>, <b>moda</b>, <b>peluquería y estética</b>, <b>talleres y reparaciones</b> y <b>servicios</b> (plan <b>Oficios</b>). Peluquería y estética usa <b>Básico</b> (Turnera) y Gestión integral; talleres usa <b>Básico</b> (Taller) y Gestión integral; servicios usa <b>Oficios</b>.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {list.map((plan) => {
            const paid = plan.slug !== "gratuito";
            const promo = activePromo(plan);
            const products = plan.max_products == null
              ? "Productos ilimitados"
              : plan.max_products === 0
                ? "Sin productos publicados"
                : `Hasta ${plan.max_products} productos o servicios`;
            const orderLimit = plan.slug === "gratuito"
              ? "Sin pedidos ni turnos online (solo contacto)"
              : plan.max_orders_month != null
                ? `Hasta ${plan.max_orders_month} pedidos por mes`
                : "Pedidos ilimitados por mes";
            // Tope de solicitudes: solo se muestra en Oficios (para servicios el
            // gratuito trae 5, que ya se comunica en su panel).
            const quoteLimit = plan.slug === "oficios"
              ? "Solicitudes ilimitadas por mes"
              : null;
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
                {/* Pills en flujo (nunca absolutos): no pueden tapar el nombre
                    ni pisarse entre sí; el espaciador alinea los nombres. */}
                <div className="flex flex-wrap gap-1.5 mb-3 min-h-6">
                  {plan.popular && (
                    <span className="rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1">
                      MÁS ELEGIDO
                    </span>
                  )}
                  {plan.badge && plan.badge !== "Gratuito" && (
                    <span className="rounded-full bg-sun text-ink text-[10px] font-bold px-3 py-1">
                      {plan.badge}
                    </span>
                  )}
                </div>

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
                  <p className="text-xs text-muted-foreground mt-0.5">{orderLimit}</p>
                  {quoteLimit && <p className="text-xs text-muted-foreground mt-0.5">{quoteLimit}</p>}
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

        {/* Detalle por vertical */}
        <section className="mt-14">
          <h2 className="font-display text-xl sm:text-2xl font-semibold mb-2 text-center">
            Qué incluye cada plan en tu rubro
          </h2>
          <p className="text-sm text-muted-foreground text-center mb-8 max-w-2xl mx-auto">
            El plan del medio es <b>Básico</b> en todos los rubros que venden, y{" "}
            <b>Oficios</b> en servicios. Funciones que no aplican a tu vertical
            (cocina, mesas, mostrador) nunca se activan.
          </p>
          <div className="space-y-6">
            {VERTICAL_DETAIL.map((v) => (
              <div key={v.key} className="rounded-2xl border border-border bg-card p-5">
                <h3 className="font-display font-semibold mb-4">{v.name}</h3>
                <div className="grid sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                      Gratuito
                    </p>
                    <ul className="space-y-1.5">
                      {v.gratuito.map((i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0 text-primary">✓</span>
                          <span>{i}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                      {v.key === "servicio" ? "Oficios" : "Básico"}
                    </p>
                    <ul className="space-y-1.5">
                      {v.medio.map((i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0 text-primary">✓</span>
                          <span>{i}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                      Gestión integral
                    </p>
                    <ul className="space-y-1.5">
                      {v.gestion.map((i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0 text-primary">✓</span>
                          <span>{i}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-10 rounded-2xl border border-border bg-card p-6 text-center">
          <h3 className="font-display text-lg font-semibold mb-1">
            Topes del plan gratuito
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            El plan gratuito es tu vidriera: hasta 10 productos o servicios y contacto
            directo por WhatsApp, sin carrito, sin pedidos online y sin turnos online.
            Farmacias, dietéticas y perfumerías usan los planes de comercio.
          </p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto mt-2">
            Si ya tenías un comercio gratuito con carrito y pedidos funcionando, se
            conserva como estaba: no se te cambia el plan.
          </p>
        </div>
      </div>
    </main>
  );
}
