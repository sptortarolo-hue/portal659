import { Logo } from "@/components/brand/logo";
import { Captura } from "../captura";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Catálogo y menú | Portal 659",
  description:
    "Manual detallado: cómo cargar platos y productos, opciones, variantes, precios por volumen y promos.",
};

export default function CatalogoPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Catálogo y menú 📦</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Todo sobre tu carta: en gastronomía se llama <strong>Menú</strong> y cargás{" "}
        <strong>platos</strong>; en comercio y moda se llama <strong>Catálogo</strong> y cargás{" "}
        <strong>productos</strong>. Está en <span className="font-medium">Más → Menú/Catálogo</span>.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Cargar un plato o producto</h2>
          <p className="mb-3">
            Tocá <span className="font-medium">+ Plato / + Producto</span> y completá la ficha:
            nombre, precio, categoría, foto y descripción. Además, según tu rubro:
          </p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground mb-3">
            <li><span className="font-medium">Requiere elaboración</span> (gastronomía): si está apagado, el plato no pasa por cocina.</li>
            <li><span className="font-medium">Por peso</span> (comercio): el precio es por kilo y en mostrador se pesa con balanza.</li>
            <li><span className="font-medium">SKU / código de barras</span> (comercio): para buscar por escáner en el mostrador.</li>
            <li><span className="font-medium">De a N (pack)</span>: se vende solo en paquetes (ej. de a 6).</li>
            <li><span className="font-medium">Control de stock</span>: llevás cantidades y te avisa cuando queda poco.</li>
            <li><span className="font-medium">Costo de compra</span>: lo que te costó (lo actualiza solo cada compra).</li>
          </ul>
          <Captura base="catalogo-editor" alt="Ficha de plato nuevo" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Opciones para el cliente</h2>
          <p className="mb-3">
            En la solapa <span className="font-medium">Opciones</span> creás grupos como “Tamaño”,
            “Extras” o “Gustos”: cada opción puede sumar precio, ser obligatoria u opcional, y pedir
            un mínimo y máximo (ej. elegí 2 gustos). Después asignás cada grupo a uno o varios
            platos. Si vendés helado, el <span className="font-medium">kit heladería</span> te arma
            los tamaños 1/4, 1/2 y 1 kg con sus gustos de un solo toque.
          </p>
          <Captura base="catalogo-opciones" alt="Grupos de opciones" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Variantes color × talle (moda)</h2>
          <p className="mb-3">
            En ropa, activá <span className="font-medium">variantes</span> en la ficha: cargás una
            fila por combinación con su precio, promo, stock y SKU propios. Sumale la{" "}
            <span className="font-medium">guía de talles</span> y fotos por color para que el
            cliente elija sin preguntar.
          </p>
          <Captura base="moda-variantes" alt="Variantes color por talle" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Precios por volumen</h2>
          <p className="mb-3">
            En <span className="font-medium">Precios por volumen</span> armás grupos (“Promo pastas
            x2”) con tramos: a partir de N unidades, precio fijo o % off. Definís si el volumen
            calcula sobre la promo, si se suma el descuento en efectivo y cómo se cobran los extras.
          </p>
          <Captura base="catalogo-volumen" alt="Precios por volumen" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Promos</h2>
          <p className="mb-3">
            Poné <span className="font-medium">precio promo</span> en la ficha y el producto entra
            en oferta (podés marcarlo <span className="font-medium">solo promo</span> para sacarlo
            del menú, o <span className="font-medium">destacarlo hoy</span>). En{" "}
            <span className="font-medium">Configuración → Promos</span> armás la tarjeta para
            compartir en WhatsApp, con foto o compuesta automáticamente.
          </p>
          <Captura base="catalogo-promos" alt="Sección Promos" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Importar y etiquetas</h2>
          <p>
            Si venís con lista hecha, <span className="font-medium">importala desde Excel</span>{" "}
            (también acepta la planilla de FUDO con ingredientes y grupos) o{" "}
            <span className="font-medium">traé productos por WhatsApp</span>. En comercio además
            podés <span className="font-medium">imprimir etiquetas</span> con precio para la góndola.
          </p>
        </div>

        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            ¿Gastronomía? Costeá cada plato en{" "}
            <a className="text-primary font-medium" href="/manuales/preparacion-costos">Preparación y Costo</a>{" "}
            (o el resumen en <a className="text-primary font-medium" href="/manuales/gastronomia">Gastronomía</a>).
            ¿Stock? Mirá{" "}
            <a className="text-primary font-medium" href="/manuales/inventario">Inventario</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
