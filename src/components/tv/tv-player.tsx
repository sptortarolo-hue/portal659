"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TvCanvas } from "./tv-canvas";
import { TvHeader } from "./tv-header";
import { TvHero } from "./tv-hero";
import { TvSlideView } from "./tv-slide";
import { TvTicker } from "./tv-ticker";
import { TvPosterStage } from "./tv-poster-stage";
import { TvClosed } from "./tv-closed";
import { TV_FONT } from "./tv-themes";
import { buildSlides, TV_CANVAS, type TvItemRef, type TvPosterRef } from "@/lib/tv-layout";
import type { TvItem, TvSnapshot } from "@/lib/tv-snapshot";
import type { TvTheme } from "@/lib/tv-config";

const HEADER_H = 118;
const HERO_H = 320;
const TICKER_H = 92;
/** Anti burn-in: corrije 8px cada minuto en cualquier TV. */
const SHIFT_MS = 60000;
/** Recarga preventiva: las TVs barran mucho tiempo abiertas. */
const RELOAD_MS = 6 * 60 * 60 * 1000;

type Props = {
  snapshot: TvSnapshot;
  token: string;
  /** "live" = pantalla del comercio (SSE + heartbeat + cache offline); "preview" = panel. */
  mode: "live" | "preview";
  vertical?: string | null;
  debug?: boolean;
  /** Ajustar al contenedor padre (preview del panel). */
  fitParent?: boolean;
};

export function TvPlayer({ snapshot, token, mode, vertical, debug = false, fitParent = false }: Props) {
  const [snap, setSnap] = useState<TvSnapshot>(snapshot);
  const [idx, setIdx] = useState(0);
  /** Índice de la oferta que se muestra en el banner. */
  const [heroIdx, setHeroIdx] = useState(0);
  const [online, setOnline] = useState(true);
  const [shifted, setShifted] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const versionRef = useRef(snapshot?.version ?? 0);

  // --- Contenido a layout: los mismos campos que estima el motor -------------
  const photoStyle = snap.config.photoStyle;
  const sections = useMemo(
    () =>
      snap.sections.map((s) => ({
        id: s.id,
        name: s.name,
        items: s.items.map((i) => ({
          id: i.id,
          name: i.name,
          desc: snap.config.showDescriptions ? i.desc : null,
          hasPhoto: !!i.imageUrl,
        })) as TvItemRef[],
      })),
    // Firma estable del contenido: el poll de 30s devuelve arrays nuevos y,
    // sin esto, se reconstruiría el layout y se reiniciaría la rotación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      `${snap.config.showDescriptions ? 1 : 0}`,
      snap.sections
        .map((s) => `${s.id}:${s.items.map((i) => `${i.id}/${i.name}/${i.desc ?? ""}/${i.imageUrl ? 1 : 0}`).join("|")}`)
        .join("~"),
    ]
  );

  const contentH =
    TV_CANVAS.h -
    TV_CANVAS.safeY * 2 -
    HEADER_H -
    (snap.hero.length > 0 ? HERO_H : 0) -
    (snap.config.ticker.enabled && snap.config.ticker.text.trim() ? TICKER_H : 0);

  const posters: TvPosterRef[] = useMemo(
    () =>
      (snap.config.posters || []).map((p) => ({
        url: p.url,
        type: p.type === "video" ? "video" : "image",
        durationSec: p.durationSec || 5,
      })),
    // Clave estable: si no, cada poll de 30s genera un array nuevo y reinicia
    // el timer de rotación de slides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(snap.config.posters || []).map((p) => `${p.url}|${p.type}|${p.durationSec}`).join(",")]
  );

  const slides = useMemo(
    () =>
      buildSlides({
        sections,
        columns: snap.config.columns,
        width: TV_CANVAS.w - TV_CANVAS.safeX * 2,
        height: contentH,
        photoStyle,
        showDescriptions: snap.config.showDescriptions,
        posters,
      }),
    [sections, snap.config.columns, contentH, photoStyle, snap.config.showDescriptions, posters]
  );

  // Solo se reinicia la rotación cuando cambia la VERSIÓN publicada (el
  // comercio tocó "Publicar"). Antes se reseteaba con cada poll de 30s y la
  // TV volvía a la primera slide todo el tiempo.
  useEffect(() => {
    setIdx(0);
  }, [snap.version]);

  // --- Rotación de slides (cada slide usa su propia duración) -----------------
  useEffect(() => {
    if (slides.length <= 1) return;
    const cur = slides[Math.min(idx, slides.length - 1)];
    const dur = (cur?.poster ? cur.poster.durationSec : snap.config.slideSeconds) * 1000;
    const id = setTimeout(() => setIdx((i) => (i + 1) % slides.length), dur);
    return () => clearTimeout(id);
  }, [idx, slides, snap.config.slideSeconds]);

  // --- Rotación del banner de ofertas (timer PROPIO, independiente de las
  // slides): el destacado cambia solo aunque la carta se quede en la misma
  // slide. Con una sola oferta no hay rotación (no hay salto visual). -------
  const heroCount = snap.hero?.length ?? 0;
  const heroRotateOn = snap.config.hero?.rotate !== false && heroCount > 1;
  useEffect(() => {
    if (!heroRotateOn) return;
    const ms = Math.max(5, snap.config.hero?.seconds ?? 10) * 1000;
    const id = setInterval(() => setHeroIdx((i) => (i + 1) % heroCount), ms);
    return () => clearInterval(id);
  }, [heroRotateOn, heroCount, snap.config.hero?.seconds]);

  // Al publicar (cambia la versión) el banner vuelve a la primera oferta.
  useEffect(() => {
    setHeroIdx(0);
  }, [snap.version]);

  // --- Cache offline: la TV sigue mostrando la última carta sin internet -----
  useEffect(() => {
    if (mode !== "live") return;
    const key = `tv-snapshot:${token}`;
    const restore = localStorage.getItem(key);
    if (restore) {
      try {
        const cached = JSON.parse(restore) as TvSnapshot;
        if (cached && cached.version >= snap.version) setSnap(cached);
      } catch {
        /* cache corrupta: se ignora */
      }
    }
    try {
      localStorage.setItem(key, JSON.stringify(snap));
    } catch {
      /* storage lleno o deshabilitado: no rompe la pantalla */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, token, snap.version]);

  // --- Conexión / recarga / pixel shift -------------------------------------
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (mode !== "live") return;
    const id = setInterval(() => setShifted((s) => !s), SHIFT_MS);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    if (mode !== "live") return;
    const born = Date.now();
    const id = setInterval(() => {
      if (Date.now() - born > RELOAD_MS) window.location.reload();
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [mode]);

  // --- Reintento de datos cuando el SSE se cae ------------------------------
  useEffect(() => {
    if (mode !== "live") return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/pantalla/${token}`, { cache: "no-store" });
        if (!r.ok) return;
        const fresh = (await r.json()) as TvSnapshot;
        versionRef.current = fresh.version;
        setSnap(fresh);
        setReconnecting(false);
      } catch {
        setReconnecting(true);
      }
    }, 30000);
    return () => clearInterval(id);
  }, [mode, token]);

  // --- SSE: recarga al publicar un cambio de layout -------------------------
  useEffect(() => {
    if (mode !== "live") return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/pantalla/${token}/stream`);
      es.onmessage = async (ev) => {
        try {
          const data = JSON.parse(ev.data || "{}");
          if (typeof data?.version === "number" && data.version !== versionRef.current) {
            versionRef.current = data.version;
            const r = await fetch(`/api/pantalla/${token}`, { cache: "no-store" });
            if (r.ok) setSnap((await r.json()) as TvSnapshot);
          }
        } catch {
          /* mensaje inválido: se ignora */
        }
      };
    } catch {
      /* TV sin SSE: queda el polling de 30s */
    }
    return () => es?.close();
  }, [mode, token]);

  // --- Heartbeat: "pantalla conectada" en el panel --------------------------
  useEffect(() => {
    if (mode !== "live") return;
    const ping = () =>
      fetch(`/api/pantalla/${token}/ping`, { method: "POST" }).catch(() => {});
    ping();
    const id = setInterval(ping, 60000);
    return () => clearInterval(id);
  }, [mode, token]);

  const closed = snap.vendor.isOpen === false && snap.config.closedScreen;
  const slide = slides[Math.min(idx, Math.max(0, slides.length - 1))];
  // Duración de la slide actual: los posters tienen la suya.
  const slideDuration = slide?.poster ? slide.poster.durationSec : snap.config.slideSeconds;
  const upsellItem: TvItem | null = useMemo(() => {
    if (!snap.config.upsell.enabled) return null;
    const id = snap.config.upsell.productId;
    if (!id) return null;
    for (const s of snap.sections) {
      const hit = s.items.find((i) => i.id === id);
      if (hit) return hit;
    }
    return null;
  }, [snap]);

  return (
    <TvCanvas theme={(snap.theme as TvTheme) || "barrio"} debug={debug} offline={!online} fitParent={fitParent}>
      {/* Takeover publicitario: capa aparte que cubre el lienzo COMPLETO
          (1920x1080), por encima del header, el banner y la cinta. Va como
          hermano del contenido con padding (no dentro) para no respetar el
          área segura. */}
      {slide?.poster && (
        <TvPosterStage
          key={`poster-${slide.poster.url}`}
          poster={slide.poster}
          durationSec={slide.poster.durationSec}
          shifted={shifted}
        />
      )}
      <div
        className="flex h-full w-full flex-col"
        style={{
          padding: `${TV_CANVAS.safeY}px ${TV_CANVAS.safeX}px`,
          fontFamily: TV_FONT,
          transform: shifted ? "translate(8px, 8px)" : "translate(-8px, -8px)",
          transition: "transform 2s ease-in-out",
        }}
      >
        <TvHeader
          name={snap.vendor.name}
          logoUrl={snap.vendor.logoUrl}
          isOpen={snap.vendor.isOpen}
          daypartLabel={snap.daypartLabel}
          showClock={snap.config.showClock}
        />

        {closed ? (
          <div className="flex-1">
            <TvClosed name={snap.vendor.name} logoUrl={snap.vendor.logoUrl} hoursText={snap.vendor.hoursText} />
          </div>
        ) : (
          <>
            {snap.hero.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <TvHero
                  hero={snap.hero}
                  index={heroIdx}
                  upsell={snap.config.upsell}
                  upsellItem={upsellItem}
                />
              </div>
            )}
            <div key={idx} className="tv-slide-enter relative min-h-0 flex-1">
              {slide?.poster ? null : slide ? (
                <TvSlideView slide={slide} sections={snap.sections} photoStyle={photoStyle} vertical={vertical} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p style={{ fontSize: 44, color: "var(--tv-muted)" }}>
                    {snap.sections.length === 0
                      ? "Este local todavía no cargó su carta."
                      : "No hay productos para mostrar con estos filtros."}
                  </p>
                </div>
              )}
              {slides.length > 1 && (
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-4">
                  <div
                    className="h-[6px] flex-1 overflow-hidden rounded-full"
                    style={{ background: "var(--tv-scrim)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        background: "var(--tv-accent)",
                        animation: `tv-progress ${slideDuration}s linear forwards`,
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-0.5">
                    {slides.map((s, i) => (
                      <span
                        key={i}
                        className="rounded-full transition-all"
                        style={{
                          width: i === idx ? 26 : 9,
                          height: 9,
                          background: i === idx ? "var(--tv-accent)" : "var(--tv-muted)",
                          opacity: i === idx ? 1 : 0.45,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            {snap.config.ticker.enabled && <TvTicker text={snap.config.ticker.text} />}
          </>
        )}

        {reconnecting && (
          <div
            className="absolute right-6 bottom-6 rounded-full px-4 py-2"
            style={{ background: "var(--tv-card)", color: "var(--tv-muted)", fontSize: 24 }}
          >
            reconectando…
          </div>
        )}
      </div>
    </TvCanvas>
  );
}
