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
  return (
    <span
      className="font-bold tabular-nums tracking-tight"
      style={{ fontSize: 40, color: "var(--tv-fg)" }}
    >
      {now}
    </span>
  );
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
 * Encabezado del tablero: marca + estado + hora.
 *
 * Antes era una fila de texto plano; ahora es el "chapa" del tablero: logo con
 * marco de acento, nombre con tracking amplio, estado con punto que late y la
 * hora en tipografía fuerte. Es lo primero que ve el cliente y define el
 * carácter del local.
 */
export function TvHeader({ name, logoUrl, isOpen, daypartLabel, showClock }: Props) {
  const open = isOpen !== false;
  return (
    <header className="relative flex items-center gap-6" style={{ height: 118 }}>
      {/* Marca: logo en cuadro con halo del acento + barra de color debajo. */}
      <div className="relative shrink-0">
        <div
          className="absolute -inset-2 rounded-[32px] tv-glow-pulse"
          style={{ background: "var(--tv-glow)", filter: "blur(14px)" }}
        />
        <div
          className="relative flex h-[92px] w-[92px] items-center justify-center overflow-hidden rounded-[26px]"
          style={{ background: "var(--tv-card)", boxShadow: "inset 0 0 0 2px var(--tv-line)" }}
        >
          {logoUrl ? (
            <ProductImage
              src={logoUrl}
              name={name}
              alt={name}
              className="h-full w-full object-cover"
              iconClassName="h-12 w-12"
              eager
            />
          ) : (
            <span className="font-display text-4xl font-black" style={{ color: "var(--tv-accent)" }}>
              {name.trim().charAt(0).toUpperCase() || "•"}
            </span>
          )}
        </div>
        <div
          className="absolute -bottom-2 left-1/2 h-[5px] -translate-x-1/2 rounded-full"
          style={{ width: 52, background: "var(--tv-accent)" }}
        />
      </div>

      <div className="min-w-0">
        <h1
          className="truncate font-display font-black leading-none tracking-tight"
          style={{ fontSize: 58 }}
        >
          {name}
        </h1>
        {daypartLabel && (
          <p
            className="mt-2 flex items-center gap-2 uppercase tracking-[0.28em]"
            style={{ fontSize: 23, color: "var(--tv-accent)" }}
          >
            <span
              className="inline-block h-[7px] w-[7px] rounded-full"
              style={{ background: "var(--tv-accent)" }}
            />
            {daypartLabel}
          </p>
        )}
      </div>

      <div className="ml-auto flex items-center gap-5">
        <span
          className="flex items-center gap-3 rounded-full px-6 py-3 font-semibold"
          style={{
            fontSize: 27,
            background: open ? "var(--tv-accent)" : "var(--tv-line)",
            color: open ? "var(--tv-accent-ink)" : "var(--tv-muted)",
          }}
        >
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{
              background: open ? "var(--tv-accent-ink)" : "var(--tv-muted)",
              boxShadow: open ? "0 0 0 0 rgba(0,0,0,0.35)" : undefined,
              animation: open ? "tv-glow-pulse 2.6s ease-in-out infinite" : undefined,
            }}
          />
          {open ? "Abierto ahora" : "Cerrado ahora"}
        </span>
        {showClock && (
          <div
            className="flex items-center gap-3 rounded-2xl px-5 py-2"
            style={{ background: "var(--tv-card)", boxShadow: "inset 0 0 0 2px var(--tv-line)" }}
          >
            <TvClock />
          </div>
        )}
      </div>
    </header>
  );
}
