"use client";

import { useEffect, useState, useCallback } from "react";
import { Activity, RefreshCw, ShieldCheck, Send, ChevronLeft, FileText, ExternalLink, AlertTriangle, ServerCog } from "lucide-react";
import StatsCard from "@/components/admin/stats-card";

type ContainerRow = {
  name: string;
  status: string;
  health: string;
  restarts: number;
  oom: boolean;
  exit: number;
  error?: string;
};

type MonitorStatus = {
  ts: string;
  ts_unix: number;
  http: number;
  up: boolean;
  fails: number;
  disk_pct: number;
  mem_used_mb: number;
  mem_total_mb: number;
  swap_used_mb: number;
  swap_total_mb: number;
  load: string;
  uptime_sec: number;
  listening_80: boolean;
  listening_443: boolean;
  last_heal_unix: number;
  last_heal_ago_sec: number;
  heal_cooldown_sec: number;
  disk_heal_max_pct: number;
  max_fails: number;
  telegram_configured: boolean;
  containers: ContainerRow[];
};

type OutageRow = { raw: string; ts: string; http: string; fallos: string; heal: string; arriba: string };

type DiskDir = { path: string; mb: number };

type DiskDetail = {
  ts: string;
  ts_unix: number;
  docker: { images_mb: number; containers_mb: number; volumes_mb: number; cache_mb: number; cache_reclaimable_mb: number };
  dirs: DiskDir[];
  volumes: DiskDir[];
  journal_mb: number;
};

type Data = {
  ready: boolean;
  reason?: string;
  status?: MonitorStatus;
  log?: string[];
  forensics?: Array<{ name: string; bytes: number; mtime: string }>;
  outages?: OutageRow[];
  disk_detail?: DiskDetail | null;
  disk_detail_mtime_unix?: number | null;
};

/** Fetch con timeout: un endpoint colgado no puede congelar el panel. */
async function fetchJson(url: string, ms = 10000): Promise<any | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!r.ok) return { __error: r.status };
    return await r.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

function ago(unix?: number): string {
  if (!unix) return "nunca";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  if (s < 90) return `hace ${s}s`;
  if (s < 5400) return `hace ${Math.round(s / 60)}min`;
  if (s < 172800) return `hace ${Math.round(s / 3600)}h`;
  return `hace ${Math.round(s / 86400)}d`;
}

function gb(mb?: number): string {
  if (!mb || mb <= 0) return "—";
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** MB → texto corto: <1024 MB queda en MB; arriba, GB ( patrón de gb()). */
function fmtMb(mb?: number): string {
  if (!mb || mb <= 0) return "0";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

const DIR_LABEL: Record<string, string> = {
  "/": "Raíz (total del disco)",
  "/var/lib/docker": "Docker (todas sus capas)",
  "/var/lib": "/var/lib",
  "/var/log": "Logs del sistema",
};

function dirLabel(p: string): string {
  return DIR_LABEL[p] || p;
}

const CONTAINER_LABEL: Record<string, string> = {
  "portal659-app": "App (Next.js)",
  portal659: "App (Next.js)",
  "portal659-nginx": "nginx (borde)",
  "portal659-db": "PostgreSQL",
  "portal659-printbridge": "Print Bridge",
  "portal659-wabot": "Bot de WhatsApp",
};

export default function AdminMonitor() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Forense abierto
  const [openForensic, setOpenForensic] = useState<string | null>(null);
  const [forensicContent, setForensicContent] = useState<string | null>(null);
  const [loadingForensic, setLoadingForensic] = useState(false);

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true); else setLoading(true);
    const d = await fetchJson("/api/admin/monitor");
    if (d && !d.__error) setData(d);
    else setData((prev) => prev ?? { ready: false, reason: "No se pudo leer el monitor." });
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    // El cron corre cada 2 min: refrescar cada 30s es barato y mantiene vivo.
    const iv = setInterval(() => load(true), 30_000);
    return () => clearInterval(iv);
  }, [load]);

  async function verifyNow() {
    setBusy("verify"); setNotice(null);
    const r = await fetch("/api/admin/monitor", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify" }),
    }).then((x) => x.json().catch(() => null)).catch(() => null);
    if (r?.ok) {
      setNotice({ ok: true, text: `Borde OK: HTTP ${r.http} vía ${r.via} (${r.latency_ms} ms). Base de datos: ${r.db_ok ? "responde" : "NO responde"}.` });
    } else {
      setNotice({ ok: false, text: `El check no respondió 200: HTTP ${r?.http ?? "000"}. ${r?.error ?? ""}`.trim() });
    }
    setBusy(null);
    load(true);
  }

  async function testAlert() {
    setBusy("alert"); setNotice(null);
    const r = await fetch("/api/admin/monitor", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test-alert" }),
    }).then((x) => x.json().catch(() => null)).catch(() => null);
    setNotice(
      r?.ok
        ? { ok: true, text: "Alerta de prueba enviada. Si no llegó, mirá el chat id." }
        : { ok: false, text: r?.error ?? "No se pudo enviar la alerta de prueba." }
    );
    setBusy(null);
    load(true);
  }

  async function openForensicFile(name: string) {
    setOpenForensic(name);
    setForensicContent(null);
    setLoadingForensic(true);
    const r = await fetchJson(`/api/admin/monitor?forensic=${encodeURIComponent(name)}`);
    setForensicContent(r?.content ?? "No se pudo leer el forense.");
    setLoadingForensic(false);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Monitor del sistema</h1>
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data?.ready || !data.status) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Monitor del sistema</h1>
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-6 space-y-3">
          <p className="font-semibold text-amber-800 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Monitor no instalado
          </p>
          <p className="text-sm text-muted-foreground">
            {data?.reason ||
              "El directorio del monitor no está montado en el contenedor. Se instala con el deploy (cron /etc/cron.d/portal659-monitor + montaje /monitor:ro en docker-compose.yml)."}
          </p>
          <a
            href="https://github.com/sptortarolo-hue/portal659/actions/workflows/health-monitor.yml"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-amber-800 underline"
          >
            <ExternalLink className="h-4 w-4" /> Runs del monitor externo en GitHub Actions
          </a>
        </div>
      </div>
    );
  }

  const s = data.status;
  const diskTone = s.disk_pct >= (s.disk_heal_max_pct || 90) ? "text-red-600" : s.disk_pct >= 75 ? "text-amber-600" : "text-emerald-600";
  const up = s.up !== false && s.http === 200;
  const disk = data.disk_detail ?? null;
  const diskArr = disk ? [...disk.dirs, ...disk.volumes].map((x) => x.mb) : [];
  const diskMax = Math.max(1, ...diskArr);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Monitor del sistema</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Datos del host VPS escritos por el cron cada 2 min (no del contenedor). Última corrida {ago(s.ts_unix)}.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2 flex-shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {/* Semáforo grande */}
      <div className={`rounded-xl p-4 border ${up ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className={`inline-flex h-10 w-10 rounded-full items-center justify-center flex-shrink-0 ${up ? "bg-emerald-500 text-white" : "bg-red-500 text-white"}`}>
              {up ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <p className={`font-semibold ${up ? "text-emerald-800" : "text-red-800"}`}>
                {up ? "El sitio responde" : `El sitio no responde (HTTP ${s.http})`}
              </p>
              <p className="text-xs text-muted-foreground">
                {up
                  ? `nginx ${s.listening_80 && s.listening_443 ? "escucha en 80 y 443" : `escucha 80:${s.listening_80 ? "sí" : "no"} · 443:${s.listening_443 ? "sí" : "no"}`} · ${s.fails} fallo(s) seguidos`
                  : `Fallos seguidos: ${s.fails} (alerta y auto-heal a los ${s.max_fails})`}
              </p>
            </div>
          </div>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline text-muted-foreground flex-shrink-0"
          >
            Abrir el sitio
          </a>
        </div>
      </div>

      {!s.telegram_configured && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 text-sm text-amber-800">
          Las alertas de Telegram <strong>no están configuradas</strong>: el monitor mide, sana y guarda el forense, pero no avisa al chat. Falta
          <span className="font-mono mx-1">TELEGRAM_BOT_TOKEN</span>/
          <span className="font-mono mx-1">TELEGRAM_CHAT_ID</span>
          en los secrets de GitHub (runbook: <a href="/docs/monitoreo-portal659.md" className="underline">docs/monitoreo-portal659.md</a>).
        </div>
      )}

      {notice && (
        <div className={`rounded-xl border p-3 text-sm ${notice.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {notice.text}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Disco" value={`${s.disk_pct}%`} icon={ServerCog} color={diskTone} />
        <StatsCard
          label="Memoria"
          value={`${gb(s.mem_used_mb)} / ${gb(s.mem_total_mb)}`}
          icon={Activity}
          color="text-indigo-600"
        />
        <StatsCard
          label="Swap"
          value={s.swap_total_mb > 0 ? `${gb(s.swap_used_mb)} / ${gb(s.swap_total_mb)}` : "sin swap"}
          icon={Activity}
          color="text-violet-600"
        />
        <StatsCard label="Load" value={s.load || "—"} icon={Activity} color="text-blue-600" />
      </div>

      {/* Contenedores */}
      <div className="border border-border rounded-xl p-4 bg-card">
        <h2 className="font-medium text-sm mb-3">Contenedores</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Servicio</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Estado</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Health</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Reinicios</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">OOM</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Exit</th>
              </tr>
            </thead>
            <tbody>
              {(s.containers || []).map((c) => {
                const bad = c.status !== "running" || c.oom || (typeof c.restarts === "number" && c.restarts > 0);
                return (
                  <tr key={c.name} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium">{CONTAINER_LABEL[c.name] || c.name}</span>
                      <span className="text-xs text-muted-foreground ml-2 font-mono">{c.name}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === "running" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        {c.status}
                      </span>
                      {c.error && <span className="text-xs text-red-600 ml-2">{c.error}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">{c.health || "-"}</td>
                    <td className={`px-3 py-2 text-right text-xs ${c.restarts > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>{c.restarts}</td>
                    <td className={`px-3 py-2 text-right text-xs ${c.oom ? "text-red-600 font-bold" : "text-muted-foreground"}`}>{c.oom ? "SÍ" : "no"}</td>
                    <td className={`px-3 py-2 text-right text-xs ${c.exit && c.exit !== 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>{c.exit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(s.containers || []).length === 0 && (
          <p className="text-xs text-muted-foreground">El monitor no pudo leer los contenedores.</p>
        )}
      </div>

      {/* Análisis de disco */}
      <div className="border border-border rounded-xl p-4 bg-card">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-medium text-sm">Análisis de disco</h2>
          <span className="text-xs text-muted-foreground">
            {disk ? `Escaneado ${ago(data.disk_detail_mtime_unix ?? undefined)}` : "—"}
          </span>
        </div>
        {!disk ? (
          <p className="text-sm text-muted-foreground">
            Todavía sin datos: el análisis lo escribe el monitor en el host (desde el deploy que incluye esta versión). Aparece acá cuando corra la
            primera corrida.
          </p>
        ) : (
          <>
            {/* Docker en chips: es casi siempre lo más grande y lo más fácil de recuperar */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">🖼️ Imágenes Docker: {fmtMb(disk.docker?.images_mb)}</span>
              {(disk.docker?.containers_mb ?? 0) > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">📦 Capas de contenedores: {fmtMb(disk.docker.containers_mb)}</span>
              )}
              <span className="text-xs px-2 py-1 rounded-full bg-violet-50 text-violet-700">Storage (volúmenes): {fmtMb(disk.docker?.volumes_mb)}</span>
              <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700">Build cache: {fmtMb(disk.docker?.cache_mb)}</span>
              {(disk.docker?.cache_reclaimable_mb ?? 0) > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                  ♻️ Recuperable con prune: {fmtMb(disk.docker.cache_reclaimable_mb)}
                </span>
              )}
              {(disk.journal_mb ?? 0) > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">🧾 Journal de systemd: {fmtMb(disk.journal_mb)}</span>
              )}
            </div>

            {/* Barras por directorio (proporcionales al más grande) */}
            <div className="space-y-2">
              {(disk.dirs || []).map((d) => (
                <div key={d.path} className="flex items-center gap-3">
                  <span className="text-xs w-48 shrink-0 truncate font-mono" title={d.path}>
                    {dirLabel(d.path)}
                  </span>
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.max(2, Math.round((d.mb / diskMax) * 100))}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-20 text-right shrink-0">{fmtMb(d.mb)}</span>
                </div>
              ))}
              {(disk.volumes || []).length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground mt-3 mb-1">Volúmenes de datos de docker (por nombre):</p>
                  <div className="flex flex-wrap gap-2">
                    {(disk.volumes || []).map((v) => (
                      <span key={v.path} className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground font-mono">
                        {v.path}: {fmtMb(v.mb)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              Ojo: <span className="font-mono">/var/lib</span>, <span className="font-mono">/var/log</span> y <span className="font-mono">/opt</span>{" "}
              también están incluidos en la raíz — no los sumes. El colector corre cada 15 min (o cada 5 min con el disco ≥70%).
            </p>
          </>
        )}
      </div>

      {/* Auto-heal + acciones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-border rounded-xl p-4 bg-card">
          <h2 className="font-medium text-sm mb-3">Auto-heal</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Último intento</dt>
              <dd className="font-medium">{s.last_heal_unix > 0 ? ago(s.last_heal_unix) : "nunca se ejecutó"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Cooldown</dt>
              <dd className="font-medium">
                {s.heal_cooldown_sec}s {s.last_heal_ago_sec > 0 && s.last_heal_ago_sec < s.heal_cooldown_sec ? `(bloqueado, faltan ${Math.ceil((s.heal_cooldown_sec - s.last_heal_ago_sec) / 60)}min)` : "(libre)"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">No reinicia si el disco ≥</dt>
              <dd className="font-medium">{s.disk_heal_max_pct}%</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Alerta/heal a los</dt>
              <dd className="font-medium">{s.max_fails} fallos seguidos</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground mt-3">
            Espera 2 fallos seguidos (un redeploy puede tardar más que el cron), captura el forense <strong>antes</strong> de tocar nada y nunca hace
            <span className="font-mono mx-1">compose up --build</span>.
          </p>
        </div>

        <div className="border border-border rounded-xl p-4 bg-card">
          <h2 className="font-medium text-sm mb-3">Acciones</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={verifyNow}
              disabled={busy === "verify"}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${busy === "verify" ? "animate-spin" : ""}`} /> Verificar el borde ahora
            </button>
            <button
              onClick={testAlert}
              disabled={busy === "alert"}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Send className={`h-4 w-4 ${busy === "alert" ? "animate-pulse" : ""}`} /> Probar alerta de Telegram
            </button>
            <a
              href="https://github.com/sptortarolo-hue/portal659/actions/workflows/health-monitor.yml"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2"
            >
              <ExternalLink className="h-4 w-4" /> Monitor externo (cada 5 min)
            </a>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            "Verificar" pega a <span className="font-mono">/api/health</span> por la red interna vía nginx: es el mismo camino que hace Cloudflare
            para no dar 521, salvo el TLS que resuelve el edge. El auto-heal acá no se dispara a mano: corre solo, o lo fuerza el workflow de GitHub
            (<span className="font-mono">health-monitor.sh --force</span>).
          </p>
        </div>
      </div>

      {/* Cortes recientes */}
      <div className="border border-border rounded-xl p-4 bg-card">
        <h2 className="font-medium text-sm mb-3">Cortes registrados</h2>
        {(data.outages || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cortes registrados desde que el monitor está instalado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Corte (UTC)</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">HTTP</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Fallos</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Auto-heal</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Quedó arriba</th>
                </tr>
              </thead>
              <tbody>
                {(data.outages || []).slice().reverse().map((o, i) => (
                  <tr key={`${o.raw}-${i}`} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-xs font-mono whitespace-nowrap">{o.ts}</td>
                    <td className="px-3 py-2 text-xs">{o.http}</td>
                    <td className="px-3 py-2 text-right text-xs">{o.fallos}</td>
                    <td className="px-3 py-2 text-xs max-w-[24rem] truncate" title={o.heal}>{o.heal || "—"}</td>
                    <td className={`px-3 py-2 text-xs font-medium ${o.arriba === "SÍ" ? "text-emerald-600" : "text-red-600"}`}>{o.arriba}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Forenses */}
      <div className="border border-border rounded-xl p-4 bg-card">
        <h2 className="font-medium text-sm mb-3">Forenses de cortes</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Se capturan <strong>antes</strong> de la primera acción: si se reinicia, el estado que explica la caída ya se fue.
        </p>
        {(data.forensics || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hubo cortes (o el directorio está vacío).</p>
        ) : (
          <ul className="space-y-1">
            {(data.forensics || []).map((f) => (
              <li key={f.name}>
                <button
                  onClick={() => openForensicFile(f.name)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex items-center gap-2 font-mono text-xs min-w-0">
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{Math.round(f.bytes / 1024)} KB</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openForensic && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpenForensic(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="font-mono text-sm truncate">{openForensic}</h3>
              <button
                onClick={() => setOpenForensic(null)}
                className="rounded-full hover:bg-muted h-8 w-8 flex items-center justify-center text-muted-foreground flex-shrink-0"
                aria-label="Cerrar"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto px-4 py-3 text-[11px] leading-relaxed whitespace-pre-wrap font-mono break-words">
              {loadingForensic ? "Cargando…" : (forensicContent ?? "")}
            </pre>
          </div>
        </div>
      )}

      {/* Log */}
      <div className="border border-border rounded-xl p-4 bg-card">
        <h2 className="font-medium text-sm mb-3">Log del monitor</h2>
        {(data.log || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin entradas todavía.</p>
        ) : (
          <pre className="text-[11px] leading-relaxed font-mono max-h-72 overflow-auto whitespace-pre-wrap break-words bg-muted/50 rounded-lg p-3">
            {(data.log || [])
              .slice()
              .reverse()
              .join("\n")}
          </pre>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Runbook: <span className="font-mono">docs/monitoreo-portal659.md</span> · Los comandos a mano viven en el VPS:
        <span className="font-mono ml-1">/opt/portal659-monitor/health-monitor.sh --status</span>
      </p>
    </div>
  );
}
