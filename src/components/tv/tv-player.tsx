"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TvCanvas } from "./tv-canvas";
import { TvHeader } from "./tv-header";
import { TvHero } from "./tv-hero";
import { TvSlideView } from "./tv-slide";
import { TvTicker } from "./tv-ticker";
import { TvClosed } from "./tv-closed";
import { TV_FONT } from "./tv-themes";
import { buildSlides, TV_CANVAS, type TvItemRef, type TvPosterRef } from "@/lib/tv-layout";
import type { TvItem, TvSnapshot } from "@/lib/tv-snapshot";
import type { TvTheme } from "@/lib/tv-config";

const HEADER_H = 110;
const HERO_H = 300;
const TICKER_H = 90;
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
};

export function TvPlayer({ snapshot, token, mode, vertical, debug = false }: Props) {
  const [snap, setSnap] = useState<TvSnapshot>(snapshot);
  const [idx, setIdx] = useState(0);
  const [online, setOnline] = useState(true);
  const [shifted, setShifted] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const versionRef = useRef(snapshot.version);

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
    [snap.sections, snap.config.showDescriptions]
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
    [snap.config.posters]
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

  useEffect(() => {
    setIdx(0);
  }, [snap]);

  // --- Rotación de slides (cada slide usa su propia duración) -----------------
  useEffect(() => {
    if (slides.length <= 1) return;
    const cur = slides[Math.min(idx, slides.length - 1)];
    const dur = (cur?.poster ? cur.poster.durationSec : snap.config.slideSeconds) * 1000;
    const id = setTimeout(() => setIdx((i) => (i + 1) % slides.length), dur);
    return () => clearTimeout(id);
  }, [idx, slides, snap.config.slideSeconds]);

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
    <TvCanvas theme={(snap.theme as TvTheme) || "barrio"} debug={debug} offline={!online}>
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
                <TvHero hero={snap.hero} upsell={snap.config.upsell} upsellItem={upsellItem} />
              </div>
            )}
            <div key={idx} className="relative min-h-0 flex-1">
              {slide?.poster ? (
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-2xl">
                  {slide.poster.type === "video" ? (
                    <video
                      src={slide.poster.url}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={slide.poster.url} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
              ) : slide ? (
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
                <div
                  className="absolute bottom-0 left-0 h-1 rounded-full"
                  style={{
                    background: "var(--tv-accent)",
                    animation: `tv-progress ${snap.config.slideSeconds}s linear forwards`,
                  }}
                />
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
