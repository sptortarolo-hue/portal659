import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container mx-auto px-4 py-20 max-w-md text-center">
      <div className="text-6xl mb-4">🔍</div>
      <h1 className="font-display text-4xl font-semibold mb-4">
        Página no encontrada
      </h1>
      <p className="text-muted-foreground mb-8">
        Parece que esta página se mudó de barrio. No la encontramos en Portal 659.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-8 py-3 text-sm font-semibold hover:bg-primary/90 transition-all active:scale-95"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
