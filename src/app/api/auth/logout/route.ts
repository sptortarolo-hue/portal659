import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("sb-access-token", "", { httpOnly: true, path: "/", maxAge: 0 });
  response.cookies.set("sb-refresh-token", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}