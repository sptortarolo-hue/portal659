"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  read: boolean;
  link: string | null;
  created_at: string;
};

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) {
          setAuthed(false);
          setLoading(false);
          return;
        }
        setAuthed(true);
        fetchNotifs();
        const interval = setInterval(fetchNotifs, 30000);
        return () => clearInterval(interval);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function fetchNotifs() {
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      if (data.notifications) {
        setNotifications(data.notifications);
        setUnread(data.unread || 0);
      }
    } catch { /* noop */ }
    setLoading(false);
  }

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  }

  if (loading || authed === false) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 text-muted-foreground hover:text-foreground"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 border border-border rounded-xl bg-card shadow-lg z-50 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-medium text-sm">Notificaciones</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                Marcar todo leído
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin notificaciones</p>
          ) : (
            notifications.map((n) => (
              <Link
                key={n.id}
                href={n.link || "#"}
                onClick={() => setOpen(false)}
                className={`block px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50 ${
                  !n.read ? "bg-primary/5" : ""
                }`}
              >
                <p className="text-sm font-medium leading-tight">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(n.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
