"use client";

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
}: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={className ?? "w-full h-full object-cover"}
      />
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
