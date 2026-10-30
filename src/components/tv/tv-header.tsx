"use client";

import { useEffect, useState } from "react";
import { TZ_AR } from "@/lib/open-hours";
import { ProductImage } from "@/components/product-image";

/** Reloj del local (hora real de Argentina, no la del navegador del TV). */
export function TvClock() {
  const [now, setNow] = useState<string>(() => fmt(new Date()));
  useEffect(() => {
    const id = setInterval(() => setNow(fmt(new Date())), 10000);
    return () => clearInterval(id);
  }, []);
  return <span style={{ fontSize: 34, color: "var(--tv-muted)" }}>{now}</span>;
}

function fmt(d: Date) {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: TZ_AR,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return "";
  }
}

type Props = {
  name: string;
  logoUrl: string | null;
  isOpen: boolean | null;
  daypartLabel: string | null;
  showClock: boolean;
};

/**
 * Encabezado fijo del tablero: marca + estado del local.
 * Es el detalle que hace que la pantalla se sienta "viva" (patrón QSR: arriba
 * a la derecha el estado y la hora).
 */
export function TvHeader({ name, logoUrl, isOpen, daypartLabel, showClock }: Props) {
  return (
    <header className="flex items-center gap-6" style={{ height: 110 }}>
      {logoUrl ? (
        <ProductImage
          src={logoUrl}
          name={name}
          alt={name}
          className="h-20 w-20 rounded-full"
          iconClassName="h-10 w-10"
          eager
        />
      ) : null}
      <div className="min-w-0">
        <h1 className="truncate font-bold leading-none" style={{ fontSize: 56 }}>
          {name}
        </h1>
        {daypartLabel && (
          <p className="mt-1 uppercase tracking-widest" style={{ fontSize: 24, color: "var(--tv-accent)" }}>
            {daypartLabel}
          </p>
        )}
      </div>

      <div className="ml-auto flex items-center gap-5">
        {isOpen === false ? (
          <span
            className="rounded-full px-5 py-2 font-semibold"
            style={{ fontSize: 28, background: "var(--tv-line)", color: "var(--tv-muted)" }}
          >
            Cerrado ahora
          </span>
        ) : (
          <span
            className="rounded-full px-5 py-2 font-semibold"
            style={{ fontSize: 28, background: "var(--tv-accent)", color: "var(--tv-accent-ink)" }}
          >
            Abierto ahora
          </span>
        )}
        {showClock && <TvClock />}
      </div>
    </header>
  );
}
