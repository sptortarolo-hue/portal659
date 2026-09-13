"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Beef,
  BookOpen,
  Carrot,
  Coffee,
  Croissant,
  Flower2,
  Gem,
  Sandwich,
  HeartPulse,
  Package,
  Pizza,
  Pill,
  Scissors,
  Shirt,
  ShoppingBag,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";

type Props = {
  src?: string | null;
  name: string;
  category?: string | null;
  vertical?: string | null;
  alt: string;
  className?: string;
  iconClassName?: string;
  /** Si es true, carga inmediata (sin lazy). Útil para imágenes above-the-fold. */
  eager?: boolean;
  /** Ajuste de la foto: cover (default) o contain (foto completa). */
  fit?: "cover" | "contain";
  /** Clases extra para el <img> de la foto (ej. transiciones). */
  imgClassName?: string;
};

const VERTICAL_COLORS: Record<string, { bg: string; fg: string }> = {
  gastronomia: { bg: "bg-[#ff6b4a]/15", fg: "text-[#ff6b4a]" },
  comercio: { bg: "bg-[#10b981]/15", fg: "text-[#10b981]" },
  servicio: { bg: "bg-[#0ea5e9]/15", fg: "text-[#0ea5e9]" },
  moda: { bg: "bg-[#8b5cf6]/15", fg: "text-[#8b5cf6]" },
  salud: { bg: "bg-[#ec4899]/15", fg: "text-[#ec4899]" },
};

const DEFAULT_VERTICAL_ICON: Record<string, LucideIcon> = {
  gastronomia: UtensilsCrossed,
  comercio: ShoppingBag,
  servicio: Wrench,
  moda: Shirt,
  salud: HeartPulse,
};

type KeywordRule = {
  keywords: string[];
  icon: LucideIcon;
};

const CATEGORY_RULES: KeywordRule[] = [
  { keywords: ["pizza", "empanada", "tarta", "faina"], icon: Pizza },
  { keywords: ["hamburguesa", "burger", "lomito"], icon: Sandwich },
  { keywords: ["caf", "cafe", "café", "expresso", "latte", "tostado"], icon: Coffee },
  { keywords: ["pan", "factura", "torta", "pastel", "bizcocho", "medialuna"], icon: Croissant },
  { keywords: ["verdul", "verdura", "fruta", "verde"], icon: Carrot },
  { keywords: ["carnic", "carne", "parrill", "asado", "pollo"], icon: Beef },
  { keywords: ["flor", "planta", "ramo"], icon: Flower2 },
  { keywords: ["remera", "ropa", "indument", "calzado", "zapat", "talle", "vestido", "pantal"], icon: Shirt },
  { keywords: ["bijou", "accesorio", "joya", "collar", "anillo"], icon: Gem },
  { keywords: ["farmacia", "remedio", "medicam", "vitamina"], icon: Pill },
  { keywords: ["peluquer", "corte", "estetica", "estética", "depil", "barber", "manicur"], icon: Scissors },
  { keywords: ["ferreter", "herramient", "pintura", "electric", "plomer", "carpinter"], icon: Wrench },
  { keywords: ["librer", "libro", "cuaderno", "papel"], icon: BookOpen },
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function withRetryParam(s: string, attempt: number): string | null {
  if (attempt <= 0) return s.trim();
  if (/^(data|blob):/i.test(s.trim())) return null;
  const clean = s.trim();
  return clean + (clean.includes("?") ? "&" : "?") + `p659r=${attempt}`;
}

// Intento inicial + reintentos con espera creciente. Un fallo transitorio
// (red floja, 502 en ventana de deploy) nunca debe dejar el fallback pegado.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 2000];

function pickIcon(name: string, category?: string | null, vertical?: string | null): LucideIcon {
  const haystack = normalize(`${name} ${category ?? ""}`);
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => haystack.includes(normalize(k)))) {
      return rule.icon;
    }
  }
  if (vertical && DEFAULT_VERTICAL_ICON[vertical]) return DEFAULT_VERTICAL_ICON[vertical];
  return Package;
}

import { getProductEmojiImage } from "@/lib/product-emoji";

export function ProductImage({
  src,
  name,
  category,
  vertical,
  alt,
  className,
  iconClassName,
  eager = false,
  fit = "cover",
  imgClassName,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Si cambia la URL, volver a estado de carga (y cancelar reintentos viejos).
  useEffect(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    setLoaded(false);
    setFailed(false);
    setAttempt(0);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [src]);

  // La red volvió o la pestaña volvió a primer plano: si la foto quedó en
  // fallback, reintentar el ciclo desde cero en vez de dejarla pegada.
  useEffect(() => {
    function recover() {
      if (!src || loaded) return;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      setFailed(false);
      setAttempt(0);
    }
    function onVisible() {
      if (document.visibilityState === "visible") recover();
    }
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [src, loaded]);

  // Cierre de la carrera de hidratación: el <img> del HTML SSR arranca a
  // cargar antes de que React conecte los handlers. Si terminó antes (foto
  // cacheada / CDN / chica), el evento load/error se pierde y la foto quedaba
  // invisible para siempre (opacity-0). Acá se consulta el estado REAL del
  // <img> y se sincroniza la UI. El guard `src === currentSrc` evita leer el
  // estado de la imagen vieja mientras una nueva sigue en vuelo.
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !src || failed || loaded) return;
    if (!img.complete) return;
    if (img.src !== img.currentSrc) return;
    if (img.naturalWidth > 0) {
      setLoaded(true);
    } else {
      // Terminó y falló antes de hidratar: entra al ciclo de reintentos.
      handleError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, attempt, loaded, failed]);

  function handleError() {
    if (src && attempt + 1 < MAX_ATTEMPTS && withRetryParam(src, attempt + 1)) {
      // Reintento con anti-caché y espera: si era un fallo transitorio
      // (caché truncada, red, 502 de deploy), este ciclo lo supera solo.
      const delay = RETRY_DELAYS_MS[attempt] ?? 2000;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setAttempt((a) => a + 1), delay);
      return;
    }
    // Fallo definitivo: se loguea el src exacto para diagnosticar (host,
    // formato, archivo puntual) y se muestra el fallback (clicable: reintenta).
    console.warn("[img] no se pudo cargar:", src);
    if (src && /^https?:\/\//i.test(src.trim())) {
      // Telemetría mínima (fire-and-forget): cae en `docker logs` del VPS
      // vía [API:img-client], para detectar fotos problemáticas reales.
      fetch("/api/img-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: src.trim().slice(0, 500) }),
      }).catch(() => {});
    }
    setFailed(true);
  }

  // Reintento manual desde el fallback: limpia el estado y recarga la foto.
  function retryNow() {
    if (!src) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    setLoaded(false);
    setFailed(false);
    setAttempt(0);
  }

  // El fallback de una foto que falló es clicable (reintenta sin F5).
  const canRetry = failed && !!src;
  const retryProps = canRetry
    ? {
        onClick: retryNow,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            retryNow();
          }
        },
        role: "button" as const,
        tabIndex: 0,
        title: "Tocá para reintentar",
      }
    : {};

  if (src && !failed) {
    // Camino único: <img> directo, sin optimizador.
    // Las subidas ya vienen achicadas a 1200px al subir y /_next/image
    // demostró ser frágil (400 por validación, cachés, doble rama).
    // Un <img> clásico carga cualquier src válido sin validación previa.
    const shownSrc = withRetryParam(src, attempt) ?? src;
    // Si el caller trae posicionamiento propio no se agrega `relative`
    // (si no, pelean por `position` y se rompe el overlay).
    const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className ?? "");
    return (
      <div className={`${positioned ? "" : "relative "}overflow-hidden ${className ?? "w-full h-full"}`}>
        {!loaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
        <img
          ref={imgRef}
          src={shownSrc}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={handleError}
          className={`${fit === "contain" ? "object-contain" : "object-cover"} w-full h-full transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${imgClassName ?? ""}`}
        />
      </div>
    );
  }

  // Sin foto propia → imagen de referencia según nombre/categoría/vertical.
  const emojiPath = getProductEmojiImage(name, category, vertical);
  if (emojiPath) {
    return (
      <div
        {...retryProps}
        className={`${className ?? "w-full h-full"} flex items-center justify-center bg-accent/30 ${canRetry ? "cursor-pointer" : ""}`}
      >
        <img
          src={emojiPath}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain p-2"
        />
      </div>
    );
  }

  const Icon = pickIcon(name, category, vertical);
  const colors = (vertical && VERTICAL_COLORS[vertical]) || {
    bg: "bg-accent",
    fg: "text-muted-foreground",
  };
  return (
    <div
      {...retryProps}
      className={`${className ?? "w-full h-full"} flex items-center justify-center ${colors.bg} ${canRetry ? "cursor-pointer" : ""}`}
    >
      <Icon className={iconClassName ?? "h-10 w-10"} strokeWidth={1.5} />
    </div>
  );
}
