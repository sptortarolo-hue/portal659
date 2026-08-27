"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import { ACTIVE_NEIGHBORHOODS, DEFAULT_NEIGHBORHOOD, ZONE_COOKIE } from "@/lib/config";

function readCookie(): string {
  const match = document.cookie.match(new RegExp(`(^|; )${ZONE_COOKIE}=([^;]+)`));
  return match ? match[2] : DEFAULT_NEIGHBORHOOD.slug;
}

export function ZoneSelector() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(DEFAULT_NEIGHBORHOOD.slug);

  useEffect(() => {
    setSlug(readCookie());
  }, []);

  const currentN = ACTIVE_NEIGHBORHOODS.find((n) => n.slug === slug) || DEFAULT_NEIGHBORHOOD;

  function select(s: string) {
    setOpen(false);
    if (s === slug) return;
    document.cookie = `${ZONE_COOKIE}=${s}; path=/; max-age=${60 * 60 * 24 * 30}`;
    setSlug(s);
    router.refresh();
  }

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
      >
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <span>{currentN.name}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 z-50 w-44 rounded-xl border border-border bg-card shadow-lg p-1.5">
            {ACTIVE_NEIGHBORHOODS.map((n) => (
              <button
                key={n.slug}
                onClick={() => select(n.slug)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  n.slug === slug ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                }`}
              >
                {n.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}