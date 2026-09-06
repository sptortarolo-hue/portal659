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
          <h2 className="font-display text-lg font-semibold mb-3">1. ¿Cómo llegan los pedidos?</h2>
          <p>
            Los clientes te escriben por <span className="font-medium">WhatsApp</span> haciendo su pedido. Vos lo registrás en el panel de control y lo gestionás paso a paso. También podés recibir pedidos directamente desde el <span className="font-medium">carrito online</span> si tu plan lo permite (plan Gestión o superior).
          </p>
        </div>

        {/* 2 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Tu panel de pedidos</h2>
          <p className="mb-3">
            Entrá a tu dashboard en <span className="font-medium">portal659.com.ar/vendor/dashboard</span>.
          </p>
          <img src="/manuales/capturas/21-pedidos-nuevo.png" alt="Dashboard Pedidos" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <p className="mb-2">En la parte superior ves el resumen:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Filtro</th>
                  <th className="text-left px-3 py-2 font-medium">Qué muestra</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-2">Nuevos</td><td className="px-3 py-2">Pedidos recién llegados</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">Preparando</td><td className="px-3 py-2">Pedidos en cocina</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">Listos</td><td className="px-3 py-2">Listos para enviar o retirar</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">Enviados</td><td className="px-3 py-2">En camino (delivery)</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">Entregados</td><td className="px-3 py-2">Finalizados</td></tr>
              </tbody>
            </table>
          </div>
          <img src="/manuales/capturas/05-pedidos-todos.png" alt="Filtro Todos" className="rounded-xl border border-border shadow-sm w-full max-w-sm mt-4" />
        </div>

        {/* 3 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Flujo de un pedido de delivery</h2>

          <h3 className="font-semibold mb-2">3.1 Pedido nuevo</h3>
          <p className="mb-3">
            Cuando un cliente hace un pedido, aparece como <span className="font-medium">&quot;Nuevo&quot;</span>. Tocá el pedido para ver los detalles.
          </p>
          <img src="/manuales/capturas/06-order-delivery-new.png" alt="Pedido nuevo delivery" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-semibold mb-2">3.2 Aceptá el pedido</h3>
          <p className="mb-3">
            Tocá <span className="font-medium">&quot;Aceptar y empezar a preparar&quot;</span>. El pedido pasa a estado &quot;Preparando&quot;.
          </p>
          <img src="/manuales/capturas/22-pedido-accion.png" alt="Acción de aceptar" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-semibold mb-2">3.3 Preparando</h3>
          <p className="mb-3">
            Mientras cocinás, el pedido aparece en la pestaña &quot;Preparando&quot;.
          </p>
          <img src="/manuales/capturas/08-order-preparing.png" alt="Pedido en preparación" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-semibold mb-2">3.4 Listo para enviar</h3>
          <p className="mb-3">
            Cuando terminás, tocá <span className="font-medium">&quot;Listo para envío&quot;</span>. El pedido pasa a estado &quot;Listo&quot;.
          </p>
          <img src="/manuales/capturas/09-order-ready.png" alt="Pedido listo" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-semibold mb-2">3.5 Enviá el pedido</h3>
          <p className="mb-3">
            Avisale al cliente que sale el envío. Tocá <span className="font-medium">&quot;Avisar por WhatsApp&quot;</span> para enviarle el mensaje con el link de seguimiento.
          </p>

          <h3 className="font-semibold mb-2">3.6 Pedido enviado</h3>
          <p className="mb-3">
            El pedido pasa a &quot;Enviado&quot; y el cliente recibe una notificación.
          </p>
          <img src="/manuales/capturas/10-order-sent.png" alt="Pedido enviado" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-semibold mb-2">3.7 Completado</h3>
          <p>
            Cuando el cliente recibe el pedido, tocá <span className="font-medium">&quot;Marcar como entregado&quot;</span>. El pedido pasa a &quot;Completado&quot;.
          </p>
        </div>

        {/* 4 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Flujo de retiro en local</h2>
          <p className="mb-2">El flujo es igual pero <span className="font-medium">sin el paso de envío</span>:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li><span className="font-medium">Nuevo</span> → Aceptás.</li>
            <li><span className="font-medium">Preparando</span> → Cocinás.</li>
            <li><span className="font-medium">Listo para retiro</span> → Avisás al cliente por WhatsApp.</li>
            <li>El cliente retira y tocás &quot;Marcar como completado&quot;.</li>
          </ol>
        </div>

        {/* 5 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Pedido con transferencia pendiente</h2>
          <p className="mb-3">
            Si el cliente paga por <span className="font-medium">transferencia bancaria</span>, el pedido aparece con el aviso &quot;Pago pendiente&quot;.
          </p>
          <img src="/manuales/capturas/07-order-transfer-pending.png" alt="Pago pendiente" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <p>
            Hasta que no marques el pago como recibido, el pedido <span className="font-medium">no puede avanzar</span> (si tenés activada la opción &quot;Bloquear hasta confirmar pago&quot;). Para desbloquear, abrí el pedido y tocá &quot;Marcar como pagado&quot;.
          </p>
        </div>

        {/* 6 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Pedidos en mostrador (venta presencial)</h2>
          <p className="mb-3">
            Si vendés en el mostrador, el pedido aparece con el método <span className="font-medium">&quot;Mostrador&quot;</span>. No tienen dirección ni delivery. Se cobran en el momento y se marcan como completados al entregar.
          </p>
          <img src="/manuales/capturas/23-pedido-mostrador.png" alt="Pedido de mostrador" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 7 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Pedidos de mesa</h2>
          <p className="mb-3">
            Si tu local tiene mesas, los pedidos aparecen con el método <span className="font-medium">&quot;Mesa&quot;</span> y el número de mesa. Los pedidos se acumulan en la cuenta hasta que el cliente quiera cerrar.
          </p>
          <img src="/manuales/capturas/24-pedido-mesa.png" alt="Pedido de mesa" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 8 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">8. Comanda (KDS)</h2>
          <p className="mb-3">
            La pestaña <span className="font-medium">&quot;Comanda&quot;</span> muestra los pedidos que necesitan preparación, organizados por tipo de plato. Es tu pantalla de cocina.
          </p>
          <img src="/manuales/capturas/25-comanda-kds.png" alt="Comanda KDS" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 9 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">9. Mostrador (POS)</h2>
          <p className="mb-3">
            La pestaña <span className="font-medium">&quot;Mostrador&quot;</span> es tu punto de venta para ventas presenciales. Desde ahí podés registrar ventas rápidas, cobrar en el momento y imprimir la precuenta.
          </p>
          <img src="/manuales/capturas/26-mostrador-pos.png" alt="Mostrador POS" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
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
                  <th className="text-left px-3 py-2 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Nuevo</td><td className="px-3 py-2">Recién llegado</td><td className="px-3 py-2">Aceptar o rechazar</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Preparando</td><td className="px-3 py-2">En cocina</td><td className="px-3 py-2">Preparar</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Listo</td><td className="px-3 py-2">Empaquetado</td><td className="px-3 py-2">Avisar al cliente</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Enviado</td><td className="px-3 py-2">En camino</td><td className="px-3 py-2">Esperar confirmación</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">Completado</td><td className="px-3 py-2">Entregado</td><td className="px-3 py-2">¡Listo!</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Tips */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Tips</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><span className="font-medium">Respondé rápido</span>: los clientes valoran la velocidad.</li>
            <li><span className="font-medium">Actualizá el estado</span>: el cliente recibe notificaciones.</li>
            <li><span className="font-medium">Usá la comanda</span>: te ayuda a organizar varios pedidos.</li>
            <li><span className="font-medium">Revisá los pagos</span>: no despachés sin confirmar el pago.</li>
            <li><span className="font-medium">Stock</span>: si activás control de stock, los platos se agotan automáticamente.</li>
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
