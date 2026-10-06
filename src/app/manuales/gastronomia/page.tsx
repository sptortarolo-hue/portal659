import { Logo } from "@/components/brand/logo";
import { Captura } from "../captura";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gastronomía | Portal 659",
  description:
    "Manual detallado de gastronomía: pedidos online y delivery, comanda de cocina, mesas, mostrador, menú y reparto.",
};

export default function GastronomiaPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Gastronomía 🍽️</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Detallado para rotiserías, pizzerías, empanadas y comida casera. Antes leé el{" "}
        <a className="text-primary font-medium" href="/manuales/basico">manual básico</a>.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Pedidos online y delivery</h2>
          <p className="mb-3">
            Los pedidos que entran por tu micrositio o por WhatsApp aparecen en{" "}
            <span className="font-medium">Pedidos</span> con su estado. El recorrido normal es:{" "}
            <span className="font-medium">Nuevo → Preparando → Listo → Enviado → Entregado</span>.
            Tocá cada pedido para ver el detalle (cliente, dirección, pago) y avanzarlo. En cada
            paso el cliente recibe el aviso por WhatsApp con el seguimiento.
          </p>
          <Captura base="recepcion-pedidos" alt="Panel de pedidos" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Comanda de cocina (KDS)</h2>
          <p className="mb-3">
            La pestaña <span className="font-medium">Comanda</span> es la pantalla de tu cocina:
            muestra solo lo que hay que elaborar. Cada producto tiene el interruptor{" "}
            <span className="font-medium">“Requiere elaboración”</span>: las bebidas y lo que sale
            directo no pasan por cocina. Tildá los platos a medida que salen y usá el modo de
            pantalla completa en el celu de la cocina.
          </p>
          <Captura base="recepcion-comanda" alt="Comanda de cocina" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Mostrador</h2>
          <p className="mb-3">
            Para la venta en el local: buscás el producto (o por código de barras), lo agregás y
            elegís <span className="font-medium">venta directa</span> (cobra y listo),{" "}
            <span className="font-medium">retiro</span> o{" "}
            <span className="font-medium">delivery</span>. Lo que requiere cocina manda comanda
            automáticamente; lo demás sale directo al cobrar.
          </p>
          <Captura base="mostrador-grid" alt="Mostrador" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Mesas</h2>
          <p className="mb-3">
            Armá el plano de tu salón y abrí cada mesa para ir cargando consumiciones. Cuando el
            cliente pide la cuenta, generás la <span className="font-medium">precuenta</span>,
            cobrás por el medio que elija y la mesa se libera sola.
          </p>
          <Captura base="mesas-grid" alt="Plano de mesas" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Menú, Preparación y Costo e Inventario</h2>
          <p className="mb-3">
            La carta se carga en <span className="font-medium">Más → Menú</span> (platos, opciones,
            precios por volumen y promos: mirá{" "}
            <a className="text-primary font-medium" href="/manuales/catalogo">Catálogo y menú</a>).
            En <span className="font-medium">Preparación y Costo</span> cargás insumos con su merma
            y armás la preparación de cada plato para conocer su costo real y food-cost, con
            semáforo configurable (detalle en{" "}
            <a className="text-primary font-medium" href="/manuales/preparacion-costos">el manual</a>).
            El stock, las compras y la reposición viven en{" "}
            <a className="text-primary font-medium" href="/manuales/inventario">Inventario</a>.
          </p>
          <Captura base="costos-preparacion" alt="Preparación y Costo" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Tiempos, reparto y repartidor</h2>
          <p>
            En <span className="font-medium">Configuración</span> definí tu{" "}
            <span className="font-medium">tiempo de preparación</span> (lo que ve el cliente al
            pedir), tus <span className="font-medium">repartidores</span> y si aceptás retiro,
            domicilio o ambos. Cómo dar de alta a tu repartidor, la app y el punto vivo están en{" "}
            <a className="text-primary font-medium" href="/manuales/reparto">Repartidor y entregas</a>.
            Con el interruptor del encabezado podés pausar la venta online
            (Abierto/Cerrado) sin tocar los horarios.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Impresora en cocina y caja</h2>
          <p className="mb-3">
            Con la <span className="font-medium">impresión automática</span> activada, cada pedido
            aceptado imprime su comanda solo. Si algo falla, desde el pedido podés reimprimir o
            usar el ticket por pantalla.
          </p>
          <Captura base="impresora-config" alt="Configuración de impresora" />
        </div>

        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            ¿Vendés productos además de comida (almacén, verdulería)? Mirá también el manual de{" "}
            <a className="text-primary font-medium" href="/manuales/comercio">Comercio de barrio</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
