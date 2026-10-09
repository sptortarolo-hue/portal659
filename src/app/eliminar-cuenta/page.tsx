import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export const metadata = {
  title: "Eliminar cuenta | Portal 659",
  description:
    "Cómo solicitar la eliminación de tu cuenta y datos asociados en Portal 659.",
};

export default function EliminarCuentaPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Eliminar cuenta — Portal 659</h1>
      </div>
      <p className="text-muted-foreground mb-8">Última actualización: {new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}</p>

      <section className="space-y-6 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-2">1. Cómo solicitar la eliminación</h2>
          <p>
            Para solicitar la eliminación de tu cuenta de Portal 659 y todos los datos asociados, enviá un email a{" "}
            <span className="font-medium">soporte@portal659.com.ar</span> con el asunto{" "}
            <span className="font-medium">"Eliminar mi cuenta"</span> y la dirección de email registrada en tu cuenta.
          </p>
          <p className="mt-2">
            Procesamos la solicitud en un plazo máximo de <span className="font-medium">30 días</span>.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">2. Datos que se eliminan</h2>
          <p>Al confirmar la eliminación, se borran los siguientes datos:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Información de tu cuenta (nombre, email, teléfono, WhatsApp, barrio)</li>
            <li>Historial de pedidos y consultas</li>
            <li>Favoritos guardados</li>
            <li>Reseñas que hayas escrito</li>
            <li>Suscripciones a notificaciones push</li>
            <li>Cualquier otro dato personal asociado a tu cuenta</li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">3. Datos que se conservan</h2>
          <p>
            Algunos datos pueden conservarse por obligaciones legales o seguridad:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Registros de transacciones (por obligaciones fiscales, hasta 5 años)</li>
            <li>Datos anonimizados para estadísticas agregadas (sin identificación personal)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">4. Eliminación parcial</h2>
          <p>
            Si no querés eliminar tu cuenta completa, podés solicitar la eliminación de datos específicos (por ejemplo, solo tus reseñas o solo tus favoritos). En el email indicá qué datos querés borrar.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-2">5. Contacto</h2>
          <p>
            Ante cualquier consulta sobre la eliminación de datos, contactanos a{" "}
            <span className="font-medium">soporte@portal659.com.ar</span> o a través de{" "}
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