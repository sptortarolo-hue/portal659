"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TvScreenEditor, type ScreenApi } from "./tv-screen-editor";
import { TvGuideContent } from "./tv-guide-content";
import { TvRemoteButton } from "@/components/tv/tv-remote-button";
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
  /** ¿El portal habilitó el QR de pedidos online en las pantallas? */
  const [qrAllowed, setQrAllowed] = useState(true);
  /** ¿El usuario actual es admin del portal? (atajo a /admin/config) */
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScreenApi | null>(null);
  const [qrFor, setQrFor] = useState<ScreenApi | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  /** Guía de uso (modal). */
  const [showGuide, setShowGuide] = useState(false);
  /** Pantalla a la que se le manda el comando remoto (celular → tele). */
  const [remoteFor, setRemoteFor] = useState<ScreenApi | null>(null);
  /** Host del sitio (para armar links cortos en el cliente). */
  const [host, setHost] = useState("");

  useEffect(() => {
    setHost(window.location.host);
  }, []);

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
      setQrAllowed(j.qrAllowedByPortal !== false);
      setIsAdminUser(!!j.isAdmin);
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
  // Apunta a /tv/<token> (la central de mando del celular), no a la carta:
  // escaneado en el celular abre la pantalla con el botón "Enviar a la tele".
  useEffect(() => {
    if (!qrFor) return;
    let alive = true;
    (async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const data = await QRCode.toDataURL(`${window.location.origin}/tv/${qrFor.token}`, {
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

      {/* Guía de uso: siempre visible (3 pasos + el atajo de Android TV) y el
          botón abre el detalle por dispositivo. */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold">📺 Cómo usar la Pantalla TV</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tres pasos y tu carta queda en el televisor.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setShowGuide(true)}>
            Ver guía completa
          </Button>
        </div>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            { n: 1, t: "Creá la pantalla y tocá Publicar", d: "Sin publicar, la tele muestra la versión vieja." },
            { n: 2, t: "Escaneá el QR con el celular", d: "Desde ahí le mandás la carta a la tele." },
            { n: 3, t: "Abrilo en la tele", d: "En Chrome y dejalo en pantalla completa." },
          ].map((s) => (
            <li key={s.n} className="flex gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {s.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{s.t}</span>
                <span className="block text-xs text-muted-foreground">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          📱 <strong className="text-foreground">En Android TV:</strong> abrí el link en Chrome y tocá ⋮ →{" "}
          <strong className="text-foreground">Instalar app</strong>. Queda un ícono en la tele que abre la
          carta sola, a pantalla completa. Si tu tele no tiene esa opción, la última alternativa es{" "}
          <strong className="text-foreground">Fully Kiosk Browser</strong>.
        </p>
      </section>

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

              {/* Código corto: 4 caracteres para tipear en la tele. */}
              {s.shortCode && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1.5">
                  <span className="text-[11px] text-muted-foreground">Código corto:</span>
                  <code className="rounded bg-card px-1.5 py-0.5 font-mono text-sm font-bold tracking-widest">
                    {s.shortCode}
                  </code>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {host ? `${host}/t/${s.shortCode}` : `/t/${s.shortCode}`}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-2 text-[11px]"
                    onClick={async () => {
                      const link = `${window.location.origin}/t/${s.shortCode}`;
                      try {
                        await navigator.clipboard.writeText(link);
                        alert("Link corto copiado");
                      } catch {
                        /* sin permiso de portapapeles: el link está a la vista */
                      }
                    }}
                  >
                    Copiar link corto
                  </Button>
                </div>
              )}

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
                <Button size="sm" variant="outline" onClick={() => setRemoteFor(s)}>
                  📺 Enviar a la tele
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
          qrAllowedByPortal={qrAllowed}
          isAdmin={isAdminUser}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      <Modal open={!!qrFor} onClose={() => setQrFor(null)} title={`Abrir en la TV — ${qrFor?.name ?? ""}`}>
        <p className="text-sm text-muted-foreground">
          El QR se escanea con el <strong className="text-foreground">celular</strong>: ahí te aparece
          una pantalla para mandarle la carta a la tele (cambia sola en segundos) y los pasos para
          instalarla. En la tele, abrí el link de la carta y dejalo en pantalla completa.
        </p>
        {qrFor && !qrFor.published && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Esta pantalla tiene cambios sin publicar: la tele va a mostrar la versión anterior. Tocá{" "}
            <strong>Publicar</strong> antes de abrirla.
          </p>
        )}

        {/* Link de la carta (el que se abre en la tele) */}
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Link de la carta (para la tele)
        </p>
        <div className="mt-1 break-all rounded-lg bg-muted p-3 text-center text-sm font-medium">
          {qrFor ? `/pantalla/${qrFor.token}` : ""}
        </div>

        {/* Código corto (si hay) */}
        {qrFor?.shortCode && (
          <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Código corto (4 caracteres, ideal para tipear con el control remoto)
            </p>
            <div className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-muted p-3">
              <code className="font-mono text-lg font-bold tracking-[0.3em]">{qrFor.shortCode}</code>
              <span className="text-xs text-muted-foreground">
                {host ? `${host}/t/${qrFor.shortCode}` : `/t/${qrFor.shortCode}`}
              </span>
            </div>
          </>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
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
        <div className="mt-3 flex flex-wrap justify-center gap-2">
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
          {qrFor?.shortCode && (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                if (!qrFor?.shortCode) return;
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/t/${qrFor.shortCode}`);
                  alert("Link corto copiado");
                } catch {
                  /* sin permiso de portapapeles: el link está a la vista */
                }
              }}
            >
              Copiar link corto
            </Button>
          )}
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

      {/* Mando a distancia: el celular (o el panel) le pide a la tele que
          muestre esta pantalla. La tele cambia sola en ≤5s. */}
      <Modal
        open={!!remoteFor}
        onClose={() => setRemoteFor(null)}
        title={`Mandar a la tele — ${remoteFor?.name ?? ""}`}
      >
        {remoteFor && (
          <>
            <p className="text-sm text-muted-foreground">
              Le pedís a la tele que muestre esta carta ahora. El comando viaja por el canal de la
              pantalla y la tele cambia sola en los próximos segundos.
            </p>
            <div className="mt-4">
              <TvRemoteButton
                token={remoteFor.token}
                connected={
                  !!remoteFor.lastSeenAt &&
                  Date.now() - new Date(remoteFor.lastSeenAt).getTime() < 3 * 60 * 1000
                }
              />
            </div>
            <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              📱 También podés hacerlo desde el celular: escaneá el QR del panel y tocá{" "}
              <strong className="text-foreground">Enviar a la tele</strong>. Sirve para cambiar de
              carta sin ir al panel (por ejemplo, cuando la tele quedó en otra pantalla).
            </p>
          </>
        )}
      </Modal>

      {/* Guía completa */}
      <Modal
        open={showGuide}
        onClose={() => setShowGuide(false)}
        title="📺 Cómo usar la Pantalla TV"
        size="lg"
      >
        <TvGuideContent
          shortCode={screens.find((s) => s.shortCode)?.shortCode ?? null}
          shortUrl={
            host && screens.find((s) => s.shortCode)
              ? `${host}/t/${screens.find((s) => s.shortCode)!.shortCode}`
              : null
          }
        />
      </Modal>
    </div>
  );
}

export type { TvConfig };
