import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, newDeviceId, deviceCookieOptions } from "@/lib/device";

export function proxy(request: NextRequest) {
  if (request.cookies.get(DEVICE_COOKIE)) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(DEVICE_COOKIE, newDeviceId(), deviceCookieOptions());
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js|icons|uploads/).*)", "/api/:path*"],
};