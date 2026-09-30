import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = {
  title: "Política de Privacidad | Portal Print",
  description:
    "Cómo Portal Print maneja los datos en tu dispositivo.",
};

export default function PrivacidadPrintPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Política de Privacidad — Portal Print</h1>
      </div>
      <p className="text-muted-foreground mb-8">Última actualización: {new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}</p>

      <section className="space-y-6 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-2">1. Datos que recopilamos</h2>
          <p>
            Portal Print <span className="font-medium">no recopila datos personales</span>. La aplicación
            almacena únicamente un token de configuración en tu dispositivo para conectarse al servidor
            de Portal 659. No se recolectan nombres, correos electrónicos, teléfonos ni ningún otro
            dato personal.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">2. Uso de los datos</h2>
          <p>
            El token almacenado se utiliza exclusivamente para:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Conectarse al relay de impresión de Portal 659.</li>
            <li>Recibir órdenes de impresión de tu comercio.</li>
            <li>Enviar los comandos de impresión a la impresora térmica en tu red local.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">3. Compartir datos</h2>
          <p>
            Portal Print <span className="font-medium">no comparte datos con terceros</span>. La conexión
            se realiza únicamente entre tu dispositivo y el servidor de Portal 659 mediante un canal
            cifrado (WebSocket seguro).
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">4. Seguridad</h2>
          <p>
            La conexión con el servidor de Portal 659 está cifrada (WSS). El token se almacena
            localmente en tu dispositivo y no se transmite a ningún otro destino.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">5. Permisos de la aplicación</h2>
          <p>
            Portal Print utiliza los siguientes permisos de Android:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><span className="font-medium">Internet:</span> para conectarse al relay de impresión.</li>
            <li><span className="font-medium">Red local:</span> para detectar y conectarse a la impresora térmica.</li>
            <li><span className="font-medium">Notificaciones:</span> para mostrar el estado de la conexión.</li>
            <li><span className="font-medium">Segundo plano:</span> para mantener la conexión activa durante la operación del comercio.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">6. Contacto</h2>
          <p>
            Ante cualquier consulta sobre esta política, podés contactarnos a través de los canales
            disponibles en{" "}
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
