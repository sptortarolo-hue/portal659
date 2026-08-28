import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { endpoint, p256dh, auth } = body || {};

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Suscripción incompleta" }, { status: 400 });
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM push_subscriptions WHERE endpoint = $1 LIMIT 1`,
    [endpoint]
  );

  if (existing) {
    await query(
      `UPDATE push_subscriptions SET user_id = $1, p256dh = $2, auth = $3, updated_at = now() WHERE id = $4`,
      [user.id, p256dh, auth, existing.id]
    );
  } else {
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = now()`,
      [user.id, endpoint, p256dh, auth]
    );
  }

  return NextResponse.json({ ok: true });
}