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
  imgClassName,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Si cambia la URL, volver a estado de carga.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <div className={`relative overflow-hidden ${className ?? "w-full h-full"}`}>
        {!loaded && <div className="absolute inset-0 bg-muted animate-pulse" />}
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes ?? "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"}
          priority={eager}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${imgClassName ?? ""}`}
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
