"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";

type BotRow = {
  wa_phone: string | null;
  status: string;
  enabled: boolean;
  token: string | null;
  created_at: string;
  updated_at: string;
};

export default function VendorWaBotPage() {
  const router = useRouter();
  const [bot, setBot] = useState<BotRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/vendor/wa-bot");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error"); return; }
      setBot(data.bot || null);
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }

  // Polling del bot + del QR cada 3s (se actualiza solo si cambió).
  useEffect(() => {
    load();
    const t = setInterval(async () => {
      await load();
      await loadQr();
    }, 3000);
    const onFocus = () => { load(); loadQr(); };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadQr() {
    try {
      const res = await fetch("/api/wa/qr");
      const data = await res.json();
      if (res.ok && data.qr) {
        const dataUrl = await QRCode.toDataURL(data.qr, { width: 320, margin: 2 });
        setQrImage(dataUrl);
      } else {
        setQrImage(null);
      }
    } catch {
      setQrImage(null);
    }
  }

  async function generateToken() {
    if (!window.confirm("¿Generar un token nuevo? Si ya estabas usando el bot, el anterior deja de valer.")) return;
    setSaving(true);
    const res = await fetch("/api/vendor/wa-bot", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) { setBot({ ...(bot || { wa_phone: null, status: "unlinked", enabled: false, created_at: "", updated_at: "" }), token: data.token }); }
    setSaving(false);
  }

  async function toggleEnabled() {
    setSaving(true);
    await fetch("/api/vendor/wa-bot", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !bot?.enabled }),
    });
    await load();
    setSaving(false);
  }

  async function copyToken() {
    if (!bot?.token) return;
    try { await navigator.clipboard.writeText(bot.token); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  if (loading) {
    return <main className="container mx-auto px-4 py-10"><p className="text-muted-foreground">Cargando…</p></main>;
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-lg space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Bot de WhatsApp</h1>
        <Link href="/vendor/dashboard" className="text-sm text-primary hover:underline">← Volver</Link>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <a
        href="/downloads/portal-wa-link.apk?v=3"
        download
        className="flex items-center justify-center gap-2 rounded-xl border-2 border-primary bg-primary/10 px-4 py-3.5 text-base font-bold text-primary hover:bg-primary/20 transition-colors"
      >
        ⬇️ 1. Descargar la app "Portal Wa Link" (APK)
      </a>
      <p className="text-[11px] text-muted-foreground text-center -mt-3">
        Instalala en el celular del comercio (permitir &ldquo;fuentes desconocidas&rdquo;).
      </p>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Estado</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${bot?.enabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
            {bot?.enabled ? "Habilitado" : "Deshabilitado"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {bot?.status === "linked" ? "✅ Número vinculado" : bot?.token ? "🔑 Token generado — falta vincular el número en la app" : "⌛ Bot aún no configurado"}
        </div>
      </div>

      <button
        onClick={toggleEnabled}
        disabled={saving}
        className={`w-full rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
          bot?.enabled
            ? "border-red-300 bg-red-50 text-red-700"
            : "border-emerald-300 bg-emerald-50 text-emerald-700"
        }`}
      >
        {bot?.enabled ? "Desactivar bot" : "Activar bot"}
      </button>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">2. Token de vinculación</p>
            <p className="text-[11px] text-muted-foreground">Lo generás acá y lo pegás en la app del celular.</p>
          </div>
          <button
            onClick={generateToken}
            disabled={saving}
            className="text-sm font-semibold text-primary hover:underline whitespace-nowrap"
          >
            {bot?.token ? "Regenerar" : "Generar token"}
          </button>
        </div>

        {bot?.token && (
          <div className="flex items-center gap-2">
            <code className="text-xs break-all rounded-md bg-muted px-2 py-1.5 flex-1 select-all">{bot.token}</code>
            <button onClick={copyToken} className="text-xs rounded-md border border-border px-2 py-1 hover:bg-muted">
              {copied ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
        )}
      </div>

      {bot?.enabled && bot?.status !== "linked" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">3. Escaneá el QR para vincular</span>
          </div>
          {qrImage ? (
            <div className="flex flex-col items-center gap-2">
              <img src={qrImage} alt="QR de vinculación de WhatsApp" className="h-64 w-64 border border-border rounded-lg bg-white p-2" />
              <p className="text-[11px] text-muted-foreground text-center">
                En el celular: WhatsApp → Dispositivos vinculados → Vincular dispositivo → escaneá este QR.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">
              Esperando que la app se conecte y genere el QR… (mantené la app abierta en el celular)
            </p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        <p className="font-semibold mb-1">Cómo funciona</p>
        <ol className="list-decimal pl-4 space-y-0.5">
          <li>Descargá la app e instalala en el celular del comercio.</li>
          <li>Generá/copiá el token y pegálo en la app junto con la URL del relay.</li>
          <li>Tocá <strong>Iniciar</strong> en la app y acá aparece el QR para vincular.</li>
        </ol>
      </div>
    </main>
  );
}