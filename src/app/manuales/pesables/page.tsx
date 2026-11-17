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
            <span className="font-medium">⚖️ Venta por kilo</span> con tres controles. Cuando la
            configurás, estás definiendo cómo te venden a vos:
          </p>
          <p className="mb-3">
            <span className="font-medium">Modo de cobro</span> ·{" "}
            <span className="font-medium">Estimado</span> (se cobra lo que el cliente declaró al
            pedir, como cualquier comercio) o <span className="font-medium">Confirmar peso</span> (el
            pedido entra al panel, lo pesás al PREPARARLO y confirmás el total real; al
            confirmar le llega automático a tu cliente por WhatsApp con el total y los datos
            para pagar. La sección 6 explica el segundo caso paso a paso.
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
            Con modo <span className="font-medium">Confirmar</span>, el checkout tiene un solo botón
            de confirmar y le avisa que el total es estimado hasta que vos peses: no se sorprende
            después. Si tu comercio tiene Mercado Pago conectada, él puede elegir pagar con MP (le
            llega el link para pagar cuando confirmás el peso); si no, transfiere o paga al recibir.
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
            queda para cobrar al entregar. Mientras no confirmes el peso, el aviso de pago del pedido
            no ofrece acciones: recién existe un total que cobrar cuando pesás.
          </p>
          <p className="mb-3">
            <strong>2 · Aceptás y preparás.</strong> El pedido pasa a <span className="font-medium">Preparando</span>
            como siempre: recién ahí se pesa.
          </p>
          <p className="mb-3">
            <strong>3 · Pesás en Preparación.</strong> En el pedido aparece{" "}
            <span className="font-medium">⚖️ Confirmar peso</span>: cargás los kilos reales de
            cada producto a mano o con el botón <span className="font-medium">Balanza</span> (si
            tenés la balanza conectada a la PC) y ves el total real en vivo. Apretar confirmar lo sella.
          </p>
          <p className="mb-3">
            <strong>4 · El cliente se entera solo.</strong> Al confirmar el peso se le manda
            automático un WhatsApp: “tu pedido está preparado y pesado”, el detalle con los
            kilos reales, el total y <strong>los datos para pagar según cómo eligió pagar</strong>:
            transferencia → tu alias/CBU/titular · Mercado Pago → el link para pagar · efectivo →
            “paga al recibir” · a coordinar → el link de MP si tenés MP conectada, y si no, tu
            alias/CBU. Si no cargaste ninguno, coordinan el pago por el chat. También le llega la
            notificación con el link de seguimiento. Si el bot de WhatsApp está desconectado, te
            avisa y podés reenviarlo con el botón{" "}
            <span className="font-medium">📲 Reenviar pedido pesado</span> del pedido.
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
            <span className="font-medium">Listo → Enviado → Entregado</span> como siempre. Sin el
            peso confirmado no podés marcar Listo (sin el total real no hay nada que cobrar), y
            mientras el pago esté pendiente en transferencia o Mercado Pago el pedido{" "}
            <strong>no avanza</strong>: el sistema te lo recuerda para que no entregues sin cobrar.
          </p>
          <Captura base="pesables-pedido" alt="Pedido pendiente de peso" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">
            7. Etiquetas de balanza con lector (Mostrador)
          </h2>
          <p className="mb-3">
            Si tu balanza imprime etiquetas con código de barras, el lector del Mostrador las puede
            leer: el producto entra solo al ticket con el peso ya cargado, sin tipear kilos ni buscar
            el producto. Es el mismo circuito que usan los supermercados.
          </p>
          <p className="mb-3">
            <strong>1 · Cargá el PLU.</strong> En{" "}
            <span className="font-medium">Catálogo → producto “Por peso” → PLU de balanza</span> poné
            el código con el que la balanza imprime ese producto (ej. <code>123</code>). Si lo dejás
            vacío se usa el código de barras (SKU) del producto.
          </p>
          <p className="mb-3">
            <strong>2 · Configurá el formato.</strong> En{" "}
            <span className="font-medium">Configuración → Balanza → 🏷️ Etiquetas con lector</span>{" "}
            prendé el switch y completá cómo imprime tu balanza: prefijo, dígitos del PLU, dígitos
            del valor, si el valor es <em>peso en gramos</em>, <em>peso en kilos</em> o{" "}
            <em>importe</em>, los decimales y qué hacer con el dígito verificador. El resumen te dice
            cuántos dígitos tiene que tener el código (las etiquetas de balanza suelen tener 13).
          </p>
          <p className="mb-3">
            <strong>3 · Probá y detectá.</strong> Escaneá una etiqueta en{" "}
            <span className="font-medium">Probar etiqueta</span> y vas a ver el PLU, el peso y el
            producto con el total. Si no sabés el formato, tocá{" "}
            <span className="font-medium">🔍 Detectar formato</span> con una etiqueta de un producto
            que ya tenga PLU: el portal prueba solo las combinaciones y te propone la que coincide.
          </p>
          <p className="mb-3">
            <strong>4 · Escaneá en el Mostrador.</strong> Pasá la etiqueta por el lector y listo:
            cada etiqueta es <span className="font-medium">una línea propia</span> (con el badge 🏷️),
            aunque sea el mismo producto. Si la etiqueta trae <em>importe</em> en vez de peso, el
            portal calcula los kilos con el precio por kilo del producto.
          </p>
          <p className="mb-3">
            <span className="font-medium">PLU desconocido</span> · si la etiqueta no corresponde a
            ningún producto, se abre el alta rápida ya precargada con el PLU, la venta{" "}
            <span className="font-medium">Por peso</span> y el peso leído: completás nombre y precio,
            guardás, y la línea entra con esos kilos.
          </p>
          <p className="text-muted-foreground">
            El peso de la etiqueta manda: no se le aplican el múltiplo de venta ni el peso mínimo
            (esos son para lo que carga el cliente en el micrositio). El formato y el PLU se
            configuran una sola vez.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">
            8. Etiquetas adhesivas para tus productos (impresora de etiquetas)
          </h2>
          <p className="mb-3">
            Para pegar en los productos por unidad y en los pesables usás una{" "}
            <span className="font-medium">impresora de etiquetas</span> (distinta de la de
            tickets): las etiquetas salen como las del supermercado, con el PLU y el código de
            barras que lee tu lector. Se configura en{" "}
            <span className="font-medium">Configuración → Balanza → 🏷️ Impresora de etiquetas</span>.
          </p>
          <p className="mb-3">
            <strong>1 · Instalá el agente.</strong> El agente de impresión "Portal Print" tiene que
            estar abierto en la PC a la que va conectada la impresora de etiquetas (USB), y la
            cola de Windows de la impresora tiene que aparecer en{" "}
            <span className="font-medium">Buscar colas</span>. Elegila en{" "}
            <span className="font-medium">Cola USB</span>.
          </p>
          <p className="mb-3">
            <strong>2 · Calibrá el lenguaje.</strong> Las impresoras de etiquetas entienden
            distintos lenguajes: <span className="font-medium">TSPL</span> (la mayoría),{" "}
            <span className="font-medium">ZPL</span> (Zebra) y <span className="font-medium">ESC/POS</span>.
            Elegí la <span className="font-medium">medida del rollo</span> (50×30 es la más común;
            58×40 si querés que entre todo), la <span className="font-medium">plantilla</span>{" "}
            (Envasado para pesables, Góndola para precio de repisa) y tocá{" "}
            <span className="font-medium">Probar TSPL</span>, <span className="font-medium">Probar ZPL</span> o{" "}
            <span className="font-medium">Probar ESC/POS</span>: cuando la etiqueta de calibración
            sale bien, el lenguaje queda fijado solo.
          </p>
          <p className="mb-3">
            <strong>3 · Emití las etiquetas.</strong> Tocá{" "}
            <span className="font-medium">🏷️ Emitir etiqueta…</span>: elegís el producto (o lo
            buscás), y si es <span className="font-medium">Por peso</span> la balanza pesa en
            vivo. La etiqueta muestra los valores al instante y con el botón{" "}
            <span className="font-medium">🖨️ Imprimir</span> sale. El flujo queda abierto para el
            siguiente producto: pesás, imprimís, y así hasta terminar.
          </p>
          <p className="mb-3">
            Si tu balanza no está por USB, cargás los kilos a mano con el campo o los atajos
            (250 g / 500 g / 1 kg / 1,5 kg). También podés elegir{" "}
            <span className="font-medium">auto-imprimir</span>: cuando el peso queda quieto 1,5
            segundos, la etiqueta se imprime sola.
          </p>
          <p className="mb-3">
            <span className="font-medium">¿Qué lleva la etiqueta?</span> ·
          </p>
          <ul className="list-disc list-inside space-y-1 mb-3">
            <li>
              <span className="font-medium">Envasado</span>: nombre, PLU, peso, precio por kilo,{" "}
              <span className="font-medium">TOTAL</span>, fecha de envasado (la de hoy; la
              podés cambiar), vencimiento si el producto lo tiene en su ficha o elegís uno de
              los atajos (+7 / +15 / +30 días), y el código de barras con el peso embebido
              (el mismo formato que lee el Mostrador).
            </li>
            <li>
              <span className="font-medium">Góndola</span>: nombre, marca,{" "}
              <span className="font-medium">precio grande</span>, precio por unidad de medida
              (por kilo o litro, como exige la exhibición de precios) y el código de barras
              interno. No lleva fechas.
            </li>
          </ul>
          <p className="text-muted-foreground">
            La impresión manual es por defecto; la automática es un interruptor por sesión. El
            Mostrador vuelve a calcular el precio con el vigente el día de la venta, igual que una
            balanza Etiquetadora: la etiqueta impresa es un comprobante del momento del envasado,
            no una cotización fija.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">9. Preguntas frecuentes</h2>
          <p className="mb-3">
            <span className="font-medium">¿Me equivoqué de peso?</span> · Podés corregirlo todas las
            veces que quieras <em>antes</em> de confirmar. Después de confirmar, el total quedó
            firmado para el cliente; si hay que cambiarlo, escribile por WhatsApp.
          </p>
          <p className="mb-3">
            <span className="font-medium">¿Y si el cliente no acepta el total real?</span> · Él ve el
            total real en el WhatsApp y en el seguimiento, y paga si está de acuerdo. Si no lo
            está, cancelen el pedido por WhatsApp como cualquier otro.
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
          <p className="mb-3">
            <span className="font-medium">¿El lector de etiquetas sirve en Mesas?</span> · No por
            ahora: la lectura de etiquetas de balanza está sólo en el Mostrador (en Mesas se pesa
            con el botón Pesar o a mano).
          </p>
          <p className="mb-3">
            <span className="font-medium">¿Y si escaneo dos etiquetas del mismo producto?</span> ·
            Entran como dos líneas separadas, igual que en el supermercado (el ticket muestra cada
            etiqueta). Los precios por volumen igual suman todos los kilos del mismo producto.
          </p>
          <p className="mb-3">
            <span className="font-medium">¿Qué pasa si no me coincide el formato?</span> · El
            probador te dice cuántos dígitos espera y avisa si el código no cumple el prefijo o el
            dígito verificador. Probá con “Detectar formato” o ajustá los campos hasta que la
            etiqueta se lea bien.
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
