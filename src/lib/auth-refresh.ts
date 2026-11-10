/**
 * Recuperación de sesión del lado cliente.
 *
 * Cuando el access token (7 días) vence con el panel abierto — el caso clásico
 * es el mostrador de una tablet que queda prendida — los fetch devuelven 401
 * "No autenticado". `fetchWithAuthRefresh` llama a POST /api/auth/refresh
 * (cookie sb-refresh-token, 30 días) una sola vez y reintenta la llamada
 * original; si el refresh también falla (logout-all, refresh vencido), la
 * respuesta 401 original llega igual para que cada pantalla decida el aviso.
 *
 * Compartir `refreshPromise` (single-flight) evita que N fetches 401 en el
 * mismo segundo disparen N refreshes (el último Set-Cookie pisaría al primero
 * con un token que ya fue reemplazado).
 */

let refreshPromise: Promise<boolean> | null = null;

/** Renueva la sesión. `true` = cookies nuevas emitidas. */
export function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", { method: "POST" })
      .then((res) => {
        if (!res.ok) return false;
        return res
          .json()
          .then((data: { ok?: boolean }) => data?.ok === true)
          .catch(() => false);
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * Fetch con auto-refresh: ante un 401 intenta renovar la sesión una vez y
 * reintentar. Mismo contrato que `fetch` (el llamado no cambia nada).
 */
export async function fetchWithAuthRefresh(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  const refreshed = await refreshSession();
  if (!refreshed) return res;
  return fetch(input, init);
}
