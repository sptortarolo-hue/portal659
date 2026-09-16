import { getUserId } from "@/lib/auth-utils";
import { queryMany, query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ notifications: [], unread: 0 });

  const notifications = await queryMany<Record<string, unknown>>(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [userId]
  );

  const unread = notifications.filter((n: any) => !n.read).length;
  return NextResponse.json({ notifications, unread });
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const { title, body: notifBody, type, link } = body;

  if (!title) return NextResponse.json({ error: "Título requerido" }, { status: 400 });

  await query(
    `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
    [userId, title, notifBody || null, type || "info", link || null]
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await request.json().catch(() => ({}));

  if (body.all) {
    await query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
  } else if (body.notificationId) {
    await query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [body.notificationId, userId]);
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json();
  const { notificationId, markAll } = body;

  if (markAll) {
    await query(`UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`, [userId]);
  } else if (notificationId) {
    await query(`UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`, [notificationId, userId]);
  }

  return NextResponse.json({ ok: true });
}