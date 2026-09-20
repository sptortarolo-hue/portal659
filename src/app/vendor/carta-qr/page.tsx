"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProductImage } from "@/components/product-image";

type VendorMini = {
  slug: string;
  store_name: string | null;
  logo_url: string | null;
  image_url: string | null;
};

/**
 * Cartel imprimible de la carta con QR (sticker de mesa / vidrio).
 * El QR apunta al micrositio directo a la carta (?menu=1&from=qr).
 */
export default function CartaQrPage() {
  const [vendor, setVendor] = useState<VendorMini | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [size, setSize] = useState<"a5" | "a4">("a5");
  const [error, setError] = useState(false);

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
      const url = `${window.location.origin}/tienda/${v.slug}?menu=1&from=qr`;
      setQrDataUrl(await QRCode.toDataURL(url, { width: 1200, margin: 1 }));
    })();
  }, []);

  const storeName = vendor?.store_name || "tu comercio";

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
                portal659.com.ar/tienda/{vendor.slug}
              </p>
            </div>
            <p className="text-[10px] text-neutral-400">Portal 659 — El centro comercial de tu barrio</p>
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
