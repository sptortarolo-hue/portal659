import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Configuración e instalación de impresora | Portal 659",
  description: "Guía completa para configurar e instalar una impresora térmica en Portal 659.",
};

export default function ImpresoraPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Impresora térmica</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Guía completa para configurar e instalar una impresora térmica en Portal 659.
      </p>
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm mb-8">
        <strong>Solo gastronomía</strong> — Próximamente sumamos guías para otras verticales.
      </div>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">

        {/* 1 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Qué necesitás</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Una <span className="font-medium">impresora térmica</span> compatible ESC/POS (58mm o 80mm).</li>
            <li>Un <span className="font-medium">celular Android</span> o una <span className="font-medium">PC con Windows</span> conectados a la misma red Wi-Fi que la impresora.</li>
            <li>Tu comercio debe tener el <span className="font-medium">plan Gestión</span> para usar la impresión.</li>
          </ul>
        </div>

        {/* 2 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Elegí cómo imprimir</h2>
          <p className="mb-3">
            En tu dashboard, entrá a <span className="font-medium">Configuración → Impresora térmica</span>. Vas a ver dos opciones:
          </p>
          <img src="/manuales/capturas/30-printer-config-top.png" alt="Configuración impresora" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Modo</th>
                  <th className="text-left px-3 py-2 font-medium">Cómo funciona</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">📱 App en tu celu</td><td className="px-3 py-2">La app Portal Print recibe el ticket y lo imprime por Wi-Fi</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2 font-medium">🖥️ Servidor (TCP)</td><td className="px-3 py-2">El VPS envía el ticket directo a la impresora</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            <strong>Recomendación:</strong> usá <span className="font-medium">App en tu celu</span>. No necesitás abrir puertos ni tener IP pública.
          </p>
        </div>

        {/* 3 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Opción A: App Portal Print (Android)</h2>

          <h3 className="font-semibold mb-2">3.1 Configurar en el dashboard</h3>
          <p className="mb-3">
            Seleccioná <span className="font-medium">&quot;App en tu celu&quot;</span>. Vas a ver el estado de conexión y el token:
          </p>
          <img src="/manuales/capturas/31-printer-app-mode.png" alt="Modo app" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>🔴 <strong>App no conectada</strong> = la app aún no se conectó (es normal al principio).</li>
            <li>🟢 <strong>App conectada</strong> = la app está recibiendo tickets.</li>
          </ul>

          <h3 className="font-semibold mb-2">3.2 Descargá e instalá la app</h3>
          <p className="mb-3">
            Expandí <span className="font-medium">&quot;Configurar la app Portal Print&quot;</span> y tocá el botón de descarga:
          </p>
          <img src="/manuales/capturas/32-printer-app-steps.png" alt="Pasos app Android" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ol className="list-decimal pl-5 space-y-1 mb-4">
            <li>Descargá el APK tocando <span className="font-medium">&quot;Descargar la app (Android)&quot;</span>.</li>
            <li>Si el navegador lo pide, habilitá <span className="font-medium">&quot;Instalar apps desconocidas&quot;</span>.</li>
            <li>Instalá la app como cualquier otra.</li>
          </ol>

          <h3 className="font-semibold mb-2">3.3 Configurá la app en el celular</h3>
          <p className="mb-3">Abri la app <span className="font-medium">Portal Print</span> en tu celular:</p>
          <ol className="list-decimal pl-5 space-y-1 mb-4">
            <li><span className="font-medium">Conectá el celular al mismo Wi-Fi</span> que la impresora.</li>
            <li>Pegá el <span className="font-medium">token</span> que ves en el dashboard (tocá &quot;Copiar&quot;).</li>
            <li>Ingresá la <span className="font-medium">IP de la impresora</span>.</li>
            <li>Tocá <span className="font-medium">&quot;Conectar&quot;</span>.</li>
          </ol>

          <h3 className="font-semibold mb-2">3.4 Configuración crítica del celular</h3>
          <p className="mb-3">
            Para que la app funcione sin interrupciones, configurá estos ajustes en tu celular:
          </p>
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm mb-4">
            <strong>Estos pasos son obligatorios.</strong> Si no los hacés, el sistema operativo puede cerrar la app y dejar de imprimir.
          </div>
          <ol className="list-decimal pl-5 space-y-2 mb-4">
            <li>
              <span className="font-medium">Batería:</span> Andá a Configuración → Aplicaciones → Portal Print → Batería. Seleccioná <span className="font-medium">&quot;Sin restricciones&quot;</span> o <span className="font-medium">&quot;No optimizar&quot;</span>. Desactivá cualquier ahorro de batería para esta app.
            </li>
            <li>
              <span className="font-medium">Datos:</span> Andá a Configuración → Aplicaciones → Portal Print → Datos móviles. Activá <span className="font-medium">&quot;Permitir uso de datos en segundo plano&quot;</span>. Desactivá <span className="font-medium">&quot;Ahorro de datos en segundo plano&quot;</span> si existe.
            </li>
            <li>
              <span className="font-medium">No suspender:</span> Buscá la opción <span className="font-medium">&quot;No suspender&quot;</span> o <span className="font-medium">&quot;Permitir actividad en segundo plano&quot;</span> y activala.
            </li>
            <li>
              <span className="font-medium">Reiniciá el celular</span> para que todos los cambios se activen.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <strong>Tip:</strong> dejá el celular enchufado en el mostrador. La app necesita estar abierta y con pantalla encendida (la app ya se encarga de mantener la pantalla activa).
          </p>

          <h3 className="font-semibold mb-2 mt-6">3.5 Verificá la conexión</h3>
          <p className="mb-3">
            Volvé al dashboard. Si todo está bien, vas a ver el indicador 🟢 <span className="font-medium">&quot;App conectada&quot;</span>. Tocá <span className="font-medium">&quot;Imprimir prueba&quot;</span> para verificar que la impresora responde.
          </p>
        </div>

        {/* 4 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Opción B: Agente PC (Windows)</h2>
          <p className="mb-3">Si preferís usar una PC en lugar del celular:</p>
          <img src="/manuales/capturas/33-printer-pc-steps.png" alt="Pasos PC" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ol className="list-decimal pl-5 space-y-1 mb-4">
            <li>La impresora debe estar en la <span className="font-medium">misma red</span> que la PC.</li>
            <li>Descargá el archivo <code className="bg-muted px-1 rounded text-xs">.exe</code> desde el dashboard.</li>
            <li>Ejecutalo (doble clic). La primera vez te pide el <span className="font-medium">token</span> y la <span className="font-medium">IP de la impresora</span>.</li>
            <li>Dejá la ventana abierta.</li>
          </ol>

          <h3 className="font-semibold mb-2">Autoarranque</h3>
          <p className="mb-2">Para que el agente arranque solo al prender la PC:</p>
          <p className="mb-1"><span className="font-medium">Opción 1 — Inicio de Windows:</span></p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>Tecleá <code className="bg-muted px-1 rounded text-xs">Win + R</code>, escribí <code className="bg-muted px-1 rounded text-xs">shell:startup</code> y Enter.</li>
            <li>Mové o copiá el <code className="bg-muted px-1 rounded text-xs">.exe</code> a esa carpeta.</li>
          </ul>
          <p className="mb-1"><span className="font-medium">Opción 2 — Tarea programada</span> (CMD como admin):</p>
          <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto">schtasks /create /tn &quot;Portal Print&quot; /sc onlogon /tr &quot;portal-print-agent.exe&quot;</pre>
        </div>

        {/* 5 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Opción C: Servidor TCP</h2>
          <p className="mb-3">Si la impresora es alcanzable desde el VPS:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Seleccioná <span className="font-medium">&quot;Servidor (TCP)&quot;</span> en el dashboard.</li>
            <li>Configurá la <span className="font-medium">IP</span> y <span className="font-medium">puerto</span> (por defecto 9100).</li>
            <li>El servidor envía los tickets directo por TCP.</li>
          </ol>
          <p className="text-xs text-muted-foreground mt-2 bg-muted/50 rounded-lg p-3">
            <strong>Nota:</strong> este método requiere que el VPS pueda conectarse a la impresora. No funciona si la impresora está detrás de un router sin port forwarding.
          </p>
        </div>

        {/* 6 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Configuración adicional</h2>
          <img src="/manuales/capturas/34-printer-fields.png" alt="Campos de configuración" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">IP de la impresora</span>: dirección en tu red local (ej: <code className="bg-muted px-1 rounded text-xs">192.168.1.100</code>).</li>
            <li><span className="font-medium">Puerto</span>: por defecto <code className="bg-muted px-1 rounded text-xs">9100</code> (estándar ESC/POS).</li>
            <li><span className="font-medium">Tamaño de papel</span>: <code className="bg-muted px-1 rounded text-xs">58mm</code> o <code className="bg-muted px-1 rounded text-xs">80mm</code>.</li>
            <li><span className="font-medium">Impresión automática</span>: la comanda se imprime sola al aceptar un pedido.</li>
          </ul>
        </div>

        {/* 7 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Probar la impresora</h2>
          <p className="mb-3">
            Tocá <span className="font-medium">&quot;🖨️ Imprimir prueba&quot;</span> en el dashboard. La impresora debería imprimir un ticket de prueba con el nombre de tu comercio y el texto &quot;PRUEBA DE IMPRESIÓN&quot;.
          </p>
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            Si no imprime: verificá que la IP sea correcta, asegurate de estar en la misma red Wi-Fi, y revisá que la impresora esté encendida y con papel.
          </p>
        </div>

        {/* 8 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">8. Imprimir desde los pedidos</h2>

          <h3 className="font-semibold mb-2">Desde el detalle del pedido</h3>
          <p className="mb-3">
            Cuando abrís un pedido, vas a ver los botones de impresión:
          </p>
          <img src="/manuales/capturas/36-order-print-btn.png" alt="Botón imprimir comanda" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li><span className="font-medium">&quot;🖨️ Imprimir comanda&quot;</span>: imprime el pedido para la cocina.</li>
            <li><span className="font-medium">&quot;🖨️ Reimprimir ticket&quot;</span>: imprime el recibo del cliente (en pedidos completados).</li>
          </ul>

          <h3 className="font-semibold mb-2">Desde la Comanda (KDS)</h3>
          <p className="mb-3">
            En la pestaña <span className="font-medium">Comanda</span>, cada ticket tiene un ícono de impresora:
          </p>
          <img src="/manuales/capturas/37-kds-print-btn.png" alt="Comanda KDS" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />

          <h3 className="font-semibold mb-2">Desde el Mostrador (POS)</h3>
          <p className="mb-3">
            Al cobrar una venta en el mostrador, la comanda se imprime automáticamente si tenés activada la <span className="font-medium">impresión automática</span>:
          </p>
          <img src="/manuales/capturas/38-mostrador-print.png" alt="Mostrador" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 9 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">9. Cola de impresión</h2>
          <p className="mb-3">
            Si la app o el agente no están conectados, los tickets se encolan y se imprimen cuando se reconecten:
          </p>
          <img src="/manuales/capturas/35-printer-queue.png" alt="Cola de impresión" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Actualizar</span>: recargá la cola para ver trabajos pendientes.</li>
            <li><span className="font-medium">Vaciar cola</span>: borrá todos los trabajos pendientes.</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2">
            <strong>Importante:</strong> la cola vive en el servidor. Si el servidor se reinicia, se vacía.
          </p>
        </div>

        {/* 10 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">10. Fallback: imprimir desde el navegador</h2>
          <p className="mb-3">
            Si la impresora térmica no está configurada o falla, se abre una página con el formato del pedido y el botón <span className="font-medium">&quot;Imprimir&quot;</span> del navegador:
          </p>
          <img src="/manuales/capturas/39-fallback-print.png" alt="Fallback impresión" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* Tips */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Tips y troubleshooting</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Problema</th>
                  <th className="text-left px-3 py-2 font-medium">Solución</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border"><td className="px-3 py-2">🔴 App no conectada</td><td className="px-3 py-2">Verificá el mismo Wi-Fi. Revisá batería (paso 3.4).</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">Error al imprimir</td><td className="px-3 py-2">Verificá la IP. Probá &quot;Imprimir prueba&quot;.</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">La app se cierra sola</td><td className="px-3 py-2">Activá &quot;Sin restricciones&quot; en batería. Reiniciá el celular.</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">No sale papel</td><td className="px-3 py-2">Revisá papel y tamaño (58mm/80mm).</td></tr>
                <tr className="border-t border-border"><td className="px-3 py-2">Token inválido</td><td className="px-3 py-2">Regenerá el token en dashboard y volvelo a pegar.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Nota plan */}
        <div className="bg-muted/50 rounded-xl p-5">
          <p className="text-sm">
            <strong>Recordatorio:</strong> la impresión térmica es una feature del <span className="font-medium">plan Gestión</span>. Si no ves los botones de impresión, actualizá tu plan desde la configuración.
          </p>
        </div>

      </section>

      <div className="mt-10 pt-6 border-t border-border flex justify-between">
        <Link href="/manuales/recepcion-pedidos" className="text-primary hover:underline font-medium text-sm">
          ← Recepción de pedidos
        </Link>
        <Link href="/manuales" className="text-primary hover:underline font-medium text-sm">
          Volver a manuales →
        </Link>
      </div>
    </main>
  );
}
