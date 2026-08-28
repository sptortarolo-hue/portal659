import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "" });
}