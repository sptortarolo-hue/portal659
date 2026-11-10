import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import {
  extractAllTokens,
  signAccessToken,
  signRefreshToken,
  setAuthSessionCookies,
  verifyAccessToken,
} from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * Renueva la sesión: recibe la cookie `sb-refresh-token` (30 días) y devuelve
 * un access nuevo (7 días) + refresh nuevo (30 días), reseteando ambas cookies.
 * Con esto una sesión vive hasta 30 días aunque el access venza a la semana —
 * antes ambas cookies guardaban el mismo token de 7d y un panel abierto
 * (mostrador) moría con "No autenticado" sin salida.
 *
 * Tolerante con sesiones previas a este circuito: la cookie de refresh vieja
 * guardaba el access de 7d (mismos claims) y también verifica.
 * Respeta `token_version` (logout-all mata las sesiones acá también) y
 * preserva el claim `staff` del token entrante (sesión de equipo).
 */
export const POST = withRateLimit(async (request: Request) => {
  // Varios candidatos: cookie host-only legacy + con Domain conviven (ver
  // extractAllTokens); se prueba cada uno hasta encontrar uno válido.
  let decoded = null;
  for (const token of extractAllTokens(request, "sb-refresh-token")) {
    const d = await verifyAccessToken(token);
    if (d?.userId) {
      decoded = d;
      break;
    }
  }
  if (!decoded) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const user = await queryOne<{
    id: string;
    email: string;
    role: string;
    token_version: number;
  }>(
    `SELECT id, email, role, token_version FROM profiles WHERE id = $1`,
    [decoded.userId]
  );
  if (!user || (decoded.tv ?? 1) !== user.token_version) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const claims = {
    id: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.token_version,
    // La sesión de equipo sigue siendo de equipo tras el refresh (el claim
    // es propiedad de la sesión, no del perfil — ver staff/login).
    staff: decoded.staff === true,
  };
  const accessToken = await signAccessToken(claims);
  const refreshToken = await signRefreshToken(claims);

  const response = NextResponse.json({
    ok: true,
    session: { access_token: accessToken, refresh_token: refreshToken },
  });
  setAuthSessionCookies(response, accessToken, refreshToken);
  return response;
}, { maxRequests: 30 });
