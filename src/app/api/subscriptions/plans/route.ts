import { NextResponse } from "next/server";
import { queryMany } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const plans = await queryMany(
    `SELECT * FROM plans ORDER BY sort ASC`
  );
  return NextResponse.json({ plans });
}