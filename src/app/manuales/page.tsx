import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = {
  title: "Manuales | Portal 659",
  description:
    "Guías paso a paso para usar Portal 659: manual básico transversal a todas las verticales y manuales específicos de gastronomía y comercio de barrio.",
};

function Card({
  href,
  emoji,
  title,
  desc,
  disabled,
}: {
  href: string;
  emoji: string;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  const inner = (
    <div className="flex items-start gap-4">
      <span className="text-3xl">{emoji}</span>
      <div>
        <h2 className="font-semibold text-lg mb-1">{title}</h2>
        <p className="text-sm text-muted-foreground">{desc}</p>
        <span className="text-primary text-sm font-medium mt-2 inline-block">
          {disabled ? "Próximamente" : "Ver manual →"}
        </span>
      </div>
    </div>
  );
  const cls =
    "block p-6 rounded-2xl border border-border bg-card transition-all " +
    (disabled
      ? "opacity-60 cursor-not-allowed"
      : "hover:border-primary/40 hover:shadow-sm");
  return disabled ? (
    <div className={cls}>{inner}</div>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

export default function ManualesPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Manuales del comercio</h1>
      </div>
      <p className="text-muted-foreground mb-8">
        Empezá por el <strong>manual básico</strong>, que sirve para todas las
        verticales. Después consultá el manual específico de tu rubro para los
        detalles propios de tu forma de vender.
      </p>

      <h2 className="font-display text-lg font-semibold mb-3">Para todos</h2>
      <div className="space-y-4 mb-10">
        <Card
          href="/manuales/basico"
          emoji="📘"
          title="Uso básico (todas las verticales)"
          desc="Cuenta, panel, configuración, micrositio y QR, recibir pedidos y cobrar. Lo común a gastronomía, comercio, servicios, moda y estética."
        />
        <Card
          href="/manuales/catalogo"
          emoji="📦"
          title="Catálogo y menú"
          desc="Cargar platos y productos, opciones, variantes color por talle, precios por volumen y promos."
        />
        <Card
          href="/manuales/inventario"
          emoji="📒"
          title="Inventario y stock"
          desc="Proveedores, compras, conteos físicos, kardex y reposición sugerida."
        />
        <Card
          href="/manuales/preparacion-costos"
          emoji="🧪"
          title="Preparación y Costo"
          desc="Insumos con merma, costo por plato, food-cost con semáforo y ficha PDF. Gastronomía."
        />
      </div>

      <h2 className="font-display text-lg font-semibold mb-3">Por vertical</h2>
      <div className="space-y-4">
        <Card
          href="/manuales/gastronomia"
          emoji="🍽️"
          title="Gastronomía (detallado)"
          desc="Pedidos online y delivery, comanda de cocina, mesas, mostrador, menú y reparto."
        />
        <Card
          href="/manuales/comercio"
          emoji="🏪"
          title="Comercio de barrio (detallado)"
          desc="Catálogo y vidriera, pedidos con empaque, mostrador con balanza, caja y reparto por franjas."
        />
        <Card
          href="/manuales/servicio"
          emoji="🔧"
          title="Servicios y oficios"
          desc="Presupuestos, turnos, seña y cobros."
          disabled
        />
        <Card
          href="/manuales/moda"
          emoji="👗"
          title="Ropa y accesorios"
          desc="Catálogo por talles y colores, apartado con seña y envíos."
          disabled
        />
        <Card
          href="/manuales/estetica"
          emoji="💅"
          title="Estética y belleza"
          desc="Turnera por profesional, servicios, packs de sesiones y fichas."
          disabled
        />
      </div>
    </main>
  );
}
