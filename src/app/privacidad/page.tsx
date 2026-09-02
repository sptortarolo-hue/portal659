import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = {
  title: "Política de Privacidad | Portal 659",
  description:
    "Cómo Portal 659 recopila, usa y protege tus datos personales.",
};

export default function PrivacidadPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Política de Privacidad</h1>
      </div>
      <p className="text-muted-foreground mb-8">Última actualización: {new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}</p>

      <section className="space-y-6 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-2">1. Quiénes somos</h2>
          <p>
            Portal 659 ("El centro comercial de tu barrio") es un hub multicommerce hiperlocal que
            conecta a los vecinos de los barrios de Sicardi, Garibaldi y zonas aledañas con los
            comercios del lugar. El sitio web y la aplicación operan bajo el dominio{" "}
            <span className="font-medium">www.portal659.com.ar</span>.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">2. Datos que recopilamos</h2>
          <p>Según tu interacción con la plataforma, recopilamos:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>
              <span className="font-medium">Datos de cuenta:</span> correo electrónico, nombre y
              apellido, teléfono, WhatsApp y barrio (para clientes que se registran).
            </li>
            <li>
              <span className="font-medium">Datos de pedidos y consultas:</span> los datos de
              contacto y entrega necesarios para gestionar tus pedidos o consultas a los comercios.
            </li>
            <li>
              <span className="font-medium">Contenido generado por vos:</span> reseñas y comentarios
              sobre los comercios, favoritos y notificaciones.
            </li>
            <li>
              <span className="font-medium">Datos de comerciantes:</span> para quienes crean un
              comercio, recopilamos los datos del negocio (razón social, rubro, contacto,
              productos) necesarios para operar el micrositio y el panel de gestión.
            </li>
            <li>
              <span className="font-medium">Datos técnicos:</span> cookies necesarias para mantener
              tu sesión (token JWT) y tu zona seleccionada, así como datos de uso anónimos para
              medir el rendimiento del servicio.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">3. Pagos</h2>
          <p>
            Los pagos online se procesan a través de Mercado Pago. Portal 659{" "}
            <span className="font-medium">no almacena ni tiene acceso</span> a los datos de tu
            tarjeta de crédito o débito; esos datos son gestionados de forma segura por Mercado
            Pago bajo su propia política de privacidad.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">4. Uso de los datos</h2>
          <p>Utilizamos tus datos para:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Crear y mantener tu cuenta y permitirte iniciar sesión.</li>
            <li>Procesar y entregar tus pedidos y consultas a los comercios.</li>
            <li>Enviarte notificaciones sobre el estado de tus pedidos y novedades del barrio.</li>
            <li>Permitir a los comerciantes gestionar su negocio y responder consultas.</li>
            <li>Mejorar la plataforma y medir su uso de forma agregada.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">5. Notificaciones push</h2>
          <p>
            Si lo autorizás, registramos una suscripción de notificaciones push en tu dispositivo
            para informarte sobre el estado de tus pedidos y novedades. Podés revocar esta
            autorización en cualquier momento desde la configuración de tu navegador o dispositivo.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">6. Compartir datos</h2>
          <p>
            No vendemos ni alquilamos tus datos personales. Tus datos se comparten únicamente con:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>
              <span className="font-medium">Comercios:</span> los datos necesarios para procesar tus
              pedidos o consultas (nombre, teléfono/WhatsApp y detalles del pedido).
            </li>
            <li>
              <span className="font-medium">Proveedores de servicio:</span> procesadores de pago
              (Mercado Pago) y de correo electrónico (Resend) que actúan en nuestro nombre y solo
              según nuestras instrucciones.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">7. Seguridad y retención</h2>
          <p>
            Aplicamos medidas técnicas y organizativas razonables para proteger tus datos (como el
            almacenamiento de contraseñas con algoritmos seguros de hash y el cifrado del tráfico
            en tránsito). Conservamos tus datos mientras tu cuenta esté activa o mientras sea
            necesario para cumplir obligaciones legales.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">8. Tus derechos</h2>
          <p>
            Podés acceder, corregir o eliminar tus datos personales. Podés editar tu perfil desde la
            sección "Mi perfil" de la plataforma. Para ejercer cualquiera de tus derechos o
            solicitar la eliminación de tu cuenta, contactanos a través de los medios indicados en
            esta página.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">9. Contacto</h2>
          <p>
            Ante cualquier consulta sobre esta política o el tratamiento de tus datos personales,
            podés contactarnos a través de los canales de contacto disponibles en{" "}
            <Link href="/" className="text-primary hover:underline font-medium">
              www.portal659.com.ar
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}