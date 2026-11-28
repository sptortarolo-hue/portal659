"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Ruta interna a la que volver después del login (validada en el server). */
  next?: string | null;
  label?: string;
  /** Aclaración debajo del botón (ej. cuentas de comercio). */
  hint?: string;
};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

/**
 * Botón "Continuar con Google" (OAuth server-side, sin GSI/One Tap).
 * Se autooculta si el servidor no tiene las credenciales configuradas
 * (GET /api/auth/google/status), así el resto del login no cambia.
 */
export function GoogleButton({ next, label = "Continuar con Google", hint }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/google/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((data) => {
        if (alive) setEnabled(data?.enabled === true);
      })
      .catch(() => {
        if (alive) setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (enabled !== true) return null;

  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const href = safeNext
    ? `/api/auth/google?next=${encodeURIComponent(safeNext)}`
    : "/api/auth/google";

  return (
    <div className="space-y-3">
      <a
        href={href}
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GoogleIcon />
        <span>{label}</span>
      </a>
      {hint && <p className="text-center text-xs text-muted-foreground">{hint}</p>}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>o</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
