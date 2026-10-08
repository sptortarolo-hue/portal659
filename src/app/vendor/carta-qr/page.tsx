"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProductImage } from "@/components/product-image";

type VendorMini = {
  slug: string;
  store_name: string | null;
  logo_url: string | null;
  image_url: string | null;
  carta_visibility?: string | null;
};

/**
 * Cartel imprimible de la carta con QR (sticker de mesa / vidrio).
 * El QR apunta a la carta de mesa (/carta/[slug]): solo lectura, sin
 * carrito — el pedido lo levanta el mesero.
 */
export default function CartaQrPage() {
  const [vendor, setVendor] = useState<VendorMini | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [size, setSize] = useState<"a5" | "a4">("a5");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  function cartaUrl(slug: string) {
    return `${window.location.origin}/carta/${slug}`;
  }

  async function setVisibility(next: "public" | "qr_only") {
    if (!vendor || saving || (vendor.carta_visibility ?? "qr_only") === next) return;
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/vendor/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carta_visibility: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo guardar");
      setVendor({ ...vendor, carta_visibility: next });
      setNotice(next === "public" ? "Carta pública: el menú se ve en tu tienda." : "Carta solo-QR: el menú salió de tu tienda, solo se ve por QR.");
    } catch {
      setNotice("No se pudo guardar. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/vendor/me", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json().catch(() => null);
      const v: VendorMini | undefined = data?.vendor;
      if (!res.ok || !v?.slug) {
        setError(true);
        return;
      }
      setVendor(v);
      const { default: QRCode } = await import("qrcode");
      const url = cartaUrl(v.slug);
      setQrDataUrl(await QRCode.toDataURL(url, { width: 1200, margin: 1 }));
    })();
  }, []);

  const storeName = vendor?.store_name || "tu comercio";
  const visibility = vendor?.carta_visibility === "public" ? "public" : "qr_only";

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: ${size === "a5" ? "A5" : "A4"}; margin: 10mm; }`}</style>

      {/* Barra de controles (no se imprime) */}
      <div className="no-print sticky top-14 sm:top-0 z-10 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
          <Link href="/vendor/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            ← Volver al panel
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-xl border border-border overflow-hidden text-sm font-medium">
              <button
                type="button"
                onClick={() => setSize("a5")}
                className={`px-3 py-1.5 ${size === "a5" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                A5 (sticker)
              </button>
              <button
                type="button"
                onClick={() => setSize("a4")}
                className={`px-3 py-1.5 ${size === "a4" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                A4 (cartel)
              </button>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!qrDataUrl}
              className="rounded-xl bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              🖨️ Imprimir
            </button>
          </div>
        </div>
      </div>

      {/* Vista previa del cartel */}
      <div className="max-w-2xl mx-auto px-4 py-6 print:p-0 print:max-w-none">
        {error ? (
          <p className="no-print text-sm text-muted-foreground text-center py-12">
            Iniciá sesión con tu comercio para generar el cartel.
          </p>
        ) : !vendor || !qrDataUrl ? (
          <div className="h-[70vh] rounded-2xl bg-skeleton animate-pulse" />
        ) : (
          <div className="poster bg-white text-black rounded-2xl shadow-lg print:shadow-none print:rounded-none border border-border print:border-2 print:border-black min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-10 gap-5">
            <ProductImage
              src={vendor.logo_url || vendor.image_url}
              name={storeName}
              alt={storeName}
              className="h-20 w-20 print:h-24 print:w-24 rounded-full"
              iconClassName="h-10 w-10"
              eager
            />
            <div>
            <p className="font-display text-2xl print:text-3xl font-bold tracking-tight">{storeName}</p>
            <p className="text-sm print:text-base mt-1 text-neutral-500">
              Escaneá el código y mirá la carta
            </p>
          </div>
          {/* El QR en sí es una imagen plana (grilla de píxeles), no una foto
              de galería: <img> directo está bien acá (ProductImage es para
              uploads de productos/logos con retry/fallback). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt={`QR de la carta de ${storeName}`} className="w-56 h-56 print:w-64 print:h-64" />
          <div className="space-y-1">
            <p className="text-base print:text-lg font-semibold">Pedí sin esperar · 0% comisión</p>
            <p className="text-xs print:text-sm text-neutral-500 font-mono">
              portal659.com.ar/carta/{vendor.slug}
            </p>
          </div>
          <p className="text-[10px] text-neutral-400">Portal 659 — El centro comercial de tu barrio</p>
        </div>
      )}

      {/* Visibilidad de la carta (no se imprime) */}
      {vendor && (
        <div className="no-print max-w-2xl mx-auto px-4 pb-10 -mt-2">
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold">Visibilidad de la carta</p>
              <a
                href={`/carta/${vendor.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline"
              >
                Ver carta →
              </a>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setVisibility("qr_only")}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                  visibility === "qr_only"
                    ? "border-primary bg-primary/10 font-semibold"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                📱 Solo QR
                <span className="block text-xs font-normal mt-0.5">El menú sale de tu tienda y buscar. Solo por QR.</span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setVisibility("public")}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                  visibility === "public"
                    ? "border-primary bg-primary/10 font-semibold"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                🌐 Pública
                <span className="block text-xs font-normal mt-0.5">El menú se ve en tu tienda, buscar e indexa.</span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              La carta es solo lectura (sin carrito): el pedido lo levanta el mesero. Con Solo QR, el menú sale
              de tu tienda pública y solo se ve escaneando.
            </p>
            {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
          </div>
        </div>
      )}
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .poster { box-shadow: none !important; }
        }
      `}</style>
    </main>
  );
}
