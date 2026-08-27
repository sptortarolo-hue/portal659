import { NextResponse } from "next/server";
import { queryMany } from "@/lib/db";
import { getZoneSlug } from "@/lib/zone";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "7", 10);
  const limit = parseInt(searchParams.get("limit") || "5", 10);
  const zone = await getZoneSlug();

  const items = await queryMany(
    `SELECT * FROM get_most_ordered_products($1, $2, $3)`,
    [days, limit, zone]
  );

  return NextResponse.json({ items });
}