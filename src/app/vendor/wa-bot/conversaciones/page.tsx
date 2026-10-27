"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Conv = {
  waId: string;
  lastText: string | null;
  lastAt: string;
  count: number;
  lastDirection: string;
};

type Msg = {
  id: string;
  direction: string;
  text: string;
  created_at: string;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function WaBotConversationsPage() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const loadConvs = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/wa-bot/conversations");
      if (res.status === 401) { window.location.href = "/login"; return; }
      const data = await res.json();
      if (data?.conversations) setConvs(data.conversations);
    } catch { /* poll sigue */ }
    finally { setLoading(false); }
  }, []);

  const loadMsgs = useCallback(async (waId: string) => {
    setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/vendor/wa-bot/conversations?waId=${encodeURIComponent(waId)}`);
      const data = await res.json();
      if (data?.messages) setMsgs(data.messages);
    } catch { /* */ }
    finally { setLoadingMsgs(false); }
  }, []);

  useEffect(() => {
    loadConvs();
    const t = setInterval(loadConvs, 15_000);
    return () => clearInterval(t);
  }, [loadConvs]);

  useEffect(() => {
    if (selected) loadMsgs(selected);
  }, [selected, loadMsgs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Conversaciones del bot</h2>
        <Link href="/vendor/wa-bot" className="text-sm text-muted-foreground hover:text-foreground">← Bot de WhatsApp</Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : convs.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">💬</div>
          <p className="text-muted-foreground text-sm">Sin conversaciones todavía</p>
          <p className="text-muted-foreground/70 text-xs mt-1">Los mensajes de tus clientes aparecerán acá</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Lista de conversaciones */}
          <div className="md:col-span-1 space-y-1 max-h-[60vh] overflow-y-auto">
            {convs.map((c) => (
              <button
                key={c.waId}
                type="button"
                onClick={() => setSelected(c.waId)}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${
                  selected === c.waId
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{c.waId}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{fmtDate(c.lastAt)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {c.lastDirection === "out" ? "➡️ " : "⬅️ "}{c.lastText || "—"}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{c.count} mensaje{c.count !== 1 ? "s" : ""}</p>
              </button>
            ))}
          </div>

          {/* Chat history */}
          <div className="md:col-span-2 rounded-xl border border-border bg-card p-3">
            {!selected ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                Seleccioná una conversación
              </div>
            ) : loadingMsgs ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-8 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : msgs.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">Sin mensajes</p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                      m.direction === "out"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      <p className={`text-[10px] mt-1 ${m.direction === "out" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {fmtDate(m.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
