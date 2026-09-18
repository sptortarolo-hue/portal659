import Link from "next/link";
import { queryMany } from "@/lib/db";
import { getZone } from "@/lib/zone";
import { activePromo, formatPrice } from "@/lib/plans";
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

const FEATURE_LABELS: Record<string, string> = {
  info: "Ficha con tu carta y tus datos",
  cart: "Carrito y pedidos online",
  emits_orders: "Pedidos por la app con avisos",
  mp_payments: "Cobros online con Mercado Pago",
  kds: "Comanda de cocina",
  printer: "Impresión térmica de tickets",
  variants: "Variantes (gustos, talles)",
  modifiers: "Opciones y extras por producto",
  pos: "Mostrador (venta presencial)",
  mesas: "Mesas del salón",
  reviews_manage: "Responder reseñas",
  analytics: "Estadísticas",
};

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Creás tu cuenta",
    desc: "Nombre, WhatsApp, email y contraseña. Dos minutos y ya tenés tu vidriera.",
  },
  {
    step: "2",
    title: "Cargás tu carta",
    desc: "Producto por producto, o todo de una con el Excel. Con foto, precios y opciones.",
  },
  {
    step: "3",
    title: "Compartís tu QR",
    desc: "Lo pegás en la mesa, el vidrio o tu estado de WhatsApp. Los vecinos escanean y te piden directo.",
  },
] as const;

const BENEFITS = [
  {
    icon: "💬",
    title: "Pedidos directo a tu WhatsApp",
    desc: "El cliente pide y a vos te llega al WhatsApp de siempre, con el detalle armado. Sin comisiones, sin intermediarios.",
  },
  {
    icon: "🖨️",
    title: "Carta con QR (lista para imprimir)",
    desc: "Cartel A5/A4 con tu logo y tu QR, listo para la mesa o la vidriera. Quien escanea cae directo en tu carta.",
  },
  {
    icon: "🛒",
    title: "Carrito y pedidos online",
    desc: "El cliente arma su pedido con cantidades y opciones, y vos lo recibís listo para preparar. Sin mensajear de ida y vuelta.",
  },
  {
    icon: "🧾",
    title: "Mostrador, Mesas y Comanda",
    desc: "Con el plan Gestión vendés en el local, manejás las mesas, la cocina ve los pedidos en pantalla y la impresora saca los tickets.",
  },
  {
    icon: "📊",
    title: "Reseñas y estadísticas",
    desc: "Sabés qué se vende, cuánto entró y qué dicen tus clientes (y les podés responder).",
  },
  {
    icon: "🏘️",
    title: "Tu barrio, tu catálogo",
    desc: "Aparecés entre los comercios de tu zona con tu carta y tus horarios. Lo que no vende online, publica igual y recibe consultas.",
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
            <span className="block text-sun">Vendé más, sin comisiones.</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-white/85 max-w-xl mx-auto">
            Portal 659 es el centro comercial de {zone.name} en el celular de tus vecinos. Tu carta
            con QR, pedidos por app o WhatsApp, y 0% de comisión por venta.
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
          Planes
        </h2>
        <p className="text-center text-sm text-muted-foreground mb-8 max-w-xl mx-auto">
          Empezás gratis y podés subir de plan cuando quieras. Los cobros siempre van a tu cuenta.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {plansList.map((plan) => {
            const promo = activePromo(plan);
            const features = Object.keys(FEATURE_LABELS)
              .filter((k) => (plan.features as Record<string, unknown>)[k] === true)
              .slice(0, 5)
              .map((k) => FEATURE_LABELS[k]);
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border bg-card p-5 ${
                  plan.popular ? "border-primary shadow-lg shadow-primary/10" : "border-border"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1">
                    MÁS ELEGIDO
                  </span>
                )}
                <h3 className="font-display font-semibold">{plan.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 min-h-6">{plan.description}</p>
                <div className="mt-3">
                  {promo ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-xl font-bold">{formatPrice(promo.price)}</span>
                      <span className="text-sm text-muted-foreground line-through">
                        {formatPrice(promo.listPrice)}
                      </span>
                      <span className="rounded-full bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5">
                        -{promo.offPct}%
                      </span>
                    </div>
                  ) : (
                    <span className="font-display text-xl font-bold">
                      {plan.price_monthly === 0 ? "Gratis" : formatPrice(plan.price_monthly)}
                    </span>
                  )}
                  {plan.slug !== "gratuito" && (
                    <span className="block text-[11px] text-muted-foreground">por mes</span>
                  )}
                </div>
                <ul className="mt-3 space-y-1.5 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="text-primary font-bold flex-shrink-0">✓</span>
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
