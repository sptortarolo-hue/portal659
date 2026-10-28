import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

export const dynamic = "force-dynamic";

/**
 * Monitor de salud del VPS para /admin/monitor.
 *
 * Lee el directorio que el cron del host (`scripts/health-monitor.sh`) monta
 * read-only en `/monitor` (ver docker-compose.yml). NO corre docker ni toca el
 * host: el cron es el único que escribe ahí y el panel sólo mira. Si el
 * directorio no existe (dev local, o el cron todavía no se instaló) responde
 * `ready: false` y la UI lo dice en vez de mostrar datos falsos.
 */
const MONITOR_DIR = process.env.MONITOR_DIR || "/monitor";
const STATUS_FILE = join(MONITOR_DIR, "status.json");
const LOG_FILE = join(MONITOR_DIR, "monitor.log");
const OUTAGES_FILE = join(MONITOR_DIR, "outages.log");

/** Nombre de forense válido: nada de `..` ni de rutas arbitrarias. */
const FORENSIC_RE = /^forensics-\d{8}-\d{6}\.log$/;

function safeJoin(name: string): string | null {
  if (!FORENSIC_RE.test(name)) return null;
  const full = join(MONITOR_DIR, name);
  return basename(full) === name ? full : null;
}

function readText(path: string, maxBytes = 400_000): string | null {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    return readFileSync(path, "utf8").slice(-maxBytes);
  } catch {
    return null;
  }
}

function tailLines(path: string, n: number): string[] {
  const raw = readText(path);
  if (!raw) return [];
  return raw.split("\n").filter((l) => l.trim()).slice(-n);
}

function listForenses(): Array<{ name: string; bytes: number; mtime: string }> {
  try {
    return readdirSync(MONITOR_DIR)
      .filter((f) => FORENSIC_RE.test(f))
      .map((f) => {
        const st = statSync(join(MONITOR_DIR, f));
        return { name: f, bytes: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 30);
  } catch {
    return [];
  }
}

/**
 * GET /api/admin/monitor[?lite=1][?forensic=<nombre>]
 *
 * - por defecto: estado + log + forenses + historial de cortes (la página)
 * - `?lite=1`: sólo el estado (el widget del dashboard principal)
 * - `?forensic=...`: el contenido de un forense
 */
export async function GET(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const url = new URL(request.url);

    // --- contenido de un forense ---------------------------------------------
    const forensic = url.searchParams.get("forensic");
    if (forensic) {
      const path = safeJoin(forensic);
      if (!path) {
        return NextResponse.json({ error: "Nombre de forense inválido" }, { status: 400 });
      }
      const body = readText(path, 300_000);
      if (body === null) {
        return NextResponse.json({ error: "Forense no encontrado" }, { status: 404 });
      }
      return NextResponse.json({ name: forensic, content: body });
    }

    // --- estado en vivo -------------------------------------------------------
    const raw = readText(STATUS_FILE, 60_000);
    if (!raw) {
      return NextResponse.json({
        ready: false,
        reason: "El monitor no está instalado en el VPS (o /monitor no está montado).",
      });
    }

    let status: any = null;
    try {
      status = JSON.parse(raw);
    } catch {
      return NextResponse.json({ ready: false, reason: "status.json ilegible" });
    }

    // El Widget del dashboard sólo necesita el semáforo.
    if (url.searchParams.get("lite") === "1") {
      return NextResponse.json({
        ready: true,
        status: {
          ts: status.ts,
          ts_unix: status.ts_unix,
          http: status.http,
          up: status.up,
          fails: status.fails,
          disk_pct: status.disk_pct,
          telegram_configured: status.telegram_configured,
        },
      });
    }

    return NextResponse.json({
      ready: true,
      status,
      log: tailLines(LOG_FILE, 60),
      forensics: listForenses(),
      outages: tailLines(OUTAGES_FILE, 20).map((line) => {
        // "2026-10-28T00:24:34Z | http=000 | fallos=3 | heal=SÍ — ... | arriba=NO | forense=x.log"
        const parts = line.split(" | ").map((p) => p.trim());
        return {
          raw: line,
          ts: parts[0] ?? "",
          http: (parts[1] ?? "").replace("http=", ""),
          fallos: (parts[2] ?? "").replace("fallos=", ""),
          heal: (parts[3] ?? "").replace("heal=", ""),
          arriba: (parts[4] ?? "").replace("arriba=", ""),
        };
      }),
    });
  } catch (e) {
    console.error("[api/admin/monitor] error:", e);
    return NextResponse.json({ error: "No se pudo leer el monitor" }, { status: 500 });
  }
}

/**
 * POST /api/admin/monitor  { action: "verify" | "test-alert" }
 *
 * - verify: pega a /api/health a través de nginx por la red interna de docker
 *   (`http://portal659-nginx` con el Host del sitio). Es el mismo camino que
 *   hace Cloudflare para no dar 521, salvo el TLS que resuelve el edge.
 * - test-alert: manda un mensaje de prueba a Telegram con las credenciales del
 *   contenedor (nunca se devuelven al cliente).
 */
export async function POST(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const action = body?.action;

    if (action === "verify") {
      const t0 = Date.now();
      let http = "000";
      let dbOk = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const r = await fetch("http://portal659-nginx/api/health", {
          headers: { Host: "www.portal659.com.ar" },
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timer);
        http = String(r.status);
        const j = await r.json().catch(() => null);
        dbOk = j?.db === true;
      } catch {
        http = "000";
      }
      return NextResponse.json({
        ok: http === "200",
        http,
        db_ok: dbOk,
        latency_ms: Date.now() - t0,
        via: "nginx → app → base de datos (red interna de docker)",
      });
    }

    if (action === "test-alert") {
      const token = process.env.TELEGRAM_BOT_TOKEN || "";
      const chatId = process.env.TELEGRAM_CHAT_ID || "";
      if (!token || !chatId) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID en el .env del VPS (los escribe el deploy desde los secrets de GitHub).",
          },
          { status: 400 }
        );
      }
      const text = `✅ Prueba de alerta desde /admin/monitor — ${new Date().toISOString()}\n\nSi estás leyendo esto, el monitor de Portal 659 puede avisarte.`;
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || j?.ok !== true) {
          return NextResponse.json(
            { ok: false, error: j?.description ?? `Telegram respondió ${r.status}` },
            { status: 400 }
          );
        }
        return NextResponse.json({ ok: true });
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, error: String(e?.message ?? e) },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ error: "action inválida (verify|test-alert)" }, { status: 400 });
  } catch (e) {
    console.error("[api/admin/monitor] POST error:", e);
    return NextResponse.json({ error: "No se pudo ejecutar la acción" }, { status: 500 });
  }
}
