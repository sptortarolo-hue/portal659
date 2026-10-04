import { Logo } from "@/components/brand/logo";
import { Captura } from "../captura";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Comercio de barrio | Portal 659",
  description:
    "Manual detallado de comercio de barrio: catálogo y vidriera, pedidos con empaque, mostrador con balanza, caja y reparto por franjas.",
};

export default function ComercioPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Comercio de barrio 🏪</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Detallado para almacenes, verdulerías, carnicerías, kioscos, librerías, ferreterías y todo
        lo que se vende cerca. Antes leé el{" "}
        <a className="text-primary font-medium" href="/manuales/basico">manual básico</a>.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Tu panel</h2>
          <p className="mb-3">
            Tu panel muestra el resumen del día y las pestañas{" "}
            <span className="font-medium">Pedidos</span>,{" "}
            <span className="font-medium">Mostrador</span> y{" "}
            <span className="font-medium">Más</span> (Catálogo, Caja, Clientes, Configuración y
            más). A diferencia de gastronomía, acá no hay Comanda ni Mesas: lo tuyo es empaque y
            entrega, no cocina.
          </p>
          <Captura base="comercio-alta-dashboard" alt="Panel del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Catálogo y vidriera</h2>
          <p className="mb-3">
            En <span className="font-medium">Más → Catálogo</span> cargás tus productos con foto,
            precio y stock. Podés importarlos desde Excel, traerlos por WhatsApp e imprimir{" "}
            <span className="font-medium">etiquetas</span> con precio para la góndola. Si querés
            vista de vidriera (grilla de fotos), activala en tu configuración.
          </p>
          <Captura base="comercio-catalogo" alt="Catálogo del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Pedidos: empaque y entrega</h2>
          <p className="mb-3">
            El pedido online sigue este recorrido:{" "}
            <span className="font-medium">Nuevo → Empaquetando → Listo → Enviado → Entregado</span>.
            En Empaquetando podés tildar producto por producto para no olvidarte nada, y avisarle
            al cliente por WhatsApp en cada paso.
          </p>
          <Captura base="comercio-recepcion-pedidos" alt="Pedidos del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Mostrador con balanza</h2>
          <p className="mb-3">
            Buscá por nombre o <span className="font-medium">código de barras</span>. Los productos
            marcados <span className="font-medium">“Por peso”</span> te piden los kilos (a mano o
            directo desde la <span className="font-medium">balanza</span> conectada) y para lo
            suelto tenés la línea de <span className="font-medium">monto manual</span>. También
            podés guardar el teléfono del cliente para sumarlo a tu agenda.
          </p>
          <Captura base="comercio-mostrador-grid" alt="Mostrador del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Caja y turnos</h2>
          <p className="mb-3">
            En <span className="font-medium">Más → Caja</span> abrís el turno con el fondo inicial,
            registrás ingresos y retiros, hacés el <span className="font-medium">arqueo</span> y
            cerrás el día (cierre Z). Si querés, exigí caja abierta para poder cobrar desde el
            Mostrador.
          </p>
          <Captura base="comercio-caja" alt="Caja del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Configuración propia</h2>
          <p className="mb-3">
            Además de lo básico (perfil, ubicación, pagos), definí tus{" "}
            <span className="font-medium">horarios de reparto</span> y el tiempo de preparación del
            pedido. Si un día no repartís, pausá el reparto: los pedidos siguen entrando con el
            próximo turno disponible.
          </p>
          <Captura base="comercio-alta-config-perfil" alt="Perfil del comercio" />
          <Captura base="comercio-alta-config-ubicacion" alt="Ubicación y horarios" />
          <Captura base="comercio-alta-config-pagos" alt="Pagos y entrega" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Tu vidriera online</h2>
          <p className="mb-3">
            Tu micrositio muestra el catálogo con buscador y carrito. Compartí el link o el QR y
            los vecinos te compran directo, sin comisiones.
          </p>
          <Captura base="comercio-alta-micrositio" alt="Micrositio del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">8. Impresora y alertas</h2>
          <p className="mb-3">
            Imprimí tickets de venta y etiquetas desde{" "}
            <span className="font-medium">Configuración → Impresora</span>, y activá las alertas en
            tu celu para no perderte ningún pedido.
          </p>
          <Captura base="comercio-impresora-config" alt="Impresora del comercio" />
          <Captura base="comercio-alertas-config" alt="Alertas del comercio" />
        </div>

        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            ¿También vendés comida elaborada? Mirá el manual de{" "}
            <a className="text-primary font-medium" href="/manuales/gastronomia">Gastronomía</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
