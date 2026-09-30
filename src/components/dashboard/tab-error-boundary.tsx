"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  tab: string;
};

type State = {
  hasError: boolean;
  message: string;
};

/**
 * Boundary de error por pestaña: si un tab crashea (ej: loop de renders),
 * se muestra un fallback acotado en vez de tumbar todo el dashboard.
 * El error también se reporta al servidor para diagnóstico.
 */
export class TabErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[tab-error-boundary] ${this.props.tab}:`, error);
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `tab-error-boundary: ${this.props.tab} ${msg.slice(0, 200)}`,
          stack: error instanceof Error ? (error.stack || "").slice(0, 1500) : null,
          pathname: typeof window !== "undefined" ? window.location.pathname : null,
        }),
      }).catch(() => {});
    } catch {
      /* noop */
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-sm font-medium text-red-700">
            ⚠️ Error en la pestaña «{this.props.tab}»
          </p>
          <p className="text-xs text-red-600 mt-1">
            El resto del panel sigue funcionando. Recargá la pestaña para reintentar.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="mt-3 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
