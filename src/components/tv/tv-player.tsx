"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TvCanvas } from "./tv-canvas";
import { TvHeader } from "./tv-header";
import { TvHero } from "./tv-hero";
import { TvSlideView } from "./tv-slide";
import { TvTicker } from "./tv-ticker";
import { TvPosterStage } from "./tv-poster-stage";
import { TvSplitStage } from "./tv-split-stage";
import { TvQrHighlight } from "./tv-qr-highlight";
import { TvQrColumn } from "./tv-qr-column";
import { TvClosed } from "./tv-closed";
import { TV_FONT } from "./tv-themes";
import { buildSlides, TV_CANVAS, type TvItemRef, type TvPosterRef } from "@/lib/tv-layout";
import {
  buildColumnSlots,
  buildHeroSlots,
  columnSlotSeconds,
  heroSlotSeconds,
  nextSlotLabels,
} from "@/lib/tv-rotation";
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
  /** Slot del destacado en escena (clásico: producto o QR). */
  const [heroSlotIdx, setHeroSlotIdx] = useState(0);
  /** Slot de la columna 9:16 en escena (split: destacado, poster o QR). */
  const [colSlotIdx, setColSlotIdx] = useState(0);
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

  // --- Geometría: clásico (banner arriba) vs split (columna 9:16 izquierda) ---
  // En split no hay banner de destacados: esos 320px se liberan para la columna
  // izquierda, así que la fila de contenido crece y las columnas se angostan.
  const split = snap.config.layout === "split";

  // QR de pedidos online: lo genera el server (dataUrl) y es un DESTACADO más:
  // en el clásico rota en el banner superior y en el split en la columna 9:16.
  // "cerrado" = solo en la pantalla de local cerrado; "abierto" = nunca ahí.
  const qrInRotation = !!snap.qr && snap.config.qr?.mode !== "cerrado";
  const qrSeconds = Math.max(5, snap.config.qr?.seconds ?? 12);
  const heroSeconds = Math.max(5, snap.config.hero?.seconds ?? 10);

  const tickerH = snap.config.ticker.enabled && snap.config.ticker.text.trim() ? TICKER_H : 0;
  const contentH =
    TV_CANVAS.h -
    TV_CANVAS.safeY * 2 -
    HEADER_H -
    (!split && (snap.hero.length > 0 || qrInRotation) ? HERO_H : 0) -
    tickerH;
  /** Ancho de la columna 9:16 (alto de la fila × 9/16) y de la grilla derecha. */
  const stageW = split ? Math.round((contentH * 9) / 16) : 0;
  const gridW = split
    ? TV_CANVAS.w - TV_CANVAS.safeX * 2 - stageW - 32
    : TV_CANVAS.w - TV_CANVAS.safeX * 2;
  /** Split fuerza 2 columnas (la derecha es angosta; 3 o 4 achatarían la letra). */
  const columns = split ? 2 : snap.config.columns;

  const posters: TvPosterRef[] = useMemo(
    () =>
      (snap.config.posters || []).map((p) => ({
        url: p.url,
        type: p.type === "video" ? "video" : "image",
        durationSec: p.durationSec || 5,
        orientation: p.orientation === "portrait" ? "portrait" : "landscape",
        // Destino en split: lo elige el comercio. Sin dato → según orientación.
        placement:
          p.placement === "column" || p.placement === "fullscreen"
            ? p.placement
            : p.orientation === "portrait"
              ? "column"
              : "fullscreen",
      })),
    // Clave estable: si no, cada poll de 30s genera un array nuevo y reinicia
    // el timer de rotación de slides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      (snap.config.posters || [])
        .map((p) => `${p.url}|${p.type}|${p.durationSec}|${p.orientation ?? ""}|${p.placement ?? ""}`)
        .join(","),
    ]
  );

  /**
   * Reparto de los posters según el diseño:
   * - classic: TODOS a pantalla completa (como hasta ahora);
   * - split: los que el comercio marcó "column" van a la columna 9:16 de la
   *   izquierda (entran sin recorte) y el resto a pantalla completa.
   */
  const columnPosters = useMemo(
    () => posters.filter((p) => p.placement === "column"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posters]
  );
  const takeoverPosters = useMemo(
    () => posters.filter((p) => p.placement !== "column"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [posters]
  );

  const slides = useMemo(
    () =>
      buildSlides({
        sections,
        columns,
        width: gridW,
        height: contentH,
        photoStyle,
        showDescriptions: snap.config.showDescriptions,
        // En split los posters verticales van en la columna (no como takeover
        // a pantalla completa); los horizontales sí se intercalan.
        posters: split ? takeoverPosters : posters,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, columns, gridW, contentH, photoStyle, snap.config.showDescriptions, posters, takeoverPosters, split]
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

  // --- Rotación del DESTACADO (banner clásico): productos + QR ------------
  // El QR de "Pedí online" es una pieza más de la rotación: entra al lugar
  // prominente de la pantalla, no perdida entre las slides de la carta.
  const heroSlots = useMemo(
    () => buildHeroSlots(snap.hero.length, qrInRotation, snap.config.hero?.rotate !== false),
    [snap.hero.length, qrInRotation, snap.config.hero?.rotate]
  );
  const heroSlot = heroSlots[heroSlotIdx % Math.max(1, heroSlots.length)] ?? null;
  /** Índice del producto en escena (undefined si el slot es el QR). */
  const heroProductIdx = heroSlot?.kind === "product" ? heroSlot.index : 0;
  const heroIsQr = heroSlot?.kind === "qr";
  useEffect(() => {
    if (heroSlots.length <= 1) return;
    const slot = heroSlots[heroSlotIdx % heroSlots.length];
    const ms = heroSlotSeconds(slot, { heroSeconds, qrSeconds }) * 1000;
    const id = setTimeout(() => setHeroSlotIdx((i) => (i + 1) % heroSlots.length), ms);
    return () => clearTimeout(id);
  }, [heroSlotIdx, heroSlots, heroSeconds, qrSeconds]);

  /** Los próximos slots de la rotación (chips "qué viene después"). */
  const heroNext = useMemo(
    () =>
      nextSlotLabels(heroSlots, heroSlotIdx % Math.max(1, heroSlots.length), 2, snap.hero || []),
    [heroSlots, heroSlotIdx, snap.hero]
  );

  // --- Columna del split: destacado + posters verticales + QR --------------
  // La columna 9:16 rota entre el destacado del comercio, sus posters
  // verticales y el QR de pedidos online.
  const splitPosters = split ? columnPosters : [];
  const columnSlots = useMemo(
    () => buildColumnSlots(splitPosters.length, qrInRotation && split),
    [splitPosters.length, qrInRotation, split]
  );
  const colSlot = columnSlots[colSlotIdx % Math.max(1, columnSlots.length)] ?? null;
  const posterSeconds = useMemo(() => splitPosters.map((p) => p.durationSec), [splitPosters]);
  useEffect(() => {
    if (columnSlots.length <= 1) return;
    const slot = columnSlots[colSlotIdx % columnSlots.length];
    const ms = columnSlotSeconds(slot, { heroSeconds, qrSeconds, posterSeconds }) * 1000;
    const id = setTimeout(() => setColSlotIdx((i) => (i + 1) % columnSlots.length), ms);
    return () => clearTimeout(id);
  }, [colSlotIdx, columnSlots, heroSeconds, qrSeconds, posterSeconds]);

  // Al publicar (cambia la versión) el destacado vuelve al primero.
  useEffect(() => {
    setHeroSlotIdx(0);
    setColSlotIdx(0);
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
  // QR en la pantalla de cerrado: solo si el server lo generó y el modo lo
  // permite en cerrado ("siempre" | "cerrado"). En "abierto" no aparece acá.
  const qrInClosed = !!snap.qr && snap.config.qr?.mode !== "abierto" ? snap.qr.dataUrl : null;
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
            <TvClosed
              name={snap.vendor.name}
              logoUrl={snap.vendor.logoUrl}
              hoursText={snap.vendor.hoursText}
              qrDataUrl={qrInClosed}
            />
          </div>
        ) : (
          <>
            {/* Clásico: banner de destacados arriba. En split el destacado
                vive rotando dentro de la columna izquierda, sin banner.
                El QR de "Pedí online" es un destacado más: cuando le toca
                rotar, el banner muestra su plantilla ancha. */}
            {!split && (snap.hero.length > 0 || qrInRotation) && (
              <div style={{ marginTop: 24 }}>
                {heroIsQr && snap.qr ? (
                  <TvQrHighlight
                    key="qr-highlight"
                    name={snap.vendor.name}
                    qrDataUrl={snap.qr.dataUrl}
                    durationSec={qrSeconds}
                  />
                ) : (
                  <TvHero
                    hero={snap.hero}
                    index={heroProductIdx}
                    next={heroNext}
                    upsell={snap.config.upsell}
                    upsellItem={upsellItem}
                  />
                )}
              </div>
            )}
            {/* Contenido: en split la columna 9:16 es ESTABLE (no se remonta
                con cada slide: si no, la foto del destacado parpadearía y se
                perdería el crossfade de la rotación). Solo la grilla derecha
                entra/sale con `tv-slide-enter`. */}
            <div className="flex min-h-0 flex-1 gap-8">
              {split && (
                <TvSplitStage
                  width={stageW}
                  slot={colSlot}
                  poster={splitPosters[0] ?? null}
                  posterFor={(i) => splitPosters[i] ?? null}
                  qrDataUrl={qrInRotation ? snap.qr?.dataUrl ?? null : null}
                  qrSeconds={qrSeconds}
                  hero={snap.hero}
                  index={heroProductIdx}
                  logoUrl={snap.vendor.logoUrl}
                  storeName={snap.vendor.name}
                  upsell={snap.config.upsell}
                  upsellItem={upsellItem}
                />
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
