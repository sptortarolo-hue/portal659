import { Logo } from "@/components/brand/logo";
import { Captura } from "../captura";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Venta por peso | Portal 659",
  description:
    "Manual completo de la venta por peso: configurar múltiplo y peso mínimo, modo confirmar (pesar antes de cobrar), envío del pedido pesado por WhatsApp y cobro en efectivo, transferencia o Mercado Pago.",
  alternates: { canonical: "/manuales/pesables" },
};

export default function PesablesPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Venta por peso 🥩⚖️</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Todo lo que necesitás para vender al peso: carnicerías, verdulerías, pollajerías, fiambrerías,
        granjas y todo lo que se pesa antes de vender. Antes leé el{" "}
        <a className="text-primary font-medium" href="/manuales/basico">manual básico</a> y el de{" "}
        <a className="text-primary font-medium" href="/manuales/comercio">Comercio de barrio</a>.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Qué es la venta por peso</h2>
          <p className="mb-3">
            Un producto <span className="font-medium">por peso</span> se vende por kilo: cargás el
            precio de un kilo y el cliente elige cuántos kilos quiere. No lleva stock (no se descuenta
            al vender) porque el peso real se define al pesar.
          </p>
          <p className="mb-3">
            El desafío de vender al peso online es siempre el mismo: <em>el cliente declara un peso
            estimado, pero el real se sabe recién en la balanza</em>. Portal 659 te deja resolverlo
            como vos quieras: cobrar el estimado (como siempre) o pesar y confirmar el total real
            antes de cobrar. Vos elegís.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Cargar un producto por peso</h2>
          <p className="mb-3">
            En <span className="font-medium">Más → Catálogo</span> cargás el producto como siempre
            (nombre, foto, categoría) y en <span className="font-medium">Unidad de venta</span> elegís{" "}
            <span className="font-medium">“Por peso (precio por kilo)”</span>. Desde ese momento el
            precio que cargues es <strong>el precio de un kilo</strong>: si ponés $5.000, medio kilo
            sale $2.500.
          </p>
          <p className="mb-3">
            El mismo producto lo podés vender por el micrositio (el cliente elige los kilos) y por el{" "}
            <span className="font-medium">Mostrador</span> (vos los pesás con la balanza). Datos,
            variantes, opciones y fotos se cargan igual que cualquier otro producto.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. La configuración ⚖️ Venta por kilo</h2>
          <p className="mb-3">
            En <span className="font-medium">Configuración</span> de tu comercio encontrás la sección{" "}
            <span className="font-medium">⚖️ Venta por kilo</span> con cuatro controles. Cuando la
            configurás, estás definiendo cómo te venden a vos:
          </p>
          <p className="mb-3">
            <span className="font-medium">Modo de cobro</span> ·{" "}
            <span className="font-medium">Estimado</span> (se cobra lo que el cliente declaró al
            pedir, como cualquier comercio) o <span className="font-medium">Confirmar peso</span> (el
            pedido entra pendiente de peso, vos pesás y confirmás el total real, y recién ahí se
            cobra). La sección 6 explica el segundo caso paso a paso.
          </p>
          <p className="mb-3">
            <span className="font-medium">Múltiplo de venta</span> ·{" "}
            <span className="font-medium">Libre</span> (cualquier peso),{" "}
            <span className="font-medium">de a medio kilo</span> o{" "}
            <span className="font-medium">de a cuarto de kilo</span>. Es el “salto” con el que el
            cliente puede mover el peso en tu micrositio: si elegís medio kilo, no te van a pedir 300
            gramos.
          </p>
          <p className="mb-3">
            <span className="font-medium">Peso mínimo</span> (en gramos) · el corte más chico que
            vendés: 100 g en la fiambrería, 250 g en la verdulería. Si el cliente escribe menos, el
            micrositio se lo avisa y no lo deja seguir.
          </p>
          <p className="mb-3">
            <span className="font-medium">Tolerancia sin aprobar</span> (solo modo{" "}
            <span className="font-medium">Confirmar</span>) · el porcentaje de diferencia entre el
            peso estimado y el real que tu cliente puede pagar sin tener que aceptarlo primero. Si
            pidió 1 kg, lo real es 1,3 kg y tu tolerancia es 20 %, le llega el aviso del total y paga
            directo; si la diferencia es mayor, primero tiene que tocar{" "}
            <span className="font-medium">“Aceptar total”</span>.
          </p>
          <Captura base="pesables-config" alt="Configuración de venta por kilo" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Qué ve tu cliente al elegir el peso</h2>
          <p className="mb-3">
            En tu micrositio, el producto por kilo muestra el precio por kilo y tres formas de elegir
            el peso, todas compatibles: <span className="font-medium">escribirlo a mano</span> (acepta
            coma, “0,5”), los <span className="font-medium">atajos</span> de “½ kg · 1 kg · 1½ kg · 2
            kg”, y los botones <span className="font-medium">− / +</span> que caminan el peso con el
            paso que configuraste (el múltiplo, o de a 100 g si está en libre), sin bajar del peso
            mínimo ni pasar de 99 kg.
          </p>
          <p className="mb-3">
            Mientras elige, ve el total en vivo y un recordatorio de tus reglas (“ de a medio kilo ·
            mínimo 100 g”); si escribe un peso que no se puede vender, se lo decimos con un mensaje
            claro antes de que siga. En el carrito puede corregir el peso con los mismos − / +.
          </p>
          <p className="mb-3">
            Con modo <span className="font-medium">Confirmar</span>, el checkout le avisa que el total
            es estimado hasta que vos peses: no se sorprende después.
          </p>
          <Captura base="pesables-micrositio" alt="Producto por peso en el micrositio" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Modo Estimado: cobrar como siempre</h2>
          <p className="mb-3">
            Si elegís <span className="font-medium">Estimado</span>, no cambia nada de lo que ya
            conocés: el cliente paga por el peso que declaró (Mercado Pago, transferencia o efectivo) y
            el pedido sigue su curso normal. Es el modo ideal si tu producto es estándar o si preferís
            simplificar la operatoria.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Modo Confirmar: pesar y recién cobrar</h2>
          <p className="mb-3">
            Es el modo que usan las apps de supermercado y las carnicerías online. El circuito
            completo es así:
          </p>
          <p className="mb-3">
            <strong>1 · Entra el pedido.</strong> Con productos por kilo, nace con el badge{" "}
            <span className="font-medium">⚖️ Pendiente de peso</span> en tu panel. Todavía no se cobra:
            el total que ves es el estimado del cliente. Si pidió con Mercado Pago o transferencia, el
            pedido queda <span className="font-medium">pendiente de pago</span>; si pidió efectivo,
            queda para cobrar al entregar.
          </p>
          <p className="mb-3">
            <strong>2 · Pesás.</strong> Ponés el producto en la balanza y leés el peso real. Podés
            pesarlo en el momento que quieras: el pedido espera.
          </p>
          <p className="mb-3">
            <strong>3 · Confirmás el peso.</strong> Abrís el pedido y tocás{" "}
            <span className="font-medium">⚖️ Confirmar peso</span>: cargás los kilos reales de cada
            producto (podés corregirlo todas las veces que haga falta antes de confirmar) y el sistema
            recalcula el total. Apretar confirmar sella el total real.
          </p>
          <p className="mb-3">
            <strong>4 · Avisás al cliente.</strong> Tu cliente recibe la notificación con el total
            real. Además, en el pedido aparece el botón{" "}
            <span className="font-medium">📲 Enviar pedido pesado por WhatsApp</span>: manda el
            detalle con los kilos reales de cada producto, el total y cómo pagar. Es manual a
            propósito: vos controlás el monto que sale.
          </p>
          <p className="mb-3">
            <strong>5 · Cobrás.</strong> Según cómo eligió pagar tu cliente:
          </p>
          <p className="mb-3">
            <span className="font-medium">Efectivo</span> · paga al recibir o al retirar. El pedido
            muestra <span className="font-medium">“Cobrar $X al entregar”</span> para que no se te
            pase. <span className="font-medium">Transferencia</span> · el mensaje de WhatsApp lleva
            tu alias, CBU y el monto exacto; el cliente te manda el comprobante por el mismo chat y
            lo marcás como pagado. <span className="font-medium">Mercado Pago</span> · tu cliente paga
            desde su link de seguimiento (o le generás el link de pago desde el pedido).
          </p>
          <p className="mb-3">
            <strong>6 · Despachás.</strong> Con el pago confirmado, el pedido avanza a{" "}
            <span className="font-medium">Empaquetando → Listo → Enviado → Entregado</span> como
            siempre. Mientras el pago esté pendiente en transferencia o Mercado Pago, el pedido{" "}
            <strong>no avanza</strong>: el sistema te lo recuerda para que no entregues sin cobrar.
          </p>
          <Captura base="pesables-pedido" alt="Pedido pendiente de peso" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">7. Preguntas frecuentes</h2>
          <p className="mb-3">
            <span className="font-medium">¿Me equivoqué de peso?</span> · Podés corregirlo todas las
            veces que quieras <em>antes</em> de confirmar. Después de confirmar, el total quedó
            firmado para el cliente; si hay que cambiarlo, escribile por WhatsApp.
          </p>
          <p className="mb-3">
            <span className="font-medium">¿Y si el cliente no acepta el total real?</span> · Si la
            diferencia es mayor a tu tolerancia, él ve el total y decide: lo acepta y paga, o no. Si
            no está de acuerdo, cancelen el pedido por WhatsApp como cualquier otro.
          </p>
          <p className="mb-3">
            <span className="font-medium">¿Sirve para delivery y para retiro?</span> · Sí, es igual
            para las dos formas de entrega: lo que define el cobro es el método de pago, no la
            entrega.
          </p>
          <p className="mb-3">
            <span className="font-medium">¿Y el stock?</span> · Los productos por peso no descuentan
            stock: son los que no se pueden estoquear por unidad. Llevá el control como lo hacés hoy.
          </p>
          <p className="mb-3">
            <span className="font-medium">¿Puedo probarlo sin clientes reales?</span> · Sí: con el{" "}
            <span className="font-medium">modo prueba</span> de tu micrositio hacés pedidos de prueba
            que nunca se cobran ni cuentan en tus métricas.
          </p>
        </div>

        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            ¿Querés ver el resto de la operatoria? Mirá el manual de{" "}
            <a className="text-primary font-medium" href="/manuales/comercio">Comercio de barrio</a>{" "}
            (mostrador, caja y reparto) y{" "}
            <a className="text-primary font-medium" href="/manuales/basico">Uso básico</a>. La
            balanza física se configura en{" "}
            <span className="font-medium">Configuración → Balanza</span>.
          </p>
        </div>
      </section>
    </main>
  );
}
