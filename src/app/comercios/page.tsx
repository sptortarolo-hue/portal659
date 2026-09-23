import Link from "next/link";
import { queryMany } from "@/lib/db";
import { getZone } from "@/lib/zone";
import { activePromo, formatPrice } from "@/lib/plans";
import { FEATURE_LABELS } from "@/app/planes/page";
import { getSiteUrl } from "@/lib/site-url";
import { ProductImage } from "@/components/product-image";
import type { Plan, Vendor } from "@/types/database";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sumá tu comercio al barrio — Portal 659",
  description:
    "Mostrá tu comercio en Portal 659, el centro comercial de tu barrio: carta con QR, pedidos por app o WhatsApp, mostrador y mesas. Empezá gratis. 0% comisión por venta.",
};

/** WhatsApp de atención del proyecto (para comercios que prefieren hablar con una persona). */
const CONTACT_WA = "5492212010898";

const VERTICAL_OFFERS = [
  {
    id: "gastro",
    title: "Gastronomía",
    desc: "Rotiserías, hamburgueserías, cafeterías y más.",
    icon: "🍔",
    benefits: [
      "Carta digital con QR para tus mesas",
      "Pedidos online con carrito y opciones",
      "Comanda digital para tu cocina",
      "Impresión automática de tickets",
    ],
  },
  {
    id: "comercio",
    title: "Comercio de Barrio",
    desc: "Kioscos, fiambrerías, ferreterías, bazar.",
    icon: "🛍️",
    benefits: [
      "Catálogo online para tus vecinos",
      "Venta presencial con Mostrador y Caja",
      "Gestión de stock y clientes",
      "Impresión de comprobantes",
    ],
  },
  {
    id: "moda",
    title: "Moda y Accesorios",
    desc: "Indumentaria, calzado, joyería y diseño.",
    icon: "👗",
    benefits: [
      "Variantes de Color y Talle",
      "Sistema de Apartados y Señas",
      "Catálogo visual y organizado",
      "Mostrador para ventas en local",
    ],
  },
  {
    id: "servicio",
    title: "Oficios y Servicios",
    desc: "Plomeros, electricistas, manicuras, etc.",
    icon: "🛠️",
    benefits: [
      "Solicitudes de presupuestos online",
      "Agenda de turnos coordinada",
      "Cobro de señas por Mercado Pago",
      "Destacado en el buscador de servicios",
    ],
  },
] as const;

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Creás tu cuenta",
    desc: "Elegís tu rubro y cargás tus datos. En dos minutos ya tenés tu vidriera online.",
  },
  {
    step: "2",
    title: "Cargás tu catálogo",
    desc: "Subís tus productos, precios y fotos. Podés usar un Excel para cargar todo rápido.",
  },
  {
    step: "3",
    title: "Compartís tu QR",
    desc: "Lo pegás en tu local o lo mandás por WhatsApp. Tus vecinos te encuentran y te piden directo.",
  },
] as const;

const BENEFITS = [
  {
    icon: "💬",
    title: "Contacto Directo",
    desc: "Recibís los pedidos y consultas directo en tu WhatsApp. Sin comisiones, sin intermediarios.",
  },
  {
    icon: "📱",
    title: "Tu Vidriera en el Barrio",
    desc: "Aparecés en el celular de tus vecinos junto a otros comercios de tu zona. Más visibilidad, más ventas.",
  },
  {
    icon: "🛒",
    title: "Autogestión del Cliente",
    desc: "El cliente arma su pedido, elige talle o variante, y vos lo recibís listo para preparar o entregar.",
  },
  {
    icon: "🧾",
    title: "Herramientas de Gestión",
    desc: "Mostrador, Caja, CRM de clientes e Impresoras térmicas para profesionalizar tu negocio.",
  },
  {
    icon: "📊",
    title: "Estadísticas y Reseñas",
    desc: "Sabés qué es lo que más se vende y qué opinan tus clientes para seguir mejorando.",
  },
  {
    icon: "💸",
    title: "Pagos Online",
    desc: "Cobrá señas o pedidos completos vía Mercado Pago. La plata cae directo en tu cuenta.",
  },
] as const;

const FAQS = [
  {
    q: "¿Cuánto cuesta?",
    a: "Empezar es gratis: tu comercio con carta, QR y pedidos por WhatsApp. Si después querés más herramientas (cocina, impresora, estadísticas, pedidos online ilimitados), hay planes de pago a precio de barrio. Siempre 0% de comisión por venta.",
  },
  {
    q: "¿Tengo que instalar algo?",
    a: "No. Todo anda desde el navegador (celu o compu). Tus clientes tampoco necesitan instalar nada: la carta y el pedido funcionan en la web, y si quieren se llevan la app.",
  },
  {
    q: "¿Cómo cobro?",
    a: "Como cobrás siempre: efectivo, transferencia o Mercado Pago. Si conectás tu propia cuenta de Mercado Pago, el pago online cae directo en tu cuenta, sin pasar por nosotros.",
  },
  {
    q: "¿Puedo pausar pedidos o la venta online?",
    a: "Sí, con un solo toque en tu panel: apagás la venta y la carta queda visible como vidriera (cada producto pasa a 'Consultar por WhatsApp'). Nada se despublica.",
  },
  {
    q: "Ya uso WhatsApp, ¿para qué la app?",
    a: "Porque con Portal 659 el pedido llega armado (detalle, cantidades, opciones y dirección), tu carta queda publicada y actualizada siempre, y tenés QR, comanda y estadísticas. Tu WhatsApp sigue siendo el mismo.",
  },
] as const;

export default async function ComerciosLanding() {
  const zone = await getZone();
  const siteUrl = getSiteUrl();

  const [plans, vendorsRaw] = await Promise.all([
    queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`),
    queryMany<Vendor>(
      `SELECT * FROM vendors WHERE visible = true AND neighborhood = ANY($1) ORDER BY featured DESC NULLS LAST, created_at DESC LIMIT 6`,
      [zone.neighborhoods]
    ),
  ]);

  const plansList = plans || [];
  const vendors = vendorsRaw || [];

  const { default: QRCode } = await import("qrcode");
  const registerUrl = `${siteUrl}/register?from=comercios`;
  const qrRegister = await QRCode.toDataURL(registerUrl, { width: 640, margin: 1 });

  return (
    <main className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(163,230,53,0.18),transparent_50%)]" />
        <div className="relative z-10 container mx-auto px-4 py-14 sm:py-20 text-center max-w-3xl">
          <p className="text-xs font-semibold tracking-widest uppercase text-sun mb-3">
            Para comercios · {zone.name}
          </p>
           <h1 className="font-display text-3xl sm:text-5xl font-semibold text-white leading-tight">
             ¿Tenés un comercio en el barrio?
             <span className="block text-sun">Llevalo al celular de tus vecinos.</span>
           </h1>
           <p className="mt-4 text-sm sm:text-base text-white/85 max-w-xl mx-auto">
             Portal 659 es el centro comercial de {zone.name}. Tu catálogo
             con QR, pedidos por app, WhatsApp y herramientas de gestión. 0% de comisión por venta.
           </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/register"
              className="rounded-full bg-sun text-ink px-8 py-3 text-sm font-bold hover:bg-sun/90 transition-all hover:scale-105 active:scale-95 shadow-lg"
            >
              Crear mi comercio gratis
            </Link>
            <a
              href="#como-funciona"
              className="rounded-full border border-white/40 bg-white/10 text-white px-8 py-3 text-sm font-medium hover:bg-white/20 transition-colors"
            >
              Cómo funciona ↓
            </a>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] text-white/80">
            <span className="rounded-full bg-white/10 px-3 py-1">0% comisión por venta</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Sin instalar nada</span>
            <span className="rounded-full bg-white/10 px-3 py-1">En 10 minutos estás online</span>
          </div>
        </div>
      </section>

       {/* Rubros */}
       <section className="container mx-auto px-4 py-12 max-w-5xl">
         <h2 className="font-display text-2xl sm:text-3xl font-semibold text-center mb-8">
           Una solución para cada rubro
         </h2>
         <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
           {VERTICAL_OFFERS.map((v) => (
             <div key={v.id} className="rounded-2xl border border-border bg-card p-5 flex flex-col">
               <div className="text-3xl mb-2">{v.icon}</div>
               <h3 className="font-display font-semibold text-lg">{v.title}</h3>
               <p className="text-xs text-muted-foreground mb-4">{v.desc}</p>
               <ul className="space-y-2 flex-1">
                 {v.benefits.map((b, i) => (
                   <li key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                     <span className="text-primary font-bold flex-shrink-0">✓</span>
                     {b}
                   </li>
                 ))}
               </ul>
             </div>
           ))}
         </div>
       </section>

       {/* Cómo funciona */}
      <section id="como-funciona" className="container mx-auto px-4 py-12 max-w-4xl scroll-mt-20">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-center mb-8">
          Cómo funciona
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.step} className="rounded-2xl border border-border bg-card p-5 text-center">
              <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center text-lg">
                {s.step}
              </div>
              <h3 className="font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Beneficios */}
      <section className="container mx-auto px-4 py-10 max-w-4xl">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-center mb-8">
          Todo lo que te llevás
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {BENEFITS.map((b) => (
            <div key={b.title} className="rounded-2xl border border-border bg-card p-5">
              <span className="text-2xl">{b.icon}</span>
              <h3 className="font-semibold mt-2">{b.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{b.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Planes */}
      <section className="container mx-auto px-4 py-10 max-w-4xl">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-center mb-2">
          Planes para crecer
        </h2>
        <p className="text-center text-sm text-muted-foreground mb-8 max-w-xl mx-auto">
          Empezás gratis y podés subir de plan cuando quieras. Los cobros siempre van a tu cuenta.
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          {plansList.map((plan) => {
            const promo = activePromo(plan);
            const features = Object.entries(plan.features as Record<string, any>)
              .filter(([_, v]) => v === true)
              .slice(0, 5)
              .map(([k]) => FEATURE_LABELS[k] || k);
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-3xl border bg-card p-8 ${
                  plan.popular ? "border-primary shadow-xl shadow-primary/10" : "border-border"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1">
                      MÁS ELEGIDO
                    </span>
                )}
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className="font-display text-xl font-bold">{plan.name}</h3>
                  {plan.price_monthly === 0 && <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">Gratis</span>}
                </div>
                <p className="text-sm text-muted-foreground mb-6">{plan.description}</p>
                <div className="mb-6">
                  {promo ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-3xl font-bold">{formatPrice(promo.price)}</span>
                      <span className="text-sm text-muted-foreground line-through">
                        {formatPrice(promo.listPrice)}
                      </span>
                      <span className="rounded-full bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5">
                        -{promo.offPct}%
                      </span>
                    </div>
                  ) : (
                    <span className="font-display text-3xl font-bold">
                      {plan.price_monthly === 0 ? "Gratis" : formatPrice(plan.price_monthly)}
                    </span>
                  )}
                  {plan.slug !== "gratuito" && (
                    <span className="block text-xs text-muted-foreground">por mes</span>
                  )}
                </div>
                <ul className="space-y-3 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="h-4 w-4 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-center mt-5">
          <Link href="/planes" className="text-sm font-medium text-primary hover:underline">
            Ver todos los detalles y el comparativo →
          </Link>
        </p>
      </section>

      {/* Prueba social */}
      {vendors.length >= 3 && (
        <section className="container mx-auto px-4 py-10 max-w-4xl">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-center mb-8">
            Ya están adentro
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {vendors.map((v) => (
              <Link
                key={v.id}
                href={`/tienda/${v.slug}`}
                className="rounded-2xl border border-border bg-card p-4 flex flex-col items-center text-center hover:border-primary transition-colors"
              >
                <ProductImage
                  src={v.logo_url || v.image_url}
                  name={v.store_name}
                  vertical={v.vertical}
                  alt={v.store_name}
                  className="h-14 w-14 rounded-full"
                />
                <p className="mt-2 text-xs font-medium truncate w-full">{v.store_name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="container mx-auto px-4 py-10 max-w-2xl">
        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-center mb-8">
          Preguntas frecuentes
        </h2>
        <div className="space-y-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="rounded-xl border border-border bg-card px-4 py-3 open:bg-muted/40"
            >
              <summary className="cursor-pointer font-medium text-sm list-none flex items-center justify-between gap-2">
                {f.q}
                <span className="text-muted-foreground flex-shrink-0">⌄</span>
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="container mx-auto px-4 py-12">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/80 p-8 sm:p-12 text-center max-w-3xl mx-auto">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(163,230,53,0.2),transparent_50%)]" />
          <div className="relative z-10">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white">
              Empezá gratis hoy
            </h2>
            <p className="mt-2 text-sm text-white/85 max-w-md mx-auto">
              Escaneá el código o apretá el botón. Tu comercio online en minutos.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrRegister}
              alt="QR para crear tu comercio en Portal 659"
              className="mx-auto mt-5 w-36 h-36 rounded-xl bg-white p-1.5"
            />
            <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/register"
                className="rounded-full bg-sun text-ink px-8 py-3 text-sm font-bold hover:bg-sun/90 transition-all hover:scale-105 active:scale-95 shadow-lg"
              >
                Crear mi comercio gratis
              </Link>
              <a
                href={`https://wa.me/${CONTACT_WA}?text=${encodeURIComponent(
                  "Hola! Quiero sumar mi comercio a Portal 659 y tengo unas preguntas."
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/40 bg-white/10 text-white px-8 py-3 text-sm font-medium hover:bg-white/20 transition-colors"
              >
                💬 Hablar con Portal 659
              </a>
            </div>
            <p className="mt-4 text-[11px] text-white/60">
              ¿Preferís mirar primero? Entrá a <Link href="/" className="underline">portal659.com.ar</Link> y mirá los comercios del barrio.
            </p>
          </div>
        </div>
      </section>

      <footer className="container mx-auto px-4 pb-10 max-w-4xl text-center text-xs text-muted-foreground space-x-4">
        <Link href="/" className="hover:underline">Volver al inicio</Link>
        <Link href="/privacidad" className="hover:underline">Privacidad</Link>
        <Link href="/planes" className="hover:underline">Planes</Link>
      </footer>
    </main>
  );
}
