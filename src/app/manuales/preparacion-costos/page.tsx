import { Logo } from "@/components/brand/logo";
import { Captura } from "../captura";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Preparación y Costo | Portal 659",
  description:
    "Manual detallado: insumos con merma, preparación por plato, food-cost con semáforo, elaborados, presentaciones y ficha PDF.",
};

export default function PreparacionCostosPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Preparación y Costo 🧪</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Solo <strong>gastronomía con plan Gestión</strong>: conocé el costo real de cada plato y
        su food-cost. Está en <span className="font-medium">Más → Preparación y Costo</span>.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Qué es y cómo se usa</h2>
          <p className="mb-3">
            Cada plato tiene su <span className="font-medium">preparación</span>: la lista de
            insumos con cantidades netas (lo que queda en el plato). El sistema calcula solo el{" "}
            <span className="font-medium">costo</span>, el <span className="font-medium">food-cost %</span> y
            te avisa con un <span className="font-medium">semáforo</span> 🟢🟡🔴. El orden
            recomendado es: primero <span className="font-medium">insumos</span>, después la{" "}
            <span className="font-medium">preparación de cada plato</span>, y por último revisar el{" "}
            <span className="font-medium">semáforo</span>.
          </p>
          <Captura base="costos-preparacion" alt="Tab Preparación y Costo" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Cargar insumos</h2>
          <p className="mb-3">
            En la solapa <span className="font-medium">Insumos</span> tocá{" "}
            <span className="font-medium">+ Insumo</span> y cargá: nombre,{" "}
            <span className="font-medium">unidad base</span> (g, ml o u),{" "}
            <span className="font-medium">costo sin IVA</span> (con la ayuda $ ÷ cantidad del
            envase) y <span className="font-medium">% de merma</span> (el tipo de insumo la sugiere:
            carne 20%, verduras 12%, etc.). Si lo elaborás vos (ej. una salsa), tildá{" "}
            <span className="font-medium">Es elaborado 🧪</span>.
          </p>
          <Captura base="preparacion-insumos" alt="Biblioteca de insumos" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Armar la preparación del plato</h2>
          <p className="mb-3">
            En <span className="font-medium">Platos</span> elegí el plato y agregá una línea por
            insumo con su <span className="font-medium">cantidad neta</span> (la unidad se pone
            sola). Definí las <span className="font-medium">porciones que rinde</span> y mirá el{" "}
            <span className="font-medium">costo en vivo</span>: total, por porción, food-cost y{" "}
            <span className="font-medium">precio sugerido</span>. Si vendés bajo costo, te avisa en
            rojo. Guardá con <span className="font-medium">Crear preparación</span>.
          </p>
          <Captura base="preparacion-editor" alt="Editor de preparación" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Semáforo food-cost</h2>
          <p className="mb-3">
            🟢 Saludable, 🟡 Ajustar, 🔴 Revisar, según el % sobre el precio de venta. Si un plato
            queda en amarillo o rojo, subí el precio, bajá la merma o cambiá un insumo. Los umbrales
            se editan en <span className="font-medium">🚦 Semáforo → Editar</span> (por defecto
            30% y 35%).
          </p>
          <Captura base="preparacion-semaforo" alt="Semáforo editable" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Mantener con Compras</h2>
          <p>
            Cada compra que cargás en la solapa <span className="font-medium">Compras</span>{" "}
            actualiza los costos al último precio y recalcula todos los platos solos. Si borrás una
            compra, los costos vuelven a los anteriores. El detalle de proveedores e historial está
            en <a className="text-primary font-medium" href="/manuales/inventario">Inventario</a>.
          </p>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">6. Avanzado</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Elaborados con sub-preparación:</span>{" "}
              un insumo 🧪 lleva su propia preparación con rinde (ej. 2000 ml de salsa); su costo se
              prorratea en los platos que lo usan. Sin sub-preparación, se usa su costo manual.
            </li>
            <li>
              <span className="font-medium text-foreground">Otras presentaciones:</span> si la misma
              elaboración se vende entera y por porción, vinculá el otro producto con sus porciones
              y el costo se deriva solo.
            </li>
            <li>
              <span className="font-medium text-foreground">Ficha PDF:</span> descargá la ficha
              técnica del plato (ingredientes, brutos/netos, costos y food-cost) para tu cocina.
            </li>
          </ul>
        </div>

        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            Volvé a <a className="text-primary font-medium" href="/manuales/gastronomia">Gastronomía</a>,
            cargá tu <a className="text-primary font-medium" href="/manuales/catalogo">Catálogo y menú</a> o
            controlá tu <a className="text-primary font-medium" href="/manuales/inventario">Inventario</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
