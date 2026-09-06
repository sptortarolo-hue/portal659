import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = {
  title: "Manuales | Portal 659",
  description: "Guías paso a paso para comercios gastronómicos de Portal 659.",
};

export default function ManualesPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Manuales del comercio</h1>
      </div>
      <p className="text-muted-foreground mb-4">
        Guías completas para darte de alta y gestionar tus pedidos en Portal 659.
      </p>
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm mb-8">
        <strong>Solo gastronomía</strong> — Estos manuales están pensados para comercios de comida. Próximamente sumamos guías para otras verticales.
      </div>

      <div className="space-y-4">
        <Link
          href="/manuales/alta-comercio"
          className="block p-6 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-start gap-4">
            <span className="text-3xl">🏪</span>
            <div>
              <h2 className="font-semibold text-lg mb-1">Alta del comercio</h2>
              <p className="text-sm text-muted-foreground">
                Registro, configuración, menú, compartir tu QR y micrositio.
              </p>
              <span className="text-primary text-sm font-medium mt-2 inline-block">
                Ver manual →
              </span>
            </div>
          </div>
        </Link>

        <Link
          href="/manuales/recepcion-pedidos"
          className="block p-6 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-start gap-4">
            <span className="text-3xl">📦</span>
            <div>
              <h2 className="font-semibold text-lg mb-1">Recepción de pedidos y delivery</h2>
              <p className="text-sm text-muted-foreground">
                Flujo completo: pedidos, preparación, envío, mostrador, mesas y comanda.
              </p>
              <span className="text-primary text-sm font-medium mt-2 inline-block">
                Ver manual →
              </span>
            </div>
          </div>
        </Link>

        <Link
          href="/manuales/impresora"
          className="block p-6 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-start gap-4">
            <span className="text-3xl">🖨️</span>
            <div>
              <h2 className="font-semibold text-lg mb-1">Impresora térmica</h2>
              <p className="text-sm text-muted-foreground">
                Configuración e instalación de impresora: app Android, agente PC y servidor TCP.
              </p>
              <span className="text-primary text-sm font-medium mt-2 inline-block">
                Ver manual →
              </span>
            </div>
          </div>
        </Link>

        <Link
          href="/manuales/mostrador"
          className="block p-6 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-start gap-4">
            <span className="text-3xl">🛒</span>
            <div>
              <h2 className="font-semibold text-lg mb-1">Pedidos por mostrador</h2>
              <p className="text-sm text-muted-foreground">
                Punto de venta presencial: carrito, cobro, comanda, comprobante y conversiones.
              </p>
              <span className="text-primary text-sm font-medium mt-2 inline-block">
                Ver manual →
              </span>
            </div>
          </div>
        </Link>

        <Link
          href="/manuales/mesas"
          className="block p-6 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-start gap-4">
            <span className="text-3xl">🪑</span>
            <div>
              <h2 className="font-semibold text-lg mb-1">Mesas</h2>
              <p className="text-sm text-muted-foreground">
                Gestión de mesas, consumiciones, precuentas y cobro.
              </p>
              <span className="text-primary text-sm font-medium mt-2 inline-block">
                Ver manual →
              </span>
            </div>
          </div>
        </Link>
      </div>
    </main>
  );
}
