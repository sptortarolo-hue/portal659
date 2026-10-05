import { Logo } from "@/components/brand/logo";
import { Captura } from "../captura";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Uso básico | Portal 659",
  description:
    "Manual básico transversal a todos los rubros: cuenta, panel, configuración, micrositio, pedidos y cobros.",
};

export default function BasicoPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Uso básico</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Sirve para <strong>todos los rubros</strong> (gastronomía, comercio,
        servicios, moda y estética). Los detalles propios de tu rubro están en
        su manual específico.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Qué es Portal 659</h2>
          <p className="mb-3">
            Portal 659 es <span className="font-medium">el centro comercial de tu barrio</span> en
            internet: cada comercio tiene su <span className="font-medium">micrositio</span> con
            catálogo o carta, contacto directo por <span className="font-medium">WhatsApp</span> y{" "}
            <span className="font-medium">0% comisión</span>. Los clientes te encuentran por barrio,
            por rubro o por nombre.
          </p>
          <Captura base="alta-home" alt="Home de Portal 659" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Creá tu cuenta e ingresá</h2>
          <p className="mb-3">
            Registrate gratis con tu email desde la página de registro. Si ya tenés cuenta,
            ingresá con tu email y contraseña.
          </p>
          <Captura base="alta-register" alt="Página de registro" />
          <Captura base="alta-login" alt="Página de ingreso" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Tu panel de control</h2>
          <p className="mb-3">
            Al ingresar ves tu panel con el resumen del día (ventas, pedidos activos, ticket
            promedio) y, abajo, las <span className="font-medium">pestañas según tu rubro y tu plan</span>:
            Pedidos, Mostrador y Más. En gastronomía además aparecen Comanda y Mesas.
          </p>
          <Captura base="alta-dashboard" alt="Panel del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Configurá tu comercio</h2>
          <p className="mb-3">
            Entrá a <span className="font-medium">Más → Configuración</span>. Completá estas tres
            secciones como mínimo:
          </p>
          <h3 className="font-medium mb-2">4.1 Perfil: nombre, rubro, fotos y descripción</h3>
          <Captura base="alta-config-perfil" alt="Perfil del comercio" />
          <h3 className="font-medium mb-2 mt-4">4.2 Ubicación y horarios</h3>
          <p className="mb-3">
            Dirección, punto en el mapa y horarios por día. Lo que cargues acá define cuándo
            figurás como <span className="font-medium">abierto</span>.
          </p>
          <Captura base="alta-config-ubicacion" alt="Ubicación y horarios" />
          <h3 className="font-medium mb-2 mt-4">4.3 Pagos y entrega</h3>
          <p className="mb-3">
            Medios de pago que aceptás, descuento en efectivo, cuenta de Mercado Pago y si
            trabajás con retiro, domicilio o ambos.
          </p>
          <Captura base="alta-config-pagos" alt="Pagos y entrega" />
          <p className="mt-3 text-muted-foreground">
            No te olvides de <span className="font-medium">Guardar cambios</span> al terminar.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Tu micrositio y tu QR</h2>
          <p className="mb-3">
            Tu vidriera en internet vive en <span className="font-medium">portal659.com.ar/tienda/tu-nombre</span>.
            Compartila por WhatsApp o imprimí el QR (botón Compartir de tu panel) y pegalo en la
            vidriera, las mesas o las bolsas.
          </p>
          <Captura base="alta-micrositio" alt="Micrositio del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Recibí ventas</h2>
          <p className="mb-3">
            Según tu rubro, en la pestaña <span className="font-medium">Pedidos</span> vas a ver
            pedidos online, presupuestos o turnos. Tocá cada uno para ver el detalle y avanzarlo
            de estado. El cliente recibe el aviso por WhatsApp en cada paso.
          </p>
          <Captura base="recepcion-pedidos" alt="Panel de pedidos" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Cobrá en el local</h2>
          <p className="mb-3">
            Con el <span className="font-medium">Mostrador</span> cobrás ventas presenciales:
            buscás el producto, lo agregás y cobrás en efectivo, transferencia o tarjeta. La
            pestaña <span className="font-medium">Caja</span> te muestra los cobros del día, el
            arqueo y el cierre (Z).
          </p>
          <Captura base="mostrador-grid" alt="Mostrador" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">8. Impresora de tickets</h2>
          <p className="mb-3">
            En <span className="font-medium">Configuración → Impresora</span> conectás tu impresora
            térmica (con la app del celular o por red) para que tickets y comandas salgan solos.
          </p>
          <Captura base="impresora-config" alt="Configuración de impresora" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">9. Alertas de ventas</h2>
          <p>
            En <span className="font-medium">Configuración → Alertas</span> activás las
            notificaciones en tu celular para enterarte al instante de cada pedido nuevo, aunque
            tengas el panel cerrado.
          </p>
          <Captura base="alertas-config" alt="Configuración de alertas" />
        </div>

        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            ¿Listo lo básico? Seguí con el manual de{" "}
            <a className="text-primary font-medium" href="/manuales/gastronomia">Gastronomía</a>{" "}
            o <a className="text-primary font-medium" href="/manuales/comercio">Comercio de barrio</a>{" "}
            según tu rubro.
          </p>
        </div>
      </section>
    </main>
  );
}
