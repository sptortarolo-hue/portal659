import type { Metadata } from "next";
import {
  Package,
  ShoppingBag,
  DollarSign,
  UtensilsCrossed,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  SearchInput,
  Badge,
  Chip,
  KpiCard,
  SectionHeader,
  Stepper,
  EmptyState,
  PanelUiSwitch,
} from "@/components/panel-ui";

export const metadata: Metadata = {
  title: "Diseño del panel — galería | Portal 659",
  robots: { index: false, follow: false },
};

/**
 * Galería del diseño nuevo del panel (Tasty Station UI). Es una página de
 * desarrollo: aprueba el look de los componentes antes de tocar pantallas
 * reales. En producción muestra solo este aviso (el diseño se prueba en
 * local con `npm run dev`).
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <div className="container mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-lg font-semibold">Galería solo en desarrollo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este preview se corre con <code>npm run dev</code> (localhost:3001). En
          producción el diseño del panel se prueba con el interruptor de la
          barra lateral, que solo prende en tu navegadora.
        </p>
      </div>
    );
  }

  return (
    <div className="ts-ui min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <SectionHeader
          title="Tasty Station UI — kit del panel"
          hint="Componentes y tokens del rediseño. Se prenden solos en el panel nuevo o con el interruptor."
          action={<PanelUiSwitch />}
        />

        {/* Layout del spec: nav | trabajo | panel derecho */}
        <Card variant="flat" className="mt-6 overflow-hidden p-0">
          <div className="flex h-64">
            <div className="ts-sidebar hidden sm:flex sm:flex-col">
              <p className="ts-caption px-4 py-3 uppercase tracking-wider text-muted-foreground">
                Sidebar 240
              </p>
              {["Hoy", "Pedidos", "Mostrador", "Caja"].map((t, i) => (
                <span
                  key={t}
                  className={`mx-2 rounded-md px-3 py-2 text-sm font-medium ${
                    i === 0 ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="flex-1 bg-background p-4">
              <p className="ts-caption uppercase tracking-wider text-muted-foreground">
                Área de trabajo
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { n: "Sandwich de miga", p: "$4.500" },
                  { n: "Empanadas x6", p: "$6.000" },
                  { n: "Café", p: "$1.800" },
                ].map((it) => (
                  <Card key={it.n} variant="interactive" className="text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl">
                      🥪
                    </div>
                    <p className="ts-body-strong mt-2">{it.n}</p>
                    <p className="ts-body text-muted-foreground">{it.p}</p>
                    <div className="mt-2 flex justify-center">
                      <Stepper value={1} onChange={() => {}} min={1} max={9} />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
            <div className="ts-panel-right hidden lg:block">
              <p className="ts-caption px-4 py-3 uppercase tracking-wider text-muted-foreground">
                Cuenta
              </p>
              <div className="space-y-2 px-4">
                <div className="flex justify-between text-sm">
                  <span>Sandwich de miga</span>
                  <span className="tabular-nums">$4.500</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Café</span>
                  <span className="tabular-nums">$1.800</span>
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="ts-body-strong">Total</span>
                    <span className="ts-title tabular-nums">$6.300</span>
                  </div>
                  <Button className="mt-3 w-full" size="sm">
                    Cobrar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Botones */}
        <h3 className="ts-subtitle mt-10">Botones</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button>Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="destructive" size="sm">
            Rechazar
          </Button>
          <Button size="icon" aria-label="Sumar">
            +
          </Button>
          <Button asChild size="sm">
            <a href="/vendor/dashboard">Ver el panel</a>
          </Button>
        </div>

        {/* Inputs */}
        <h3 className="ts-subtitle mt-10">Buscador e inputs</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SearchInput placeholder="Buscar producto…" />
          <Input placeholder="Nombre del cliente" />
          <Input icon={<span>📱</span>} placeholder="WhatsApp" />
        </div>

        {/* Badges y chips */}
        <h3 className="ts-subtitle mt-10">Estados y categorías</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="success">Pagado</Badge>
          <Badge tone="warning">Pendiente</Badge>
          <Badge tone="danger">Rechazado</Badge>
          <Badge tone="info">Enviado</Badge>
          <Badge>Nuevo</Badge>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip active>Bebidas</Chip>
          <Chip>Comidas</Chip>
          <Chip>Postres</Chip>
        </div>

        {/* KPIs */}
        <h3 className="ts-subtitle mt-10">KPIs</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Ventas de hoy" value="$184.500" sub="32 pedidos" icon={DollarSign} accent="success" />
          <KpiCard label="Pedidos" value="32" sub="8 sin aceptar" icon={Package} accent="info" />
          <KpiCard label="Productos" value="46" sub="3 pausados" icon={UtensilsCrossed} />
          <KpiCard label="Ticket prom." value="$5.765" icon={ShoppingBag} accent="warning" />
        </div>

        {/* Tarjetas */}
        <h3 className="ts-subtitle mt-10">Tarjetas</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Tarjeta simple</CardTitle>
              <Badge tone="neutral">12px</Badge>
            </CardHeader>
            <CardContent className="mt-1">
              Radio 12, borde slate, sombra corta. Es la tarjeta base del panel.
            </CardContent>
          </Card>
          <Card variant="interactive">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="ts-body-strong">Tarjeta activa</p>
                <p className="ts-body text-muted-foreground">Al pasar el puntero se pone teal.</p>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Con acción</CardTitle>
            </CardHeader>
            <CardContent className="mt-1">
              <Button size="sm" variant="secondary">
                <ClipboardList className="h-4 w-4" /> Ver más
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Vacío */}
        <h3 className="ts-subtitle mt-10">Estado vacío</h3>
        <Card className="mt-3">
          <EmptyState
            icon={Package}
            title="Todavía no hay pedidos"
            hint="Cuando entre un pedido aparece acá con su detalle y acciones."
            action={<Button size="sm">Actualizar</Button>}
          />
        </Card>

        <h3 className="ts-subtitle mt-10">Lenguaje del panel</h3>
        <Card className="mt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="ts-caption text-muted-foreground">Bordes y formas</p>
              <p className="ts-body mt-1">
                Bordes <strong>negros de 1px</strong> y todo redondeado: base{" "}
                <code>1rem</code> (botones e inputs 12-14px, tarjetas 16px,
                tarjetas activas y chips 20px).
              </p>
            </div>
            <div>
              <p className="ts-caption text-muted-foreground">Sombras</p>
              <p className="ts-body mt-1">
                Suaves y difusas, sin desplazamiento: un halo al 5% más una
                sombra corta. Más grande en la barra superior y en flotantes.
              </p>
            </div>
            <div>
              <p className="ts-caption text-muted-foreground">Color</p>
              <p className="ts-body mt-1">
                Fondo <strong>verde suave</strong>, tarjetas blancas, azul para
                las acciones, <strong>ámbar</strong> para el ítem activo del
                menú, <strong>lima</strong> para chips activos y secundarios.
              </p>
            </div>
            <div>
              <p className="ts-caption text-muted-foreground">Tipografía</p>
              <p className="ts-body mt-1">
                DM Sans para el texto y Space Mono para los números
                (precios, totales, códigos).
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button size="sm">Botón de acción</Button>
            <Chip active>Chip activo</Chip>
            <Chip>Chip normal</Chip>
            <Badge tone="success">Con borde</Badge>
            <span className="ts-body text-muted-foreground">
              Las tarjetas activas se elevan 2px al pasar el mouse.
            </span>
          </div>
        </Card>

        <p className="ts-caption mt-10 text-muted-foreground">
          Tokens y utilidades: <code>src/app/styles/tasty-station.css</code> · Kit:{" "}
          <code>src/components/panel-ui/*</code> · Switch:{" "}
          <code>portal659-panel-ui</code> (cookie) o <code>?ui=tasty</code>.
        </p>
      </div>
    </div>
  );
}
