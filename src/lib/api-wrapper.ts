import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

type Handler = (request: Request, context?: any) => Promise<NextResponse>;

export function withRateLimit(
  handler: Handler,
  options: { maxRequests?: number; keyFn?: (req: Request) => string } = {}
) {
  const { maxRequests = 60, keyFn } = options;

  return async (request: Request, context?: any) => {
    const key = keyFn
      ? keyFn(request)
      : request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "anonymous";

    const { allowed, headers } = await checkRateLimit(key, maxRequests);

    if (!allowed) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intentá de nuevo en unos segundos." },
        { status: 429, headers }
      );
    }

    const response = await handler(request, context);
    for (const [k, v] of Object.entries(headers)) {
      response.headers.set(k, v);
    }
    return response;
  };
}
