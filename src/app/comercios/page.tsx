import Link from "next/link";
import { queryMany } from "@/lib/db";
import { getZone } from "@/lib/zone";
import { activePromo, formatPrice } from "@/lib/plans";
import { FEATURE_LABELS } from "@/app/planes/page";
import { getSiteUrl } from "@/lib/site-url";
import { ProductImage } from "@/components/product-image";
import { SectionHeading } from "@/components/home/section-heading";
import {
  ArrowRight,
  BarChart3,
  LayoutGrid,
  MessageCircleQuestion,
  Package,
  Sparkles,
  Store,
  Tag,
  Users,
} from "lucide-react";
import type { Plan, Vendor } from "@/types/database";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sistema de gestión para comercios — todo en un solo lugar | Portal 659",
  description:
    "Portal 659 es un sistema de gestión integral para tu comercio: pedidos online, vidriera con QR, mostrador, caja, clientes, turnos e inventario en un solo lugar. Tus vecinos te encuentran en el barrio y te escriben por WhatsApp. Empezá gratis y 0% de comisión por venta, para siempre.",
  keywords: [
    "sistema de gestión integral para comercios",
    "software para comercio de barrio",
    "sistema para kiosco",
    "POS comercio de barrio",
    "caja y POS para comercio",
    "carta QR",
    "comanda digital",
    "gestión de turnos estética",
    "vender online barrio",
    "Sicardi",
    "Garibaldi",
  ],
  alternates: { canonical: "/comercios" },
};

const VERTICAL_OFFERS = [
  {
    id: "gastro",
    icon: "🍔",
    title: "Gastronomía",
    desc: "Rotiserías, hamburgueserías, cafeterías y más.",
    benefits: [
      "Carta digital con QR para tus mesas",
      "Pedidos online con carrito y opciones",
      "Comanda digital para tu cocina",
      "Facturación electrónica con CAE",
    ],
  },
  {
    id: "comercio",
    icon: "🛍️",
    title: "Comercio de Barrio",
    desc: "Kioscos, fiambrerías, ferreterías, bazar.",
    benefits: [
      "Catálogo online para tus vecinos",
      "Venta presencial con Mostrador y Caja",
      "Stock, clientes y vencimientos",
      "Impresión de comprobantes",
    ],
  },
  {
    id: "moda",
    icon: "👗",
    title: "Moda y Accesorios",
    desc: "Indumentaria, calzado, joyería y diseño.",
    benefits: [
      "Variantes de Color y Talle",
      "Sistema de Apartados y Señas",
      "Catálogo visual y organizado",
      "Mostrador para ventas en local",
    ],
  },
  {
    id: "servicio",
    icon: "🛠️",
    title: "Oficios y Servicios",
    desc: "Plomeros, electricistas y todo servicio a domicilio.",
    benefits: [
      "Solicitudes de presupuestos online",
      "Agenda de turnos coordinada",
      "Cobro de señas por Mercado Pago",
      "Lo cargás en minutos, desde el celu",
    ],
  },
  {
    id: "estetica",
    icon: "💇",
    title: "Peluquería y Estética",
    desc: "Peluquerías, barberías, uñas, pestañas y masajes.",
    benefits: [
      "Turnera por profesional con agenda semanal",
      "Fichas de clientas, packs y giftcards",
      "Consulta online y seña por Mercado Pago",
      "Venta de productos en el mismo lugar",
    ],
  },
  {
    id: "taller",
    icon: "🚲",
    title: "Talleres y Reparaciones",
    desc: "Bicicleterías, servicio técnico, gomerías y reparación de calzado.",
    benefits: [
      "Presupuestos con partidas (materiales + mano de obra)",
      "Orden de servicio y ficha de equipo",
      "Turnera de recepción y retiro",
      "Seña por Mercado Pago y packs de mantenimiento",
    ],
  },
] as const;

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Creás tu cuenta",
    desc: "Elegís tu rubro y cargás tus datos, horarios y medios de pago. Solo y sin instalar nada.",
  },
  {
    step: "2",
    title: "Cargás tu operación",
    desc: "Productos o servicios, precios, fotos, stock e impresora. Podés usar un Excel para cargar todo rápido.",
  },
  {
    step: "3",
    title: "Vendés y gestionás",
    desc: "Compartís tu QR y te escriben por WhatsApp. Desde el panel atendés el mostrador, cobrás y controlás clientes e inventario.",
  },
] as const;

const PILLARS = [
  {
    icon: Store,
    title: "Vendé en el barrio",
    desc: "Tu vidriera pública con QR, pedidos online y WhatsApp directo. Tus vecinos te encuentran sin buscar en diez lugares.",
    points: ["Vidriera y carta con QR", "Pedidos online", "Contacto por WhatsApp"],
  },
  {
    icon: Package,
    title: "Operación diaria",
    desc: "Del pedido al cobro, sin papeles ni mensajes sueltos. Todo queda registrado en el mismo sistema.",
    points: ["Mostrador (POS) y Caja con cierre Z", "Comanda, mesas e impresión", "Reparto y franjas de entrega"],
  },
  {
    icon: Users,
    title: "Clientes y crecimiento",
    desc: "Conocé a quienes te compran y volvé a llegarles. Tu trabajo visible, tus clientes cerca.",
    points: ["Clientes (CRM) y reseñas", "Estadísticas y reportes", "Giftcards y fidelización"],
  },
  {
    icon: BarChart3,
    title: "Back office",
    desc: "Los números y la operación que antes hacías en planillas, ahora adentro del comercio.",
    points: ["Inventario, costos y recetas", "Turnera, estética y taller", "Facturación electrónica con CAE"],
  },
] as const;

const FAQS = [
  {
    q: "¿Cuánto cuesta?",
    a: "Empezar es gratis: tu vidriera con QR y contacto por WhatsApp. Los planes pago suman pedidos ilimitados, mostrador, caja, inventario, turnera y estadísticas. Siempre 0% de comisión por venta.",
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
    q: "¿Sirve para gestionar el local, no solo para vender online?",
    a: "Sí. Ese es justamente el cambio: además de la vidriera y los pedidos, usás el mostrador, la caja con arqueo, la comanda, los clientes, el inventario y la turnera desde el mismo panel, sin usar tres apps distintas.",
  },
  {
    q: "Ya uso WhatsApp, ¿para qué el sistema?",
    a: "Porque el pedido llega armado (detalle, cantidades, opciones y dirección) en vez de una catarata de mensajes, y además tenés un lugar donde cargar productos, cobrar, cerrar la caja y ver qué se vende. Es tu WhatsApp de siempre, pero sin el desorden y con el negocio ordenado atrás.",
  },
  {
    q: "¿Cobran comisión como las apps de delivery?",
    a: "No, nunca. Ni en el plan gratis ni en los pagos: 0% de comisión por venta, para siempre. Solo pagás la herramienta si elegís un plan pago.",
  },
  {
    q: "No entiendo de tecnología, ¿puedo igual?",
    a: "Sí. No instalás nada y todo es guiado paso a paso desde el navegador del celu: crear la cuenta, cargar productos y compartir tu QR te lleva minutos.",
  },
] as const;

export default async function ComerciosLanding() {
  const zone = await getZone();
  const siteUrl = getSiteUrl();

  const [plans, vendorsRaw] = await Promise.all([
    queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`),
    queryMany<Vendor>(
      `SELECT * FROM vendors WHERE visible = true AND neighborhood = ANY($1) ORDER BY featured DESC NULLS LAST, created_at DESC LIMIT 9`,
      [zone.neighborhoods]
    ),
  ]);

  const plansList = plans || [];
  const vendors = vendorsRaw || [];

  const { default: QRCode } = await import("qrcode");
  const registerUrl = `${siteUrl}/register?from=comercios`;
  const qrRegister = await QRCode.toDataURL(registerUrl, { width: 640, margin: 1 });

  return (
    <main className="pv2 min-h-screen">
      {/* Hero */}
      <section className="pv2-hero relative overflow-hidden">
        <div className="container mx-auto px-4 py-14 sm:py-20 text-center max-w-3xl relative">
          <p className="pv2-eyebrow mb-3">Sistema para comercios · {zone.name}</p>
          <h1 className="pv2-title text-3xl sm:text-5xl leading-tight">
            Todo tu comercio en un solo lugar. Y en el barrio.
          </h1>
          <p className="pv2-subtitle mt-5 max-w-2xl mx-auto">
            No es solo una vidriera: pedidos, mostrador, caja, clientes, turnos e inventario conectados. Tus vecinos te encuentran y te escriben por WhatsApp. <strong className="text-[var(--pv2-ink-strong)]">Empezá gratis y 0% de comisión por venta.</strong>
          </p>
          <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/register" className="pv2-btn pv2-btn-primary px-8 py-3 text-sm">
              Crear mi comercio gratis
            </Link>
            <a href="#como-funciona" className="pv2-btn pv2-btn-outline px-8 py-3 text-sm">
              Ver cómo funciona ↓
            </a>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <span className="pv2-chip">Pedidos y vidriera QR</span>
            <span className="pv2-chip">Mostrador y caja</span>
            <span className="pv2-chip">Clientes e inventario</span>
            <span className="pv2-chip pv2-chip-muted">Sin instalar nada</span>
            <span className="pv2-chip pv2-chip-muted">0% comisión</span>
          </div>
        </div>
      </section>

      {/* Rubros */}
      <section className="container mx-auto px-4 py-12 max-w-6xl">
        <SectionHeading
          icon={Store}
          eyebrow="Un sistema para cada rubro"
          title="Una solución para cada rubro"
          description="La misma herramienta se adapta a cómo trabajás, con lo que tu comercio necesita."
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {VERTICAL_OFFERS.map((v) => (
            <div key={v.id} className="pv2-card flex flex-col p-5">
              <span className="pv2-section-icon mb-3">{v.icon}</span>
              <h3 className="pv2-title text-lg">{v.title}</h3>
              <p className="pv2-subtitle text-xs mt-1 mb-4">{v.desc}</p>
              <ul className="space-y-2 flex-1">
                {v.benefits.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-[var(--pv2-muted)]">
                    <span className="text-[var(--pv2-ink)] font-bold flex-shrink-0">✓</span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="container mx-auto px-4 py-12 max-w-5xl scroll-mt-24">
        <SectionHeading
          icon={LayoutGrid}
          eyebrow="En minutos"
          title="Cómo funciona"
          description="De la cuenta abierta a la primera venta, sin instalar nada."
        />
        <div className="grid sm:grid-cols-3 gap-4">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.step} className="pv2-card p-5 text-center">
              <div className="pv2-section-icon mx-auto mb-3">{s.step}</div>
              <h3 className="pv2-title text-base">{s.title}</h3>
              <p className="pv2-subtitle text-sm mt-2">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Los 4 bloques del sistema */}
      <section className="container mx-auto px-4 py-10 max-w-5xl">
        <SectionHeading
          icon={Sparkles}
          eyebrow="Sistema integral"
          title="No es solo una vidriera. Es con lo que trabajás."
          description="Todo conectado, sin parchar tres herramientas distintas."
        />
        <div className="grid sm:grid-cols-2 gap-4">
          {PILLARS.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.title} className="pv2-card p-6">
                <span className="pv2-section-icon mb-3"><Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /></span>
                <h3 className="pv2-title text-lg">{p.title}</h3>
                <p className="pv2-subtitle text-sm mt-2">{p.desc}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {p.points.map((point) => (
                    <span key={point} className="pv2-chip">{point}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Planes */}
      <section className="container mx-auto px-4 py-10 max-w-5xl">
        <SectionHeading
          icon={Tag}
          eyebrow="Precios de barrio"
          title="Planes para crecer"
          description="Empezás gratis y subís de plan cuando quieras. 0% comisión en todos los planes, para siempre: solo pagás la herramienta, nunca un porcentaje de tus ventas."
        />
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          {plansList.map((plan) => {
            const promo = activePromo(plan);
            const features = Object.entries(plan.features as Record<string, any>)
              .filter(([_, v]) => v === true)
              .slice(0, 5)
              .map(([k]) => FEATURE_LABELS[k] || k);
            return (
              <div
                key={plan.id}
                className={`pv2-card flex flex-col p-8 ${plan.popular ? "ring-2 ring-[var(--pv2-accent)]" : ""}`}
              >
                <div className="mb-3 min-h-6">
                  {plan.popular && (
                    <span className="pv2-chip">MÁS ELEGIDO</span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className="pv2-title text-xl">{plan.name}</h3>
                  {plan.price_monthly === 0 && <span className="pv2-chip">Gratis</span>}
                </div>
                <p className="pv2-subtitle text-sm mb-6">{plan.description}</p>
                <div className="mb-6">
                  {promo ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="pv2-price">{formatPrice(promo.price)}</span>
                      <span className="pv2-price-old">{formatPrice(promo.listPrice)}</span>
                      <span className="pv2-chip">-{promo.offPct}%</span>
                    </div>
                  ) : (
                    <span className="pv2-price">
                      {plan.price_monthly === 0 ? "Gratis" : formatPrice(plan.price_monthly)}
                    </span>
                  )}
                  {plan.slug !== "gratuito" && (
                    <span className="pv2-subtitle block text-xs">por mes</span>
                  )}
                </div>
                <ul className="space-y-3 flex-1">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-sm text-[var(--pv2-muted)]">
                      <span className="h-4 w-4 rounded-full text-[var(--pv2-ink-strong)] flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ backgroundColor: "color-mix(in srgb, var(--pv2-accent) 40%, transparent)" }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-center mt-5">
          <Link href="/planes" className="text-sm font-medium text-[var(--pv2-ink)] hover:underline inline-flex items-center gap-1">
            Ver todos los detalles y el comparativo <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </Link>
        </p>
      </section>

      {/* Prueba social */}
      {vendors.length >= 3 && (
        <section className="container mx-auto px-4 py-10 max-w-5xl">
          <SectionHeading
            icon={Users}
            title="Ya están adentro"
            description={`Comercios de ${zone.name} que ya trabajan con Portal 659`}
          />
          <div className="grid grid-cols-3 gap-3">
            {vendors.map((v) => (
              <Link
                key={v.id}
                href={`/tienda/${v.slug}`}
                className="pv2-card p-4 flex flex-col items-center text-center"
              >
                <ProductImage
                  src={v.logo_url || v.image_url}
                  name={v.store_name}
                  vertical={v.vertical}
                  alt={v.store_name}
                  className="pv2-card-logo h-14 w-14"
                />
                <p className="pv2-subtitle mt-2 text-xs font-medium truncate w-full">{v.store_name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="container mx-auto px-4 py-10 max-w-3xl">
        <SectionHeading
          icon={MessageCircleQuestion}
          title="Preguntas frecuentes"
          description="Las dudas más comunes antes de empezar."
        />
        <div className="space-y-3 mt-6">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="pv2-card px-4 py-3 open:bg-[var(--pv2-surface)]"
            >
              <summary className="cursor-pointer pv2-title text-sm list-none flex items-center justify-between gap-2">
                {f.q}
                <span className="text-[var(--pv2-muted)] flex-shrink-0">⌄</span>
              </summary>
              <p className="pv2-subtitle text-sm mt-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="container mx-auto px-4 py-12">
        <div className="pv2-cta relative overflow-hidden p-8 sm:p-12 text-center max-w-3xl mx-auto">
          <div className="relative z-10">
            <p className="pv2-eyebrow mb-3">Empezá hoy</p>
            <h2 className="pv2-title text-2xl sm:text-3xl">Empezá gratis y armá tu sistema</h2>
            <p className="pv2-cta-lead mt-2 text-sm max-w-md mx-auto">
              Cargá tu catálogo, abrí tu vidriera y manejá tu comercio desde el celu. 0% por venta.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrRegister}
              alt="QR para crear tu comercio en Portal 659"
              className="mx-auto mt-5 w-36 h-36 rounded-xl bg-white p-1.5"
            />
            <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/register" className="pv2-btn pv2-btn-primary px-8 py-3 text-sm">
                Crear mi comercio gratis
              </Link>
            </div>
            <p className="mt-4 text-[11px] text-white/60">
              ¿Preferís hablar? Escribinos por WhatsApp al 221 201-0898. O mirá primero los comercios en{" "}
              <Link href="/" className="underline">portal659.com.ar</Link>.
            </p>
          </div>
        </div>
      </section>

      <footer className="container mx-auto px-4 pb-10 max-w-4xl text-center pv2-subtitle text-xs space-x-4">
        <Link href="/" className="hover:underline">Volver al inicio</Link>
        <Link href="/privacidad" className="hover:underline">Privacidad</Link>
        <Link href="/planes" className="hover:underline">Planes</Link>
      </footer>
    </main>
  );
}
