import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Alta del comercio gastronómico | Portal 659",
  description: "Guía paso a paso para darse de alta como comercio gastronómico en Portal 659.",
};

export default function AltaComercioPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Alta del comercio gastronómico</h1>
      </div>
      <p className="text-muted-foreground mb-8 text-sm">
        Guía paso a paso para darse de alta como comercio gastronómico en Portal 659.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">

        {/* 1 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Entrá a Portal 659</h2>
          <p className="mb-3">
            Abrí tu navegador y entrá a <span className="font-medium">www.portal659.com.ar</span>. Vas a ver la home del portal.
          </p>
          <img src="/manuales/capturas/01-home.png" alt="Home de Portal 659" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 2 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Creá tu cuenta</h2>
          <p className="mb-3">
            Tocá <span className="font-medium">&quot;Registrate&quot;</span> (o &quot;Sumá tu comercio&quot;) para ir al formulario de registro.
          </p>
          <img src="/manuales/capturas/03-register.png" alt="Página de registro" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <p className="mb-2">Completá tus datos:</p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li><span className="font-medium">Nombre y apellido</span>: tu nombre real.</li>
            <li><span className="font-medium">Nombre del comercio</span>: cómo se va a llamar tu local.</li>
            <li><span className="font-medium">WhatsApp</span>: tu número con código de área. Por este número te van a escribir los clientes.</li>
            <li><span className="font-medium">Email</span>: tu correo electrónico (lo usás para iniciar sesión).</li>
            <li><span className="font-medium">Contraseña</span>: elegí una contraseña segura.</li>
            <li><span className="font-medium">Tipo de comercio</span>: seleccioná &quot;Restaurante / Comida&quot;.</li>
          </ul>
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
            <strong>Importante:</strong> Revisá tu casilla de email. Te enviamos un mensaje de bienvenida con tu código QR y un link directo para compartir tu menú.
          </p>
        </div>

        {/* 3 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Iniciá sesión</h2>
          <p className="mb-3">
            Una vez creada tu cuenta, ingresá con tu email y contraseña.
          </p>
          <img src="/manuales/capturas/02-login.png" alt="Página de login" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 4 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Tu panel de control (Dashboard)</h2>
          <p className="mb-3">
            Al entrar, llegás al <span className="font-medium">Panel de control</span>. Acá vas a ver los pedidos que te llegan en tiempo real, el resumen del día y las pestañas principales: Pedidos, Comanda, Mostrador, Mesas y Más.
          </p>
          <img src="/manuales/capturas/04-dashboard-pedidos.png" alt="Dashboard Pedidos" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 5 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Configurá tu comercio</h2>
          <p className="mb-3">
            Tocá la pestaña <span className="font-medium">&quot;Más&quot;</span> (⋮) en la barra inferior y después <span className="font-medium">&quot;Configuración&quot;</span>.
          </p>
          <img src="/manuales/capturas/11-menu-mas.png" alt='Menú "Más"' className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-semibold mb-2">5.1 Datos básicos</h3>
          <p className="mb-3">
            En la sección <span className="font-medium">&quot;Tu comercio&quot;</span> cargá el nombre, categoría, barrio y teléfono de contacto.
          </p>
          <img src="/manuales/capturas/12-config-top.png" alt="Configuración datos del comercio" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-semibold mb-2">5.2 Ubicación y horarios</h3>
          <p className="mb-3">
            Expandí <span className="font-medium">&quot;Ubicación y horarios&quot;</span> para cargar tu dirección y horarios de atención.
          </p>
          <img src="/manuales/capturas/14-config-ubicacion.png" alt="Ubicación y horarios" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-4" />

          <h3 className="font-semibold mb-2">5.3 Formas de pago y entrega</h3>
          <p className="mb-3">
            En <span className="font-medium">&quot;Pago y entrega&quot;</span> configurá métodos de pago, opciones de entrega, costo de envío y datos de transferencia.
          </p>
          <img src="/manuales/capturas/15-config-pago.png" alt="Pago y entrega" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 6 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Cargá tu menú</h2>
          <p className="mb-3">
            En la sección <span className="font-medium">&quot;Menú&quot;</span> de configuración podés agregar categorías, platos con nombre, precio, foto y descripción.
          </p>
          <img src="/manuales/capturas/16-config-menu.png" alt="Configuración menú" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* 7 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Compartí tu menú</h2>
          <p className="mb-3">
            Tocá <span className="font-medium">&quot;Compartir&quot;</span> en la parte superior del dashboard. Te aparece un código QR y un link directo a tu menú.
          </p>
          <img src="/manuales/capturas/17-share-modal.png" alt="Modal de compartir" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Código QR</span>: imprimilo y ponelo en la mesa o vidriera.</li>
            <li><span className="font-medium">Link directo</span>: compartilo por WhatsApp, Instagram o redes sociales.</li>
          </ul>
        </div>

        {/* 8 */}
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">8. Tu micrositio (vista del cliente)</h2>
          <p className="mb-3">
            Con tu link o QR, el cliente ve tu micrositio: cover, descripción, horarios, menú y botón de WhatsApp.
          </p>
          <img src="/manuales/capturas/18-micrositio.png" alt="Micrositio del comercio" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <p className="mb-3">
            Si acceden con <code className="bg-muted px-1 rounded text-xs">?menu=1</code>, se abre directamente en la sección de menú:
          </p>
          <img src="/manuales/capturas/19-micrositio-menu.png" alt="Micrositio menú" className="rounded-xl border border-border shadow-sm w-full max-w-sm mb-3" />
          <p className="mb-3">
            En mobile aparece un botón fijo de WhatsApp para que el cliente te escriba directo:
          </p>
          <img src="/manuales/capturas/20-micrositio-wa.png" alt="Botón WhatsApp fijo" className="rounded-xl border border-border shadow-sm w-full max-w-sm" />
        </div>

        {/* Resumen */}
        <div className="bg-muted/50 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Resumen</h2>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            <li>Entrás a portal659.com.ar</li>
            <li>Te registrás como comercio</li>
            <li>Iniciás sesión</li>
            <li>Configurás datos, horarios y entrega</li>
            <li>Cargás tu menú (categorías + platos)</li>
            <li>Compartís tu QR o link</li>
            <li>¡Los clientes te empiezan a escribir por WhatsApp!</li>
          </ol>
        </div>

        {/* Tips */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Tips</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><span className="font-medium">Foto del plato</span>: una buena foto aumenta las ventas. Usá luz natural y fondo limpio.</li>
            <li><span className="font-medium">Descripción breve</span>: contá qué tiene el plato.</li>
            <li><span className="font-medium">Horarios exactos</span>: si cerrás un día, actualizá los horarios.</li>
            <li><span className="font-medium">WhatsApp activo</span>: respondé rápido.</li>
          </ul>
        </div>

      </section>

      <div className="mt-10 pt-6 border-t border-border">
        <Link href="/manuales/recepcion-pedidos" className="text-primary hover:underline font-medium text-sm">
          Siguiente: Recepción de pedidos y delivery →
        </Link>
      </div>
    </main>
  );
}
