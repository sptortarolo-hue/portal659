import Link from "next/link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sumá tu logística a Portal 659 Envíos — repartí para los comercios de tu barrio",
  description:
    "Registrá tu logística (moto, auto o camioneta) y recibí los envíos extendidos de los comercios del barrio. Vos definís tu tarifa por zona, el local te paga al retirar el paquete y Portal 659 no se lleva comisión.",
  keywords: ["logística barrio", "reparto entregas", "trabajar de repartidor", "mensajería", "envíos extendidos", "logística partner", "La Plata"],
  alternates: { canonical: "/logisticas" },
};

const HOW_IT_WORKS = [
  { step: "1", title: "Te registrás", desc: "Contás si sos individual o tenés una flota, tu zona de cobertura y tu vehículo. Tarda dos minutos." },
  { step: "2", title: "Te activamos y cargás tus tarifas", desc: "Revisamos tu solicitud, te activamos la cuenta y definís cuánto le cobrás al local por cada zona en la que trabajás." },
  { step: "3", title: "Te avisamos cuando hay paquete", desc: "Cuando un comercio de tu zona tiene un envío extendido, te llega el aviso por WhatsApp con los datos del local y del destinatario." },
  { step: "4", title: "Colectás, cobrás y entregás", desc: "Retirás en el local y te paga ahí mismo. Después repartís y cerrás la entrega con quien recibió. Desde el panel o con el QR de la etiqueta." },
] as const;

const BENEFITS = [
  { icon: "💵", title: "Definís tu tarifa", desc: "Vos ponés cuánto cobrás por zona desde tu panel. El local te paga al retirar el paquete: efectivo, transferencia o tarjeta." },
  { icon: "🧾", title: "Queda todo documentado", desc: "Cada cobro queda registrado con monto, método y quién pagó. Si un local te debe, la deuda queda anotada y visible en la liquidación." },
  { icon: "🗺️", title: "Panel por etapas", desc: "Tablero con Por colectar, En la camioneta, En camino y Reintentar. Mapa, WhatsApp al comprador y navegación en un toque." },
  { icon: "📱", title: "Sin app que instalar", desc: "Funciona en el navegador del celular. Tu repartidor puede entregar escaneando el QR de la etiqueta, que no requiere cuenta." },
  { icon: "🔔", title: "Te avisamos por WhatsApp", desc: "Cada encargo nuevo te llega con los links de mapa para llegar al local y a la dirección de entrega." },
  { icon: "🤝", title: "0% de comisión", desc: "Portal 659 no se queda con nada de tu tarifa. Lo acordado con el local es tuyo, punto." },
] as const;

const REQUIREMENTS = [
  "Vehículo propio (moto, auto, camioneta o bicicleta) en condiciones",
  "Zona de cobertura definida (barrios, ciudades)",
  "WhatsApp activo para recibir los avisos de encargos",
  "Ganas de trabajar con comercios del barrio",
];

const FAQS = [
  { q: "¿Cuánto gano por envío?", a: "Lo que definas. Vos cargás tu tarifa por zona en tu panel y el local la ve antes de ofrecerle el envío a su comprador. Portal 659 no cobra comisión." },
  { q: "¿Cuándo me paga el comercio?", a: "Al retirar el paquete. En ese momento registrás el cobro desde el panel: efectivo (con cálculo de vuelto), transferencia o tarjeta. Si el local paga en otro momento, queda como deuda documentada." },
  { q: "¿Tengo que instalar una app?", a: "No. El panel funciona en el navegador de tu celular o de la compu. Para repartir alcanza con escanear el QR de la etiqueta del paquete, que no requiere cuenta." },
  { q: "¿Puedo tener repartidores a mi cargo?", a: "Sí. Vos sos el operador dueño: colectás, cobrás y administrás los encargos. Quien entregue puede usar el QR sin iniciar sesión." },
  { q: "¿Qué necesito para empezar?", a: "Registrarte y esperar la activación del equipo. Después cargás tus zonas y tarifas y empezás a recibir avisos." },
] as const;

export default function LogisticasLandingPage() {
  return (
    <main className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-10 lg:py-16 max-w-5xl">
        <div className="text-center space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sun/40 bg-sun/10 px-3 py-1 text-xs font-semibold text-ink">
            🚚 Portal 659 Envíos · Logísticas partner
          </span>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight">
            Repartí para los comercios
            <br />
            de tu barrio
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            Los comercios de Portal 659 venden a su barrio y a zonas cercanas.
            Vos te encargás de los envíos que salen del local:{" "}
            <b>definís tu tarifa, el local te paga al retirar y Portal 659 no se lleva comisión</b>.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href="/registro-logistica">
              <Button size="lg" className="h-11">Registrar mi logística</Button>
            </Link>
            <Link href="/login?next=/envios">
              <Button size="lg" variant="outline" className="h-11">Ya tengo cuenta · Entrar al panel</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-10 max-w-5xl">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-center">Cómo funciona</h2>
        <p className="text-center text-sm text-muted-foreground mt-2">
          Cuatro pasos, sin instalar nada y sin contratos a largo plazo.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.step} className="rounded-2xl border border-border bg-card p-4 space-y-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {s.step}
              </span>
              <p className="font-bold text-sm">{s.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container mx-auto px-4 py-10 max-w-5xl">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-center">Por qué trabajar con Portal 659</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
          {BENEFITS.map((b) => (
            <div key={b.title} className="rounded-2xl border border-border bg-card p-4 space-y-2">
              <span className="text-2xl">{b.icon}</span>
              <p className="font-bold text-sm">{b.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container mx-auto px-4 py-10 max-w-5xl">
        <div className="rounded-2xl border border-border bg-muted/40 p-5 sm:p-6 grid sm:grid-cols-2 gap-5 items-center">
          <div>
            <h2 className="font-display text-xl font-bold">¿Qué necesito para sumarme?</h2>
            <ul className="mt-3 space-y-1.5">
              {REQUIREMENTS.map((r) => (
                <li key={r} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-emerald-600">✓</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-center sm:text-right space-y-2">
            <p className="text-sm text-muted-foreground">
              Revisamos cada solicitud a mano: queremos logísticas que realmente respondan.
            </p>
            <Link href="/registro-logistica">
              <Button size="lg" className="h-11">Quiero registrarme</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-10 max-w-3xl">
        <h2 className="font-display text-2xl sm:text-3xl font-bold text-center">Preguntas frecuentes</h2>
        <div className="mt-6 space-y-2">
          {FAQS.map((f) => (
            <details key={f.q} className="rounded-xl border border-border bg-card px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold">{f.q}</summary>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="rounded-3xl bg-gradient-to-br from-primary to-violet-700 px-6 py-10 text-center text-white space-y-4">
          <h2 className="font-display text-2xl sm:text-3xl font-bold">
            Sumá tu logística y empezá a recibir envíos
          </h2>
          <p className="text-sm sm:text-base text-white/85 max-w-xl mx-auto">
            Registro gratis y en dos minutos. Te activamos la cuenta y cargás tus tarifas.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/registro-logistica">
              <Button size="lg" variant="secondary" className="h-11">Registrar mi logística</Button>
            </Link>
            <Link href="/login?next=/envios">
              <Button size="lg" variant="outline" className="h-11 border-white/40 text-white hover:bg-white/10">
                Entrar al panel
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-10 max-w-5xl">
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
          <Link href="/comercios" className="hover:text-foreground">Sumá tu comercio</Link>
          <Link href="/manuales" className="hover:text-foreground">Manuales</Link>
          <Link href="/" className="hover:text-foreground">Ir a Portal 659</Link>
        </div>
      </section>
    </main>
  );
}
