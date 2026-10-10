"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type BotRow = {
  vendor_id: string;
  store_name: string;
  slug: string | null;
  status: string | null; // linked | pairing | unlinked | null
  enabled: boolean;
  wa_phone: string | null;
  updated_at: string | null;
  connected: boolean;
  conversations: number;
  sentHour: number;
  sentDay: number;
  newChatsHour: number;
  inboundHour: number;
  inboundDay: number;
  handoffsHour: number;
  handoffsDay: number;
  lastSeen: number | null;
  cooling: boolean;
  coolingUntil: string | null;
};

type LlmInfo = {
  hasKey: boolean;
  ok: number;
  fail: number;
  cooldown: number;
  lastModel: string | null;
  lastAt: string | null;
} | null;

type BrainStats = { messages: number; replies: number; errors: number; loggedOut: number; limitsHit: number } | null;

type Limits = {
  maxMsgPerHour: number;
  maxMsgPerDay: number;
  maxNewChatsPerHour: number;
  replyDelayMinMs: number;
  replyDelayMaxMs: number;
} | null;

type FeedEvent = {
  ts: number;
  vendorId: string | null;
  store: string;
  kind: "in" | "out" | "send" | "handoff" | "limit" | "alert" | "system";
  waId: string;
  text: string;
};

const FEED_META: Record<FeedEvent["kind"], { icon: string; label: string; cls: string }> = {
  in: { icon: "⬅️", label: "cliente", cls: "text-foreground" },
  out: { icon: "➡️", label: "bot", cls: "text-emerald-600" },
  send: { icon: "📲", label: "app", cls: "text-sky-600" },
  handoff: { icon: "🙋", label: "handoff", cls: "text-violet-600" },
  limit: { icon: "⚠️", label: "límite", cls: "text-amber-600" },
  alert: { icon: "🚨", label: "alerta", cls: "text-red-600 font-medium" },
  system: { icon: "ℹ️", label: "estado", cls: "text-muted-foreground" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtAgo(ts: number | null): string {
  if (!ts) return "sin señal";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

function fmtCountdown(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function statusMeta(row: BotRow): { label: string; className: string } {
  if (row.status === "pairing") return { label: "🟡 Pareando (esperando QR)", className: "bg-amber-100 text-amber-800 border-amber-200" };
  if (row.status === "unlinked") return { label: "🔴 Desvinculado (LoggedOut)", className: "bg-red-100 text-red-700 border-red-200" };
  if (row.connected) return { label: "🟢 Conectado", className: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (row.status === "linked") return { label: "⚪ Vinculado, sin señal", className: "bg-muted text-muted-foreground border-border" };
  return { label: "⚪ Desconocido", className: "bg-muted text-muted-foreground border-border" };
}

/** Barra de uso vs tope anti-ban: verde <60%, ámbar <85%, rojo ≥85%. */
function UsageBar({ label, value, cap }: { label: string; value: number; cap: number | null }) {
  if (!cap) {
    return (
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((value / Math.max(1, cap)) * 100));
  const cls = pct >= 85 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${pct >= 85 ? "text-red-600" : pct >= 60 ? "text-amber-600" : ""}`}>
          {value}/{cap}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminBotsPage() {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [llm, setLlm] = useState<LlmInfo>(null);
  const [stats, setStats] = useState<BrainStats>(null);
  const [limits, setLimits] = useState<Limits>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [brainOk, setBrainOk] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [feedFilter, setFeedFilter] = useState<string>("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bots");
      const data = await res.json();
      if (data?.bots) {
        setBots(data.bots);
        setLlm(data.llm ?? null);
        setStats(data.stats ?? null);
        setLimits(data.limits ?? null);
        setFeed(Array.isArray(data.feed) ? data.feed : []);
        setBrainOk(Array.isArray(data.feed) && (data.stats != null || data.llm != null || data.limits != null));
      }
    } catch {
      // el poll sigue
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 15_000);
    return () => clearInterval(t);
  }, [fetchData]);

  async function toggleBot(row: BotRow) {
    if (togglingId) return;
    setTogglingId(row.vendor_id);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/bots/${row.vendor_id}/toggle`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setMsg(data?.error || "No se pudo cambiar el bot.");
        return;
      }
      setMsg(`${row.store_name}: bot ${data.enabled ? "ENCENDIDO" : "APAGADO"}.`);
      await fetchData();
    } catch {
      setMsg("Error de red.");
    } finally {
      setTogglingId(null);
    }
  }

  const conAlerta = bots.filter((b) => !b.enabled || b.status === "unlinked");
  const enfriando = bots.filter((b) => b.cooling);
  const conectados = bots.filter((b) => b.connected && b.enabled).length;
  const hoyIn = bots.reduce((s, b) => s + (b.inboundDay || 0), 0);
  const hoyOut = bots.reduce((s, b) => s + (b.sentDay || 0), 0);
  const hoyHandoffs = bots.reduce((s, b) => s + (b.handoffsDay || 0), 0);
  const feedFiltered = feedFilter ? feed.filter((e) => e.vendorId === feedFilter) : feed;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Bots de WhatsApp</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${brainOk ? "bg-emerald-500" : "bg-red-500"}`} />
            {brainOk ? "cerebro en línea" : "cerebro sin respuesta"}
          </span>
          <Link href="/admin" className="hover:text-foreground">← Dashboard</Link>
        </div>
      </div>

      {msg && <div className="rounded-xl border border-border bg-muted px-3 py-2 text-sm">{msg}</div>}

      {/* Salud del sistema */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">IA del bot</p>
          {llm ? (
            <div className="text-xs space-y-0.5">
              <p className={llm.ok > 0 ? "text-emerald-600 font-medium" : llm.fail > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}>
                {llm.hasKey ? `ok ${llm.ok} · fallas ${llm.fail}` : "Sin LLM_API_KEY (respuestas fijas)"}
              </p>
              <p className="text-muted-foreground">{llm.lastModel || "-"}{llm.lastAt ? ` · ${fmtDate(llm.lastAt)}` : ""}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">—</p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Cerebro (desde reinicio)</p>
          {stats ? (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>📥 {stats.messages} entrantes</span>
              <span>📤 {stats.replies} respuestas</span>
              <span className={stats.loggedOut > 0 ? "text-red-600" : ""}>🚨 {stats.loggedOut} desconexiones</span>
              <span className={stats.limitsHit > 0 ? "text-amber-600" : ""}>⚠️ {stats.limitsHit} topes</span>
              {limits && (
                <span className="w-full text-muted-foreground/70">
                  tope comercial: {limits.maxMsgPerHour}/h · {limits.maxMsgPerDay}/día · {limits.maxNewChatsPerHour} chats nuevos/h · tipeo {Math.round(limits.replyDelayMinMs / 100) / 10}-{Math.round(limits.replyDelayMaxMs / 100) / 10}s
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">—</p>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">Conectados</p>
          <p className="text-lg font-semibold">{conectados}<span className="text-xs text-muted-foreground">/{bots.length}</span></p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">Mensajes hoy</p>
          <p className="text-lg font-semibold">📥 {hoyIn} <span className="text-xs text-muted-foreground">· 📤 {hoyOut}</span></p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">Handoffs hoy</p>
          <p className="text-lg font-semibold">🙋 {hoyHandoffs}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">En enfriamiento</p>
          <p className={`text-lg font-semibold ${enfriando.length > 0 ? "text-amber-600" : ""}`}>🧊 {enfriando.length}</p>
        </div>
      </div>

      {/* Alertas */}
      {conAlerta.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          ⚠️ {conAlerta.length} comercio{conAlerta.length !== 1 ? "s" : ""} con el bot apagado o desvinculado: {conAlerta.map((b) => b.store_name).join(", ")}
        </div>
      )}
      {enfriando.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          🧊 Modo enfriamiento anti-ban activo (48h sin proactivos y topes a la mitad):{" "}
          {enfriando.map((b) => `${b.store_name} (${fmtCountdown(b.coolingUntil) || "poco"})`).join(", ")}. Guía: revisá avisos de Meta en la app ANTES de re-vincular.
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : bots.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">💬</div>
          <p className="text-muted-foreground text-sm">Ningún comercio tiene el bot de WhatsApp configurado todavía</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {bots.map((b) => {
            const meta = statusMeta(b);
            const capH = limits ? (b.cooling ? Math.ceil(limits.maxMsgPerHour / 2) : limits.maxMsgPerHour) : null;
            const capD = limits ? (b.cooling ? Math.ceil(limits.maxMsgPerDay / 2) : limits.maxMsgPerDay) : null;
            const capC = limits ? (b.cooling ? Math.ceil(limits.maxNewChatsPerHour / 2) : limits.maxNewChatsPerHour) : null;
            return (
              <div key={b.vendor_id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{b.store_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${meta.className}`}>{meta.label}</span>
                      {!b.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-red-100 text-red-700">APAGADO</span>}
                      {b.cooling && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800" title="Enfriamiento anti-ban: sin proactivos y topes a la mitad">
                          🧊 {fmtCountdown(b.coolingUntil) || "enfriando"}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {b.wa_phone || "-"} · 📡 {fmtAgo(b.lastSeen)} · 🧾 última actividad: {fmtDate(b.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {b.slug && (
                      <Link href={`/tienda/${b.slug}`} className="text-xs text-muted-foreground hover:text-underline" title="Ver micrositio">
                        🏪
                      </Link>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant={b.enabled ? "outline" : "default"}
                      disabled={togglingId === b.vendor_id}
                      onClick={() => toggleBot(b)}
                    >
                      {togglingId === b.vendor_id ? "…" : b.enabled ? "Apagar" : "Encender"}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <UsageBar label="📤 salida / hora" value={b.sentHour} cap={capH} />
                  <UsageBar label="📤 salida / día" value={b.sentDay} cap={capD} />
                  <UsageBar label="👥 chats nuevos / h" value={b.newChatsHour} cap={capC} />
                  <UsageBar label="📥 entrantes / día" value={b.inboundDay} cap={null} />
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>💬 {b.conversations} conversación{b.conversations !== 1 ? "es" : ""} activa{b.conversations !== 1 ? "s" : ""}</span>
                  <span>🙋 {b.handoffsDay} handoff{b.handoffsDay !== 1 ? "s" : ""} hoy</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Feed en vivo */}
      {feed.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actividad en vivo</p>
            <select
              value={feedFilter}
              onChange={(e) => setFeedFilter(e.target.value)}
              className="text-xs rounded-lg border border-border bg-background px-2 py-1"
            >
              <option value="">Todos los comercios</option>
              {bots.map((b) => (
                <option key={b.vendor_id} value={b.vendor_id}>{b.store_name}</option>
              ))}
            </select>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
            {feedFiltered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">Sin eventos de este comercio todavía</p>
            ) : (
              feedFiltered.map((e, i) => {
                const meta = FEED_META[e.kind] || FEED_META.system;
                return (
                  <div key={`${e.ts}-${i}`} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                    <span className="text-muted-foreground/70 shrink-0 tabular-nums">{new Date(e.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="shrink-0" title={meta.label}>{meta.icon}</span>
                    <span className="min-w-0">
                      <span className="text-muted-foreground">{e.store}</span>
                      {" — "}
                      <span className={meta.cls}>{e.text || meta.label}</span>
                      {e.waId && <span className="text-muted-foreground/60"> · {e.waId}</span>}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
