"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/** Contador hasta medianoche del día local, usado como apoyo del header de ofertas. */
export function OfferCountdown() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  let label = "--:--:--";
  if (now) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const total = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
    const pad = (n: number) => String(n).padStart(2, "0");
    label = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  }

  return (
    <span className="pv2-chip pv2-chip-muted whitespace-nowrap" aria-label={`Las ofertas terminan en ${label}`}>
      <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      Termina en <span className="tabular-nums font-bold">{label}</span>
    </span>
  );
}
