import { NextResponse } from "next/server";

/**
 * Loguea un error de API en el server (visible en `docker logs` del VPS).
 * Las respuestas al cliente NO cambian: mismo status y mensaje de antes.
 */
export function logApiError(where: string, err: unknown): void {
  const msg =
    err instanceof Error
      ? `${err.message}${err.stack ? `\n${err.stack}` : ""}`
      : String(err);
  console.error(`[API:${where}]`, msg);
}

/** 500 genérico sin exponer detalles internos al cliente. */
export function apiError(where: string, err: unknown) {
  logApiError(where, err);
  return NextResponse.json({ error: "Error interno, intentá de nuevo" }, { status: 500 });
}
