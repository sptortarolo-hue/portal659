"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
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
  /** Sizes para el srcset (default: tarjetas). El hero usa "100vw". */
  sizes?: string;
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

/**
 * Normaliza el src para el optimizador: si es una URL absoluta del MISMO
 * origen (las subidas se guardan absolutas), la pasa a relativa. Las
 * relativas siempre validan, sin importar protocolo/host/mayúsculas.
 */
function toOptimizableSrc(src: string): string {
  const clean = src.trim();
  if (typeof window === "undefined" || !/^https?:\/\//i.test(clean)) return clean;
  try {
    const u = new URL(clean);
    if (u.host.toLowerCase() === window.location.host.toLowerCase()) {
      return u.pathname + u.search;
    }
  } catch {
    // URL malformada: se devuelve tal cual y el onError muestra el fallback.
  }
  return clean;
}

/**
 * True si el src es una subida del portal (/uploads/...) del mismo origen.
 * Esas fotos se sirven DIRECTO con <img> clásico: ya vienen achicadas a 1200px
 * al subir y el optimizador (/_next/image) las rechazaba con 400.
 */
function isDirectUpload(src: string): boolean {
  const clean = src.trim();
  if (/^(data|blob):/i.test(clean)) return false;
  if (clean.startsWith("/uploads/")) return true;
  if (typeof window !== "undefined" && /^https?:\/\//i.test(clean)) {
    try {
      const u = new URL(clean);
      if (
        u.host.toLowerCase() === window.location.host.toLowerCase() &&
        u.pathname.startsWith("/uploads/")
      ) {
        return true;
      }
    } catch {
      // URL malformada: no es directa.
    }
  }
  return false;
}

/**
 * Parametro anti-caché para el reintento. Solo http(s) y rutas: los
 * data:/blob: se romperían si les agregamos query.
 */
function withRetryParam(s: string): string | null {
  if (/^(data|blob):/i.test(s.trim())) return null;
  const clean = s.trim();
  return clean + (clean.includes("?") ? "&" : "?") + "p659r=1";
}

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
  sizes,
  fit = "cover",
  imgClassName,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);

  // Si cambia la URL, volver a estado de carga.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setRetried(false);
  }, [src]);

  function handleError() {
    if (src && !retried && withRetryParam(src)) {
      // Reintento una vez con anti-caché: si era un fallo transitorio
      // (caché truncada, red), esta carga lo supera sin mostrar fallback.
      setRetried(true);
      return;
    }
    // Fallo definitivo: se loguea el src exacto para diagnosticar (host,
    // formato, archivo puntual) y se muestra el fallback.
    console.warn("[img] no se pudo cargar:", src);
    setFailed(true);
  }

  if (src && !failed) {
    // Subidas del portal: directo sin pasar por /_next/image (daba 400).
    if (isDirectUpload(src)) {
      const shownSrc = retried ? (withRetryParam(src) ?? src) : src;
      return (
        <div className={`relative overflow-hidden ${className ?? "w-full h-full"}`}>
          {!loaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
          <img
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
    const shownSrc = retried ? (withRetryParam(src) ?? src) : src;
    // El wrapper solo se posiciona relative si el caller no trae la suya
    // (absolute/fixed/sticky): si no, pelean por `position` y se rompe el overlay.
    const positioned = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className ?? "");
    return (
      <div className={`${positioned ? "" : "relative "}overflow-hidden ${className ?? "w-full h-full"}`}>
        {!loaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
        <Image
          src={toOptimizableSrc(shownSrc)}
          alt={alt}
          fill
          sizes={sizes ?? "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"}
          priority={eager}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={handleError}
          className={`${fit === "contain" ? "object-contain" : "object-cover"} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${imgClassName ?? ""}`}
        />
      </div>
    );
  }

  // Sin foto propia → imagen de referencia según nombre/categoría/vertical.
  const emojiPath = getProductEmojiImage(name, category, vertical);
  if (emojiPath) {
    return (
      <div className={`${className ?? "w-full h-full"} flex items-center justify-center bg-accent/30`}>
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
    <div className={`${className ?? "w-full h-full"} flex items-center justify-center ${colors.bg}`}>
      <Icon className={iconClassName ?? "h-10 w-10"} strokeWidth={1.5} />
    </div>
  );
}
