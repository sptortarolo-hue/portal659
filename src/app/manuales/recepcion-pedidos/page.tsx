import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recepción de pedidos y delivery | Portal 659",
  description: "Guía completa para recibir, gestionar y despachar pedidos gastronómicos en Portal 659.",
};

export default function RecepcionPedidosPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Recepción de pedidos y delivery</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Guía completa para recibir, gestionar y despachar pedidos gastronómicos en Portal 659.
      </p>
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm mb-8">
        <strong>Solo gastronomía</strong> — Próximamente sumamos guías para otras verticales.
      </div>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">

        {/* 1 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. El panel de pedidos</h2>
          <p className="mb-3">
            La pestaña <span className="font-medium">Pedidos</span> (barra inferior del dashboard) es tu vista principal. Arriba tenés:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li><span className="font-medium">Resumen</span>: cinco tarjetas con la cantidad de pedidos por estado (Nuevos, Preparando, Listos, Enviados, Entregados).</li>
            <li><span className="font-medium">Buscador</span>: buscá por nombre, teléfono o <span className="font-medium">#ID</span> del pedido.</li>
            <li><span className="font-medium">Chips de estado</span>: filtran por estado (solo aparecen los que tienen pedidos, con su contador). El chip <span className="font-medium">Todos</span> siempre está activo.</li>
          </ul>
          <img src="/manuales/capturas/05-pedidos-todos.png" alt="Panel de pedidos" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />
          <p className="mb-2">Cada tarjeta de pedido muestra:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Canal + número</span> (ej: Mostrador Nro. 3, Mesa 1 · Nro. 5).</li>
            <li><span className="font-medium">Estado</span> (badge de color).</li>
            <li><span className="font-medium">Total</span> y tiempo transcurrido (ej: 14 min).</li>
            <li><span className="font-medium">Ítem resumido</span> (ej: 1x Milanesa Napolitana con fritas).</li>
            <li>Botón <span className="font-medium">Ver detalle →</span> para abrir la ficha del pedido.</li>
          </ul>
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <strong>Tip:</strong> el banner verde de arriba (<span className="font-medium">Gestión integral activo</span>) te lleva a la suscripción. El indicador de la impresora (🔴) te avisa si la comanda se va a imprimir sola.
          </p>
        </div>

        {/* 2 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Estados de un pedido</h2>
          <p className="mb-3">Cada pedido recorre un ciclo de estados. El ciclo cambia según el vertical:</p>
          <div className="bg-muted/50 rounded-xl p-5 mb-4">
            <h3 className="font-semibold mb-2">Gastronomía (app, carrito, mostrador, mesa)</h3>
            <p className="mb-2"><span className="font-medium">Nuevo</span> → <span className="font-medium">En preparación</span> → <span className="font-medium">Listo</span> → <span className="font-medium">Enviado</span> → <span className="font-medium">Entregado</span></p>
            <p className="text-xs text-muted-foreground">En gastronomía el primer paso es directo: al abrir un pedido Nuevo, <span className="font-medium">&quot;Aceptar y empezar a preparar&quot;</span> lo pasa a En preparación (sin paso intermedio de aceptación).</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-4 py-3 text-sm mb-4">
            <strong>Moda (indumentaria):</strong> el ciclo tiene un paso extra de aceptación explícita. Nuevo (<span className="font-medium">Por aceptar</span>) → <span className="font-medium">Aceptado</span> → <span className="font-medium">Empaquetando</span> → <span className="font-medium">Listo</span> → <span className="font-medium">En camino</span> → <span className="font-medium">Entregado</span>.
          </div>
          <p className="mb-3"><span className="font-medium">Cancelado</span> está disponible desde cualquier estado anterior; un pedido cancelado no avanza más.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Desde</th>
                  <th className="text-left px-3 py-2 font-medium">Podés ir a</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Nuevo</td><td className="px-3 py-2">En preparación / Aceptado / Cancelado</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Confirmado / Aceptado</td><td className="px-3 py-2">En preparación / Cancelado</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">En preparación</td><td className="px-3 py-2">Listo / Cancelado</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Listo</td><td className="px-3 py-2">Enviado / Entregado / Cancelado</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Enviado</td><td className="px-3 py-2">Entregado / Cancelado</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Entregado / Cancelado</td><td className="px-3 py-2">— (final)</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 3 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Crear un pedido</h2>
          <p className="mb-3">Un pedido nace cuando un cliente te escribe por <span className="font-medium">WhatsApp</span>, hace un pedido en el <span className="font-medium">carrito online</span> (si tu plan lo permite), lo tomás en <span className="font-medium">Mostrador</span> o cargás consumiciones en una <span className="font-medium">Mesa</span>. En todos los casos aparece como <span className="font-medium">Nuevo</span> (o <span className="font-medium">Por aceptar</span> en moda) en el panel.</p>
          <p>No importa el origen: la gestión es siempre la misma — desde esta pestaña.</p>
        </div>

        {/* 4 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Abrir un pedido (ficha)</h2>
          <p className="mb-3">Tocá <span className="font-medium">Ver detalle</span> en cualquier tarjeta. La ficha muestra:</p>
          <img src="/manuales/capturas/22-pedido-accion.png" alt="Ficha del pedido" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Stepper de estados</span>: el progreso visual del pedido (Nuevo → En preparación → Listo → Enviado → Entregado).</li>
            <li><span className="font-medium">Productos</span>: cantidad, nombre (con modificadores) y precio.</li>
            <li><span className="font-medium">Método de pago</span> (ej: Efectivo) y fecha/hora del pedido.</li>
            <li><span className="font-medium">Total</span>.</li>
            <li><span className="font-medium">Acciones</span>: los botones cambian según el estado (ver sección 5).</li>
          </ul>
        </div>

        {/* 5 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Aceptar, preparar y entregar</h2>

          <h3 className="font-semibold mb-2">5.1 Pedido Nuevo (primer paso)</h3>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li><span className="font-medium">Gastronomía</span>: <span className="font-medium">&quot;Aceptar y empezar a preparar&quot;</span> → pasa a En preparación.</li>
            <li><span className="font-medium">Moda</span>: <span className="font-medium">&quot;✓ Aceptar pedido&quot;</span> → pasa a Aceptado; o <span className="font-medium">&quot;Rechazar pedido&quot;</span> (con motivo) para descartarlo.</li>
          </ul>

          <h3 className="font-semibold mb-2">5.2 En preparación</h3>
          <p className="mb-3">Mientras cocinás. El pedido aparece en la pestaña <span className="font-medium">Comanda</span> (solo los que necesitan cocina — ver sección 7). En KDS los botones son <span className="font-medium">&quot;Aceptar&quot;</span>, <span className="font-medium">&quot;Preparar&quot;</span> o <span className="font-medium">&quot;✅ Listo...&quot;</span> según el estado.</p>

          <h3 className="font-semibold mb-2">5.3 Listo</h3>
          <p className="mb-3">Cuando está empaquetado:
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="font-medium">Retiro:</span> <span className="font-medium">&quot;Listo mostrador&quot;</span> / &quot;Listo p/ retiro&quot; y luego <span className="font-medium">&quot;Marcar como entregado&quot;</span> cuando el cliente lo retira.</li>
              <li><span className="font-medium">Delivery:</span> <span className="font-medium">&quot;Listo para envío&quot;</span> → avisa al cliente → <span className="font-medium">&quot;Marcar como enviado&quot;</span> (a veces con impresión de comprobante).</li>
            </ul>
          </p>

          <h3 className="font-semibold mb-2">5.4 Enviado → Entregado</h3>
          <p className="mb-3">Cuando el cliente recibe el pedido, <span className="font-medium">&quot;Marcar como entregado&quot;</span> lo pasa a <span className="font-medium">Entregado</span> y se envía la notificación final por WhatsApp.</p>

          <h3 className="font-semibold mb-2">5.5 Cancelar / Rechazar</h3>
          <p>Podés cancelar un pedido desde cualquier estado antes de Entregado. En moda, si está Por aceptar/Aceptado, el botón es <span className="font-medium">&quot;Rechazar pedido&quot;</span> (permite dejar un motivo); en los demás estados es <span className="font-medium">&quot;Cancelar pedido&quot;</span>.</p>
        </div>

        {/* 6 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Flujo cocina y sin cocina</h2>
          <p className="mb-3">Cada producto tiene un switch <span className="font-medium">&quot;Requiere elaboración&quot;</span> en el editor del menú (por defecto activado). Dependiendo de eso:</p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li><span className="font-medium">Con cocina</span>: el pedido entra en la pestaña <span className="font-medium">Comanda</span> (KDS), se imprime comanda y avanza a En preparación cuando lo aceptás.</li>
            <li><span className="font-medium">Sin cocina</span> (solo bebidas/packs): <strong>no</strong> aparece en la Comanda, <strong>no</strong> imprime comanda y el badge de Comanda no lo cuenta.</li>
          </ul>
          <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-4 py-3 text-sm mb-3">
            <strong>Mostrador/mesa sin cocina:</strong> el pedido pasa directo de <span className="font-medium">Nuevo</span> a <span className="font-medium">Listo</span> (saltándose En preparación) y se completa al instante. Es el flujo rápido de bares y rotiserías.
          </div>
          <p className="text-xs text-muted-foreground">Si tomás un plato que SÍ necesita cocina en Mostrador, el pedido queda <span className="font-medium">En preparación</span> (no se completa al instante).</p>
          <img src="/manuales/capturas/25-comanda-kds.png" alt="Comanda KDS" className="rounded-xl border border-border shadow-sm w-full max-w-sm mt-3" />
        </div>

        {/* 7 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. WhatsApp del pedido</h2>
          <p className="mb-3">Desde la ficha del pedido hay botones de WhatsApp contextuales (se abren con el mensaje listo para enviar):</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">📨 Avisar recibido</span> — cuando llegó como Nuevo.</li>
            <li><span className="font-medium">✅ Avisar confirmado</span> — cuando lo aceptaste/empaquetaste (app/carrito).</li>
            <li><span className="font-medium">🛵 Avisar retiro</span> / <span className="font-medium">🛵 Avisar envío</span> — cuando está Listo.</li>
            <li><span className="font-medium">🚚 Avisar envío</span> / <span className="font-medium">✅ Avisar entrega</span> — Enviado / Entregado.</li>
            <li><span className="font-medium">💸 Datos de pago (WA)</span> — si el cliente pagó por transferencia y está pendiente de confirmar.</li>
          </ul>
          <p className="text-xs text-muted-foreground">Si el cliente no tiene WhatsApp o el pedido es de mesa/mostrador (sin teléfono de cliente), estos botones no aparecen — el contacto es el del comercio.</p>
        </div>

        {/* 8 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">8. Impresión</h2>
          <p className="mb-3">La ficha tiene <span className="font-medium">🖨️ Imprimir comanda</span> (para la cocina). Para configurar la impresora (app Android, agente PC o TCP), ver el <Link href="/manuales/impresora" className="text-primary hover:underline">manual de impresora</Link>.</p>
          <p>Desde la Comanda (KDS) y el Mostrador (POS) también hay botones de impresión por ticket.</p>
        </div>

        {/* Resumen estados */}
        <div className="bg-muted/50 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Resumen de estados</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Estado</th>
                  <th className="text-left px-3 py-2 font-medium">Significado</th>
                  <th className="text-left px-3 py-2 font-medium">Acción típica</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Nuevo</td><td className="px-3 py-2">Recién llegado</td><td className="px-3 py-2">Aceptar y empezar a preparar / Aceptar (moda) / Cancelar</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">En preparación</td><td className="px-3 py-2">En cocina</td><td className="px-3 py-2">Preparar → Listo</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Listo</td><td className="px-3 py-2">Empaquetado</td><td className="px-3 py-2">Avisar al cliente / Enviar</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Enviado</td><td className="px-3 py-2">En camino</td><td className="px-3 py-2">Esperar confirmación</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Entregado</td><td className="px-3 py-2">Finalizado</td><td className="px-3 py-2">—</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Cancelado</td><td className="px-3 py-2">Descartado</td><td className="px-3 py-2">—</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Tips */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Tips</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><span className="font-medium">Respondé rápido</span>: los clientes valoran la velocidad.</li>
            <li><span className="font-medium">Usá la Comanda</span>: te ayuda a organizar varios pedidos de cocina a la vez.</li>
            <li><span className="font-medium">Revisá los pagos</span>: no despachés sin confirmar el pago (especialmente transferencias).</li>
            <li><span className="font-medium">WhatsApp</span>: usá los botones contextuales para avisar al cliente en cada etapa.</li>
            <li><span className="font-medium">Sin cocina</span>: los pedidos de bebidas/packs se completan al instante — no los busques en la Comanda.</li>
            <li><span className="font-medium">Moda</span>: aceptá/rechazá por stock antes de empaquetar.</li>
          </ul>
        </div>

      </section>

      <div className="mt-10 pt-6 border-t border-border">
        <Link href="/manuales/alta-comercio" className="text-primary hover:underline font-medium text-sm">
          ← Alta del comercio
        </Link>
      </div>
    </main>
  );
}
