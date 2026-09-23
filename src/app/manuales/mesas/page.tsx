import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mesas | Portal 659",
  description: "Guía completa para gestionar mesas, consumiciones y cuentas en Portal 659.",
};

export default function MesasPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Mesas</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Guía completa para gestionar mesas, consumiciones y cuentas en Portal 659.
      </p>
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm mb-8">
        <strong>Solo gastronomía</strong> — Próximamente sumamos guías para otras verticales.
      </div>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">

        {/* 1 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Qué es Mesas</h2>
          <p>
            Mesas es tu sistema de <span className="font-medium">gestión de mesas y consumiciones</span>. Desde ahí podés:
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
            <li>Abrir mesas y cargar consumiciones en tiempo real</li>
            <li>Generar precuentas para el cliente</li>
            <li>Cobrar y cerrar mesas</li>
            <li>Imprimir comanda para la cocina</li>
          </ul>
          <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-4 py-3 text-sm mt-3">
            <strong>Requisito:</strong> necesitás el <span className="font-medium">plan Gestión integral</span> para usar Mesas.
          </div>
        </div>

        {/* 2 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Cómo acceder</h2>
          <p className="mb-3">
            Entrá a tu dashboard y tocá la pestaña <span className="font-medium">🪑 Mesas</span> en la barra inferior:
          </p>
          <img src="/manuales/capturas/48-mesas-grid.png" alt="Grilla de mesas" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 3 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Grilla de mesas</h2>
          <p className="mb-3">La grilla muestra todas tus mesas con su estado:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Estado</th>
                  <th className="text-left px-3 py-2 font-medium">Significado</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-medium">Libre</td>
                  <td className="px-3 py-2 text-muted-foreground">La mesa está disponible, sin consumiciones pendientes</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-medium">Ocupada</td>
                  <td className="px-3 py-2 text-muted-foreground">La mesa tiene consumiciones cargadas esperando cobro</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            Tocá una mesa <span className="font-medium">libre</span> para abrirla y empezar a cargar consumiciones.
            Tocá una mesa <span className="font-medium">ocupada</span> para ver su cuenta y gestionar el cobro.
          </p>
        </div>

        {/* 4 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Abrir una mesa y cargar productos</h2>

          <h3 className="font-medium mb-2">4.1 Seleccioná la mesa</h3>
          <p className="mb-3">
            Tocá cualquier mesa libre. Se abre el <span className="font-medium">catálogo de productos</span>:
          </p>
          <img src="/manuales/capturas/49-mesas-abierta.png" alt="Catálogo de productos" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-medium mb-2">4.2 Buscá y agregá productos</h3>
          <p className="mb-3">
            En la parte superior tenés un <span className="font-medium">buscador</span> y <span className="font-medium">chips de categoría</span> para filtrar:
          </p>
          <img src="/manuales/capturas/50-mesas-catalogo.png" alt="Productos con precios" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><span className="font-medium">Buscador:</span> escribí el nombre del producto.</li>
            <li><span className="font-medium">Chips:</span> tocá una categoría para filtrar.</li>
            <li><span className="font-medium">"Todos":</span> muestra todos los productos sin filtro.</li>
          </ul>
          <p className="mt-3">Tocá cualquier producto para agregarlo al carrito de la mesa.</p>

          <h3 className="font-medium mb-2 mt-4">4.3 Revisá el carrito</h3>
          <p className="mb-3">
            En la parte inferior aparece una <span className="font-medium">barra resumen</span> con el total de ítems y el monto:
          </p>
          <img src="/manuales/capturas/51-mesas-carrito.png" alt="Barra de carrito" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <p>Tocá la barra para ir a la <span className="font-medium">vista de cuenta</span> y revisar todo lo cargado.</p>
        </div>

        {/* 5 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Vista de cuenta (Detalle de la mesa)</h2>
          <p className="mb-3">La cuenta muestra dos secciones:</p>
          <img src="/manuales/capturas/52-mesas-cuenta.png" alt="Vista de cuenta" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Sección</th>
                  <th className="text-left px-3 py-2 font-medium">Qué muestra</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-medium">Consumiciones de la mesa</td>
                  <td className="px-3 py-2 text-muted-foreground">Ítems ya guardados (confirmados en la base de datos)</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-medium">Por cargar</td>
                  <td className="px-3 py-2 text-muted-foreground">Ítems agregados recientemente que todavía no se guardaron</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3">
            Cada ítem tiene botones <span className="font-medium">−</span> y <span className="font-medium">+</span> para ajustar cantidades.
            El total se actualiza automáticamente.
          </p>
        </div>

        {/* 6 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Guardar consumiciones</h2>
          <p className="mb-3">
            Cuando tengas ítems en "Por cargar", tocá el botón <span className="font-medium">"➕ Cargar a la mesa (N ítems)"</span>:
          </p>
          <img src="/manuales/capturas/52-mesas-cuenta.png" alt="Botón cargar" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <p>
            Los ítems pasan de "Por cargar" a "Consumiciones de la mesa". Esto los guarda en la base de datos
            y los envía a la cocina si tenés impresora configurada.
          </p>
        </div>

        {/* 7 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Generar precuenta</h2>
          <p className="mb-3">
            Para mostrarle al cliente cuánto debe, tocá <span className="font-medium">"🖨️ Precuenta"</span>:
          </p>
          <img src="/manuales/capturas/53-mesas-precuenta.png" alt="Precuenta" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <p className="mb-2">La precuenta muestra:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Todos los ítems consumidos con sus precios</li>
            <li>El total a cobrar</li>
            <li>Una leyenda indicando que no es comprobante de pago</li>
          </ul>
          <p className="mt-3">La precuenta se imprime si tenés impresora configurada.</p>
        </div>

        {/* 8 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">8. Cobrar y cerrar la mesa</h2>

          <h3 className="font-medium mb-2">8.1 Elegí el método de pago</h3>
          <p className="mb-3">En la parte inferior de la cuenta tenés los métodos de pago:</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Método</th>
                  <th className="text-left px-3 py-2 font-medium">Cuándo usarlo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-medium">💵 Efectivo</td>
                  <td className="px-3 py-2 text-muted-foreground">El cliente paga en efectivo</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-medium">🏦 Transferencia</td>
                  <td className="px-3 py-2 text-muted-foreground">El cliente transfiere por alias o CVU</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-medium">💳 Tarjeta</td>
                  <td className="px-3 py-2 text-muted-foreground">El cliente paga con tarjeta (no se procesa online)</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-medium">🔀 Mixto</td>
                  <td className="px-3 py-2 text-muted-foreground">Combina varios métodos (ej: $10k efectivo + $5k transferencia)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="font-medium mb-2 mt-4">8.2 Confirmá el cobro</h3>
          <p className="mb-3">
            Tocá <span className="font-medium">"Cobrado y cerrar"</span>. La mesa se libera automáticamente y vuelve a estado <span className="font-medium">Libre</span>:
          </p>
          <img src="/manuales/capturas/55-mesas-cerrada.png" alt="Mesa cerrada" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 9 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">9. Cuentas cerradas</h2>
          <p>
            Las mesas cerradas quedan registradas en la pestaña <span className="font-medium">"Cuentas cerradas"</span> dentro
            de la vista de cuenta. Podés expandirla para ver el historial de cobros de esa mesa.
          </p>
        </div>

        {/* 10 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">10. Tips y buenas prácticas</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li><span className="font-medium">Cargá de a poco:</span> agregá los pedidos de a medida que el cliente los va pidiendo. No esperés a que termine de pedir todo.</li>
            <li><span className="font-medium">Revisá la precuenta</span> antes de cobrar para asegurarte de que todo esté correcto.</li>
            <li><span className="font-medium">Usá la descripción del producto</span> para notas especiales (ej: "sin cebolla", "poco cocida").</li>
            <li><span className="font-medium">Si tenés impresora</span>, la comanda se envía automáticamente al guardar consumiciones que requieran cocina.</li>
          </ul>
        </div>

        {/* Footer */}
        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            ¿Tenés dudas? Escribinos por WhatsApp desde tu dashboard o contactá al soporte.
          </p>
        </div>

      </section>
    </main>
  );
}
