import { Logo } from "@/components/brand/logo";
import { Captura } from "../captura";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Repartidor y entregas | Portal 659",
  description:
    "Manual detallado: alta del repartidor por el comercio, descarga del APK, permisos, uso (tomar, entregar, punto vivo) y seguimiento.",
};

export default function RepartoPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Repartidor y entregas 🛵</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        El circuito completo: el comercio da de alta a su repartidor, él instala la app, toma los
        pedidos y comparte su ubicación en vivo. Primero lo básico en el{" "}
        <a className="text-primary font-medium" href="/manuales/basico">manual básico</a>.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. El comercio da de alta al repartidor</h2>
          <p className="mb-3">
            En <span className="font-medium">Configuración → Repartidores</span> agregás a cada
            repartidor con nombre y teléfono. El sistema genera un{" "}
            <span className="font-medium">código único</span> que le pasás por WhatsApp con el link
            de vinculación. Si cambia el celu o se va, regenerás el código o lo revocás.
          </p>
          <Captura base="reparto-equipo" alt="Repartidores del comercio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Vincularse y entrar</h2>
          <p className="mb-3">
            El repartidor abre el link, ve de qué comercio viene, elige su contraseña y entra. Si ya
            tiene cuenta, entra directo con teléfono y contraseña. Puede trabajar para varios
            comercios con el mismo teléfono.
          </p>
          <Captura base="reparto-vincular" alt="Vincular repartidor" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Descargar la app (Android)</h2>
          <p className="mb-3">
            Desde su tablero, el repartidor descarga <span className="font-medium">Portal Reparto</span>{" "}
            (APK para Android, permitiendo instalar de origen desconocido). La app sigue compartiendo
            ubicación con la pantalla apagada; en iPhone se usa la versión web y se comparte por
            WhatsApp.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Permisos: ubicación y batería</h2>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground mb-3">
            <li><span className="font-medium">Ubicación “Permitir siempre”</span>: sin esto el punto vivo no sale con la pantalla apagada.</li>
            <li><span className="font-medium">Batería sin restricciones</span>: si no, el celu mata la app y se pierde la señal (la app lo pide sola la primera vez).</li>
            <li><span className="font-medium">Notificaciones</span>: para avisos de pedidos y la pill de “en vivo”.</li>
          </ul>
          <p className="text-muted-foreground">
            Sin permiso, la app muestra la guía con Reintentar en vez de fallar en silencio.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Trabajar: tomar y entregar</h2>
          <p className="mb-3">
            En <span className="font-medium">Disponibles</span> están los pedidos listos sin dueño:{" "}
            <span className="font-medium">Tomar pedido</span> (si otro lo toma primero, avisa). En{" "}
            <span className="font-medium">Mis entregas</span> están los tuyos, con WhatsApp del
            cliente y Mapa para llegar. Al entregar, <span className="font-medium">Entregado</span>;
            si no podés, lo <span className="font-medium">liberás</span> y vuelve al pool.
          </p>
          <Captura base="reparto-tablero" alt="Tablero del repartidor" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. El punto vivo va solo</h2>
          <p className="mb-3">
            No hay botón para compartir: cuando el local despacha el pedido (<span className="font-medium">En camino</span>),
            la ubicación se comparte sola cada ~15 segundos y <span className="font-medium">se apaga sola</span> al
            entregar. Si te quedás sin señal, el comercio recibe un aviso para reactivarla.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Qué ve el comercio</h2>
          <p className="mb-3">
            Desde el detalle del pedido el comercio <span className="font-medium">asigna o suelta</span> repartidor
            (o espera a que lo tomen del pool) y ve el <span className="font-medium">mapa en vivo</span> con la
            antigüedad del punto. En el Kanban, cada pedido muestra su pill 🛵.
          </p>
          <Captura base="reparto-pedido" alt="Seguimiento del reparto" />
        </div>

        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            Volvé a <a className="text-primary font-medium" href="/manuales/gastronomia">Gastronomía</a> o{" "}
            <a className="text-primary font-medium" href="/manuales/comercio">Comercio de barrio</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
