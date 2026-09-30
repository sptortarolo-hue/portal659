"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Chunk de deploy viejo (HTML cacheado que referencia chunks ya borrados
  // del servidor): reset() no alcanza porque el chunk da 404. La salida es
  // recargar para obtener HTML + chunks frescos.
  const text = `${String(error?.message || error)} ${typeof error?.stack === "string" ? error.stack : ""}`;
  const isChunkError = /Loading chunk|ChunkLoadError|dynamically imported|failed to fetch dynamically|Element type is invalid/i.test(text);
  useEffect(() => {
    console.error("Route error:", error);
    // [API:client-error] para diagnosticar "Algo salió mal" reales.
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: String(error?.message || error),
          stack: typeof error?.stack === "string" ? error.stack : null,
          // React minifica: el componentStack NO. Con él se identifica el
          // componente del crash (ej: loop de efectos) sin el bundle dev.
          componentStack:
            typeof (error as any)?.cause?.componentStack === "string"
              ? (error as any).cause.componentStack
              : null,
          digest: error?.digest || null,
          pathname: typeof window !== "undefined" ? window.location.pathname : null,
        }),
      }).catch(() => {});
    } catch {
      /* noop */
    }
  }, [error]);

  return (
    <main className="container mx-auto px-4 py-20 max-w-md text-center">
      <div className="text-6xl mb-4">⚠️</div>
      <h1 className="font-display text-3xl font-semibold mb-4">
        Algo salió mal
      </h1>
      <p className="text-muted-foreground mb-2">
        {isChunkError
          ? "Hay una versión nueva de la app: recargá para actualizar."
          : "Hubo un problema al cargar esta página."}
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground/60 mb-6 font-mono">
          Error: {error.digest}
        </p>
      )}
      <div className="flex gap-3 justify-center">
        {isChunkError ? (
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:bg-primary/90 transition-all active:scale-95"
          >
            Recargar página
          </button>
        ) : (
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:bg-primary/90 transition-all active:scale-95"
          >
            Intentar de nuevo
          </button>
        )}
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
