// Ventanas de reserva (modelo Fudo, client-safe: sin imports de pg).
//
// - Ventana de ocupación (para solapes): [reserved_at, reserved_at + duration]
// - Ventana de bloqueo (mesa bloqueada): [reserved_at - lead, reserved_at + tolerancia]
//   (Fudo pinta/bloquea desde 15 min antes hasta que pasa la tolerancia).

export const DEFAULT_LEAD_MIN = 15;
export const DEFAULT_TOLERANCE_MIN = 15;
export const DEFAULT_DURATION_MIN = 120;

export type ReservationLike = {
  reserved_at: string;
  duration_min?: number | null;
  status: string;
};

export type ReservationConfig = {
  lead_min?: number | null;
  tolerance_min?: number | null;
};

export function normReservationConfig(cfg?: ReservationConfig | null): {
  lead: number;
  tolerance: number;
} {
  const lead = Math.max(0, Math.min(180, Math.round(Number(cfg?.lead_min) || DEFAULT_LEAD_MIN)));
  const tolerance = Math.max(
    0,
    Math.min(180, Math.round(Number(cfg?.tolerance_min) || DEFAULT_TOLERANCE_MIN))
  );
  return { lead, tolerance };
}

export function occupancyEnd(startMs: number, durationMin?: number | null): number {
  const dur = Math.max(
    15,
    Math.min(720, Math.round(Number(durationMin) || DEFAULT_DURATION_MIN))
  );
  return startMs + dur * 60000;
}

/** Ventana de bloqueo de una reserva (ms epoch). */
export function blockWindow(
  r: ReservationLike,
  cfg?: ReservationConfig | null
): { start: number; end: number } {
  const { lead, tolerance } = normReservationConfig(cfg);
  const at = new Date(r.reserved_at).getTime();
  return { start: at - lead * 60000, end: at + tolerance * 60000 };
}

export type ReservationTimeState = "blocked" | "upcoming" | "expired" | "done";

/** Estado temporal de una reserva respecto a `now`. */
export function reservationTimeState(
  r: ReservationLike,
  cfg?: ReservationConfig | null,
  now: number = Date.now()
): ReservationTimeState {
  if (r.status !== "pendiente") return "done";
  const w = blockWindow(r, cfg);
  if (now < w.start) return "upcoming";
  if (now <= w.end) return "blocked";
  return "expired";
}

export function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
