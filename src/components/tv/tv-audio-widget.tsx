"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TvAudio } from "@/lib/tv-config";

/**
 * Widget de música para la Pantalla TV: suena música del comercio mientras
 * se ve la carta. Es un componente único para los tres proveedores:
 *
 * - stream  → <audio> con la URL directa (https), con play/pause y mute.
 * - spotify → iframe embed de Spotify (requiere cuenta Premium en la tele).
 * - youtube → iframe embed (video/playlist/vivo).
 *
 * Chrome no permite audio con sonido sin un gesto del usuario: por eso el
 * stream arranca con un botón "▶ Activar música" la primera vez.
 */
function spotifyEmbedUrl(url: string): string | null {
  const clean = url.trim();
  try {
    const u = new URL(clean);
    const host = u.hostname.replace(/^www\./, "").replace(/^open\./, "");
    if (host.includes("spotify.com") && u.pathname.startsWith("/embed/")) {
      return `https://open.spotify.com${u.pathname}`;
    }
    // /intl-es/playlist/xyz o /playlist/xyz → /embed/playlist/xyz
    const m = u.pathname.match(/\/(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/);
    if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator`;
    return null;
  } catch {
    return null;
  }
}

function youtubeEmbedUrl(url: string): string | null {
  const clean = url.trim();
  try {
    const u = new URL(clean);
    const host = u.hostname.replace(/^www\./, "").replace(/^music\./, "music.");
    const embed = (id: string) => `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&autoplay=1`;
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id ? embed(id) : null;
    }
    if (host === "youtube.com" && u.pathname.startsWith("/embed/")) {
      return `https://www.youtube.com${u.pathname}${u.search}`;
    }
    const shorts = u.pathname.match(/\/(shorts|live)\/([\w-]{6,})/);
    if (shorts) return embed(shorts[2]);
    const list = u.searchParams.get("list");
    if (list) {
      return `https://www.youtube.com/embed/videoseries?list=${list}&rel=0&modestbranding=1&autoplay=1`;
    }
    const v = u.searchParams.get("v");
    if (v) return embed(v);
    return null;
  } catch {
    return null;
  }
}

const BOX: React.CSSProperties = {
  position: "absolute",
  right: 24,
  bottom: 104,
  zIndex: 30,
  borderRadius: 18,
  background: "var(--tv-card)",
  boxShadow: "inset 0 0 0 2px var(--tv-line), 0 18px 44px rgba(0,0,0,0.35)",
  color: "var(--tv-fg)",
  overflow: "hidden",
  maxWidth: 340,
};

export function TvAudioWidget({ audio }: { audio: TvAudio | undefined }) {
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const el = useRef<HTMLAudioElement | null>(null);

  const embedUrl = useMemo(() => {
    if (!audio) return null;
    if (audio.provider === "spotify") return spotifyEmbedUrl(audio.url);
    if (audio.provider === "youtube") return youtubeEmbedUrl(audio.url);
    return null;
  }, [audio]);

  const volume = muted ? 0 : Math.max(0, Math.min(1, (audio?.volume ?? 70) / 100));

  useEffect(() => {
    if (el.current) el.current.volume = volume;
  }, [volume]);

  if (!audio?.enabled) return null;
  const url = audio.url?.trim();
  const label = audio.label?.trim() || "Música del local";

  // Sin URL: hay interruptor encendido pero nadie cargó nada todavía.
  if (!url) {
    return (
      <div style={{ ...BOX, padding: "18px 22px" }}>
        <p style={{ fontSize: 22, color: "var(--tv-muted)" }}>🎵 {label}</p>
        <p style={{ fontSize: 16, marginTop: 6, color: "var(--tv-muted)" }}>
          Falta cargar el link del audio en el panel (Pantalla TV → Audio).
        </p>
      </div>
    );
  }

  /* ---------------- Stream directo (<audio>) ---------------- */
  if (audio.provider === "stream") {
    return (
      <div style={{ ...BOX, display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" }}>
        <audio ref={el} src={url} loop preload="none" />
        {!started ? (
          <button
            type="button"
            onClick={() => {
              el.current?.play().then(
                () => {
                  setStarted(true);
                  setPlaying(true);
                },
                () => setStarted(false)
              );
            }}
            style={{
              border: "none",
              borderRadius: 999,
              background: "var(--tv-accent)",
              color: "var(--tv-accent-ink)",
              fontSize: 26,
              fontWeight: 800,
              padding: "14px 22px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ▶ Activar música
          </button>
        ) : (
          <button
            type="button"
            aria-label={playing ? "Pausar música" : "Reanudar música"}
            onClick={() => {
              if (playing) el.current?.pause();
              else el.current?.play().catch(() => {});
              setPlaying((p) => !p);
            }}
            style={{
              border: "none",
              borderRadius: 999,
              background: "var(--tv-accent)",
              color: "var(--tv-accent-ink)",
              width: 64,
              height: 64,
              fontSize: 30,
              cursor: "pointer",
            }}
          >
            {playing ? "❚❚" : "▶"}
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 22, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ♪ {label}
          </p>
          <p style={{ fontSize: 15, color: "var(--tv-muted)" }}>Radio / stream</p>
        </div>
        <button
          type="button"
          aria-label={muted ? "Activar sonido" : "Silenciar"}
          onClick={() => setMuted((m) => !m)}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--tv-fg)",
            fontSize: 28,
            cursor: "pointer",
            padding: 4,
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>
    );
  }

  /* ---------------- Spotify (iframe embed) ---------------- */
  if (audio.provider === "spotify") {
    if (!embedUrl) {
      return (
        <div style={{ ...BOX, padding: "18px 22px" }}>
          <p style={{ fontSize: 22, color: "var(--tv-muted)" }}>🎵 {label}</p>
          <p style={{ fontSize: 16, marginTop: 6, color: "var(--tv-muted)" }}>
            El link de Spotify no es válido. Pegá el link de una playlist (open.spotify.com/playlist/…).
          </p>
        </div>
      );
    }
    return (
      <div style={{ ...BOX }}>
        <iframe
          src={embedUrl}
          title={label}
          width={320}
          height={152}
          frameBorder={0}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          style={{ display: "block", background: "transparent", border: 0 }}
        />
      </div>
    );
  }

  /* ---------------- YouTube (iframe embed) ---------------- */
  if (!embedUrl) {
    return (
      <div style={{ ...BOX, padding: "18px 22px" }}>
        <p style={{ fontSize: 22, color: "var(--tv-muted)" }}>🎵 {label}</p>
        <p style={{ fontSize: 16, marginTop: 6, color: "var(--tv-muted)" }}>
          El link de YouTube no es válido. Pegá el link de un video, vivo o playlist.
        </p>
      </div>
    );
  }
  return (
    <div style={{ ...BOX }}>
      <iframe
        src={embedUrl}
        title={label}
        width={340}
        height={191}
        frameBorder={0}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        style={{ display: "block", background: "transparent", border: 0 }}
      />
    </div>
  );
}
