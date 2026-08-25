"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <main className="container mx-auto px-4 py-20 max-w-md text-center">
      <div className="text-6xl mb-4">⚠️</div>
      <h1 className="font-display text-3xl font-semibold mb-4">
        Algo salió mal
      </h1>
      <p className="text-muted-foreground mb-2">
        Hubo un problema al cargar esta página.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground/60 mb-6 font-mono">
          Error: {error.digest}
        </p>
      )}
      <div className="flex gap-3 justify-center">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:bg-primary/90 transition-all active:scale-95"
        >
          Intentar de nuevo
        </button>
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Volver al inicio
        </a>
      </div>
    </main>
  );
}
