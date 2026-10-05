import { Logo } from "@/components/brand/logo";
import { Captura } from "../captura";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inventario y stock | Portal 659",
  description:
    "Manual detallado: proveedores, compras, conteos físicos, kardex y reposición sugerida.",
};

export default function InventarioPage() {
  return (
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Logo markClassName="h-9 w-9 text-primary" />
        <h1 className="font-display text-2xl font-semibold">Inventario y stock 📒</h1>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Para gastronomía, comercio y moda con plan Gestión: proveedores, compras, conteos, kardex
        y reposición. Está en <span className="font-medium">Más → Inventario</span>.
      </p>

      <section className="space-y-8 text-sm leading-relaxed text-foreground">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">1. Compras y proveedores</h2>
          <p className="mb-3">
            En la solapa <span className="font-medium">Compras</span> cargás cada compra a tu
            proveedor: fecha, comprobante y líneas con costo neto. Al guardar, la mercadería{" "}
            <span className="font-medium">entra a stock</span> y el costo se actualiza al último
            precio. Si borrás una compra, los costos vuelven a los valores anteriores. En{" "}
            <span className="font-medium">Proveedores</span> guardás sus datos y listas de precios
            para comparar.
          </p>
          <Captura base="comercio-inventario-compras" alt="Compras y proveedores" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">2. Conteos físicos</h2>
          <p className="mb-3">
            En <span className="font-medium">Conteos</span> abrís un conteo de todo el catálogo,
            cargás lo que contaste en la góndola (<span className="font-medium">físico</span>) al
            lado de lo que dice el sistema, y al <span className="font-medium">cerrar</span> se
            aplican las diferencias y se activa el control de stock.
          </p>
          <Captura base="comercio-inventario-conteos" alt="Conteos de stock" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">3. Kardex</h2>
          <p className="mb-3">
            El <span className="font-medium">Kardex</span> es el libro de movimientos: cada venta,
            compra, conteo, merma o devolución queda registrada con fecha y motivo. Filtrá por
            producto, motivo o fechas para auditar cualquier diferencia.
          </p>
          <Captura base="comercio-inventario-kardex" alt="Kardex de movimientos" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">4. Reposición sugerida</h2>
          <p className="mb-3">
            En <span className="font-medium">Reposición</span> ves qué comprar y cuánto: cruza tu
            stock y umbral con el promedio de ventas y te sugiere cantidades, con el mejor
            proveedor y precio. Podés imprimir la lista para llevarla al mayorista.
          </p>
          <Captura base="comercio-inventario-reposicion" alt="Reposición sugerida" />
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">5. Costo de compra vs food-cost</h2>
          <p>
            No los confundas: el <span className="font-medium">costo de compra</span> es lo que
            pagaste por cada producto (lo actualiza cada compra); el{" "}
            <span className="font-medium">food-cost</span> es lo que te cuesta elaborar cada plato
            según sus insumos, y vive en{" "}
            <a className="text-primary font-medium" href="/manuales/preparacion-costos">
              Preparación y Costo
            </a>{" "}
            (gastronomía).
          </p>
        </div>

        <div className="border-t border-border pt-6 mt-8">
          <p className="text-muted-foreground text-sm">
            Para cargar y organizar tus productos, mirá{" "}
            <a className="text-primary font-medium" href="/manuales/catalogo">Catálogo y menú</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
