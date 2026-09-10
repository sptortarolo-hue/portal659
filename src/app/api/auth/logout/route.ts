import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  const isLocal = process.env.NODE_ENV === "development";
  const clearOpts = { httpOnly: true, path: "/", maxAge: 0, ...(!isLocal && { domain: ".portal659.com.ar" }) };
  response.cookies.set("sb-access-token", "", clearOpts);
  response.cookies.set("sb-refresh-token", "", clearOpts);
  return response;
}