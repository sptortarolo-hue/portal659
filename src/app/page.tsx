import { NeighborhoodGrid } from "@/components/neighborhoods/neighborhood-grid";

export default function HomePage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <section className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          conectaMOS
        </h1>
        <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
          Marketplace hiperlocal. Conecta con lo que necesitás en tu barrio:
          productos, servicios, mano de obra y comida.
        </p>
      </section>
      <NeighborhoodGrid />
    </main>
  );
}