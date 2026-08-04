import { extractToken } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const accessToken = extractToken(request);
  return NextResponse.json({ accessToken: accessToken || null });
}
