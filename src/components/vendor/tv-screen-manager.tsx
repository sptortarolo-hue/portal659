"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TvScreenEditor, type ScreenApi } from "./tv-screen-editor";
import type { TvConfig } from "@/lib/tv-config";

type Props = {
  /** Feature `screens` del plan: si no, se muestra el PlanLock (lo llama el panel). */
  enabled: boolean;
  maxScreens: number;
};

const REASON_LOCK = "Tu plan no incluye Pantalla TV. Está incluida en el plan Gestión integral.";

/**
 * Panel de la Pantalla TV: por cada pantalla muestra el estado de conexión
 * (heartbeat), el link/QR para abrirla en el TV, y las acciones
 * (editar con preview, publicar, rotar link, borrar).
 */
export function TvScreenManager({ enabled, maxScreens }: Props) {
  const [screens, setScreens] = useState<ScreenApi[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [max, setMax] = useState(maxScreens);
  const [sellsOnline, setSellsOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScreenApi | null>(null);
  const [qrFor, setQrFor] = useState<ScreenApi | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch("/api/vendor/tv-screens", { cache: "no-store" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.code === "plan_locked" ? REASON_LOCK : j?.error || "No se pudo cargar");
        setScreens([]);
        return;
      }
      const j = await r.json();
      setError(null);
      setScreens(j.screens || []);
      setCategories(j.categories || []);
      setSellsOnline(!!j.sellsOnline);
      setMax(Number(j.maxScreens ?? maxScreens));
    } catch {
      setError("Sin conexión con el servidor");
    }
  };

  useEffect(() => {
    if (enabled) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // QR del link: se genera al abrir el modal (la lib solo se carga ahí).
  useEffect(() => {
    if (!qrFor) return;
    let alive = true;
    (async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const data = await QRCode.toDataURL(`${window.location.origin}/pantalla/${qrFor.token}`, {
          width: 320,
          margin: 1,
          color: { dark: "#101623", light: "#ffffff" },
        });
        if (alive) setQrData(data);
      } catch {
        if (alive) setQrData(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [qrFor]);

  const create = async () => {
    const r = await fetch("/api/vendor/tv-screens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Pantalla ${screens.length + 1}` }),
    }).catch(() => null);
    if (r && r.ok) load();
    else if (r) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error || "No se pudo crear la pantalla");
    }
  };

  if (!enabled) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-sm font-semibold">📺 Pantalla TV</p>
        <p className="mt-1 text-sm text-muted-foreground">{REASON_LOCK}</p>
        <a href="/vendor/suscripcion" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
          Ver planes
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">📺 Pantalla TV</h2>
          <p className="text-sm text-muted-foreground">
            Mostrá tu carta en un televisor. Un link para abrir en la tele, sin computadora.
          </p>
        </div>
        <Button onClick={create} disabled={screens.length >= max}>
          + Agregar pantalla
        </Button>
      </div>

      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>}
      {screens.length >= max && (
        <p className="text-xs text-muted-foreground">
          Tu plan incluye {max} pantalla(s). Si necesitás otra, escribinos.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {screens.map((s) => {
          const online = !!s.lastSeenAt && Date.now() - new Date(s.lastSeenAt).getTime() < 3 * 60 * 1000;
          return (
            <div key={s.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {/* Estados con explicación: el "Sin señal" se confundía
                        con una falla — es solo que la tele no tiene la
                        página abierta (el heartbeat pega cada 60s). */}
                    <span
                      title={
                        online
                          ? "La tele tiene la página abierta y recibe los cambios al instante."
                          : "El navegador de la tele no pegó en los últimos 3 minutos. Abrí el link en la tele y dejalo abierto."
                      }
                      className={`cursor-help rounded-full border border-dashed px-2 py-0.5 font-medium ${
                        online
                          ? "border-green-300 bg-green-100 text-green-700"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {online ? "🟢 Conectada" : "⚪ Sin señal"}
                    </span>
                    {!s.published && (
                      <span
                        title="Todavía no tocaste Publicar: la tele muestra la última versión publicada (o nada si es la primera)."
                        className="cursor-help border-b border-dashed border-amber-400 text-amber-600"
                      >
                        Nunca publicada
                      </span>
                    )}
                    {s.published && s.unpublishedDraft && (
                      <span
                        title="Tenés cambios sin publicar: la tele sigue mostrando la versión anterior. Tocá Publicar."
                        className="cursor-help border-b border-dashed border-amber-400 text-amber-600"
                      >
                        Cambios sin publicar
                      </span>
                    )}
                    {s.published && !s.unpublishedDraft && (
                      <span
                        title="Lo que se ve en la tele es la última versión publicada."
                        className="cursor-help border-b border-dashed border-border text-muted-foreground"
                      >
                        Al día
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="mt-2 truncate rounded-lg bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                /pantalla/{s.token}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setEditing(s)}>
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const r = await fetch(`/api/vendor/tv-screens/${s.id}/publish`, { method: "POST" }).catch(() => null);
                    if (r && r.ok) load();
                  }}
                >
                  Publicar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQrFor(s);
                    setQrData(null);
                  }}
                >
                  Ver QR
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm("¿Rotar el link? La TV va a dejar de mostrar esta pantalla hasta que abras el link nuevo.")) return;
                    await fetch(`/api/vendor/tv-screens/${s.id}/token`, { method: "POST" }).catch(() => null);
                    load();
                  }}
                >
                  Rotar link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`¿Borrar "${s.name}"?`)) return;
                    await fetch(`/api/vendor/tv-screens/${s.id}`, { method: "DELETE" }).catch(() => null);
                    load();
                  }}
                >
                  Borrar
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <TvScreenEditor
          open
          screen={editing}
          categories={categories}
          sellsOnline={sellsOnline}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      <Modal open={!!qrFor} onClose={() => setQrFor(null)} title={`Abrir en la TV — ${qrFor?.name ?? ""}`}>
        <p className="text-sm text-muted-foreground">
          Abrí este link en el navegador de la tele (o usá el QR). Se actualiza sola cuando publiques cambios.
        </p>
        {qrFor && !qrFor.published && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Esta pantalla tiene cambios sin publicar: la tele va a mostrar la versión anterior. Tocá{" "}
            <strong>Publicar</strong> antes de abrirla.
          </p>
        )}
        <div className="mt-3 break-all rounded-lg bg-muted p-3 text-center text-sm font-medium">
          {qrFor ? `/pantalla/${qrFor.token}` : ""}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Dejalo abierto en la tele (pantalla completa): así muestra la carta al día y el pill pasa a{" "}
          <strong>Conectada</strong> en menos de 1 minuto.
        </p>
        <div className="mt-3 flex justify-center">
          {qrData ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrData} alt="QR" className="h-48 w-48" />
          ) : (
            <span className="text-xs text-muted-foreground">Generando QR…</span>
          )}
        </div>
        <div className="mt-3 flex justify-center gap-2">
          <Button
            size="sm"
            onClick={async () => {
              if (!qrFor) return;
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/pantalla/${qrFor.token}`);
                alert("Link copiado");
              } catch {
                /* sin permiso de portapapeles: el link está a la vista */
              }
            }}
          >
            Copiar link
          </Button>
          <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (!qrFor) return;
                    window.open(`${window.location.origin}/pantalla/${qrFor.token}`, "_blank", "noopener");
                  }}
                >
                  Probar en esta ventana
                </Button>
                <Button size="sm" variant="secondary" onClick={() => window.print()}>
            Imprimir
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export type { TvConfig };
