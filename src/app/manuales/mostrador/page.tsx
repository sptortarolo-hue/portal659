import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pedidos por mostrador | Portal 659",
  description: "Guía completa para usar el punto de venta (POS) en Portal 659.",
};

export default function MostradorPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Pedidos por mostrador</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Guía completa para usar el punto de venta (POS) en Portal 659.
      </p>
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm mb-8">
        <strong>Solo gastronomía</strong> — Próximamente sumamos guías para otras verticales.
      </div>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">

        {/* 1 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Qué es el Mostrador</h2>
          <p className="mb-3">
            El Mostrador es tu <span className="font-medium">punto de venta presencial</span>. Desde ahí podés buscar y agregar productos, cobrar en efectivo, transferencia, tarjeta o mixto, imprimir comanda para la cocina y comprobante de retiro, y registrar envíos a domicilio.
          </p>
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <strong>Requisito:</strong> necesitás el <span className="font-medium">plan Gestión integral</span> para usar el Mostrador.
          </p>
        </div>

        {/* 2 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Cómo acceder</h2>
          <p className="mb-3">
            Entrá a tu dashboard y tocá la pestaña <span className="font-medium">🖥️ Mostrador</span> en la barra inferior.
          </p>
          <img src="/manuales/capturas/40-mostrador-grid.png" alt="Mostrador grid" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 3 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Buscar productos</h2>
          <p className="mb-3">
            En la parte superior tenés un <span className="font-medium">buscador</span> y <span className="font-medium">chips de categoría</span> para filtrar:
          </p>
          <img src="/manuales/capturas/41-mostrador-productos.png" alt="Productos con precios" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Buscador:</span> escribí el nombre del producto.</li>
            <li><span className="font-medium">Chips:</span> tocá una categoría para filtrar.</li>
            <li><span className="font-medium">&quot;Todos&quot;</span>: muestra todos los productos.</li>
          </ul>
        </div>

        {/* 4 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Agregar al carrito</h2>
          <p className="mb-3">Tocá cualquier producto para agregarlo al carrito:</p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li><span className="font-medium">Sin modificadores:</span> se agrega directo con cantidad 1.</li>
            <li><span className="font-medium">Con modificadores:</span> se abre un selector donde elegís las opciones (ej: tamaño, extras). Tocá &quot;Agregar&quot; para confirmar.</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Si el mismo producto ya está en el carrito, la cantidad se incrementa automáticamente.
          </p>
        </div>

        {/* 5 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Modificar cantidades</h2>
          <p className="mb-3">
            En el carrito, cada línea tiene botones <span className="font-medium">−</span> y <span className="font-medium">+</span>:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">+</span> aumenta la cantidad en 1.</li>
            <li><span className="font-medium">−</span> disminuye la cantidad en 1. Si llega a 0, el producto se elimina.</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2">El total se actualiza automáticamente.</p>
        </div>

        {/* 6 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Tipo de pedido</h2>
          <p className="mb-3">Elegí entre dos opciones:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Opción</th>
                  <th className="text-left px-3 py-2 font-medium">Cuándo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-2">🛍️ Para retirar</td><td className="px-3 py-2">El cliente retira en el local (por defecto)</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">🛵 Envío a domicilio</td><td className="px-3 py-2">Enviás a la dirección del cliente (requiere teléfono + dirección)</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 7 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Datos del cliente</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Nombre</span> (opcional): para identificar al cliente.</li>
            <li><span className="font-medium">Teléfono</span> (obligatorio si es envío): para contactarlo.</li>
            <li><span className="font-medium">Dirección</span> (obligatoria si es envío): para el repartidor.</li>
          </ul>
        </div>

        {/* 8 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">8. Método de pago</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Método</th>
                  <th className="text-left px-3 py-2 font-medium">Cuándo usarlo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-2">💵 Efectivo</td><td className="px-3 py-2">Pago en efectivo (por defecto)</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">🏦 Transferencia</td><td className="px-3 py-2">Depósito o transferencia bancaria</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">💳 Tarjeta</td><td className="px-3 py-2">Débito, crédito o QR</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">🪙 Mixto</td><td className="px-3 py-2">Combina métodos</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 9 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">9. Cobrar</h2>
          <p className="mb-3">Tenés dos opciones:</p>
          <img src="/manuales/capturas/45-mostrador-cobrar.png" alt="Cobrar" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">&quot;Cobrar + comprobante de retiro&quot;</span> (retiro) / <span className="font-medium">&quot;Cobrar y despachar&quot;</span> (envío): cobra e imprime un comprobante.</li>
            <li><span className="font-medium">&quot;Cobrar sin comprobante&quot;</span>: cobra sin imprimir nada.</li>
          </ul>
        </div>

        {/* 10 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">10. Qué pasa después</h2>
          <p className="mb-3">Al tocar &quot;Cobrar&quot;:</p>
          <ol className="list-decimal pl-5 space-y-1 mb-3">
            <li>Se crea el pedido con <span className="font-medium">canal &quot;Mostrador&quot;</span>.</li>
            <li>Si los productos necesitan preparación, se imprime una <span className="font-medium">comanda</span> para la cocina.</li>
            <li>Se imprime el <span className="font-medium">comprobante de retiro</span> (si elegiste esa opción).</li>
            <li>El carrito se vacía y aparece un mensaje de éxito.</li>
          </ol>
          <img src="/manuales/capturas/46-mostrador-exito.png" alt="Éxito" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 11 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">11. Ventas de hoy</h2>
          <p className="mb-3">
            Debajo del carrito, la sección <span className="font-medium">&quot;Ventas de hoy en mostrador&quot;</span> muestra todos los pedidos del día.
          </p>
          <img src="/manuales/capturas/47-mostrador-domicilio.png" alt="Ventas de hoy" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />

          <h3 className="font-semibold mb-2">Convertir a domicilio</h3>
          <p className="mb-3">
            Si un pedido de retiro necesita enviarse, tocá el ícono <span className="font-medium">🛵</span> al lado del pedido:
          </p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Ingresá el <span className="font-medium">teléfono</span> del cliente.</li>
            <li>Ingresá la <span className="font-medium">dirección</span> (opcional).</li>
            <li>Tocá <span className="font-medium">&quot;Confirmar envío&quot;</span>.</li>
          </ol>
        </div>

        {/* 12 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">12. Tips</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Impresión automática:</span> si la activás en Configuración → Impresora, la comanda se imprime solo al cobrar.</li>
            <li><span className="font-medium">Flujo rápido:</span> el Mostrador está diseñado para ventas rápidas. No necesitás salir de la pantalla.</li>
            <li><span className="font-medium">Pedidos sin cocina:</span> si vendés productos sin preparación, el pedido se completa al instante.</li>
            <li><span className="font-medium">Stock:</span> si activás control de stock, los productos se agotan automáticamente.</li>
          </ul>
        </div>

        {/* Nota plan */}
        <div className="bg-muted/50 rounded-xl p-5">
          <p className="text-sm">
            <strong>Recordatorio:</strong> el Mostrador es una feature del <span className="font-medium">plan Gestión integral</span>. Si no ves la pestaña, actualizá tu plan desde la configuración.
          </p>
        </div>

      </section>

      <div className="mt-10 pt-6 border-t border-border flex justify-between">
        <Link href="/manuales/impresora" className="text-primary hover:underline font-medium text-sm">
          ← Impresora térmica
        </Link>
        <Link href="/manuales" className="text-primary hover:underline font-medium text-sm">
          Volver a manuales →
        </Link>
      </div>
    </main>
  );
}
