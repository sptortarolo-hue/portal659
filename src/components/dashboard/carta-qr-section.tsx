"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import type { Vendor } from "@/types/database";

type Props = {
  vendor: Vendor | null;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  setMsg: (m: string) => void;
};

/**
 * Sección "Carta y QR" de Configuración: QR de la carta de mesa a la vista,
 * link para abrirla/copiarla, toggle de visibilidad (Solo QR / Pública) y
 * acceso al cartel imprimible (/vendor/carta-qr).
 * Se monta en los 5 dashboards dentro de su <ConfigSections>.
 */
export function CartaQrSection({ vendor, saveVendor, setMsg }: Props) {
  const visibility = vendor?.carta_visibility === "public" ? "public" : "qr_only";
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const slug = vendor?.slug || "";
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const cartaUrl = slug && origin ? `${origin}/carta/${slug}` : "";

  useEffect(() => {
    if (!cartaUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const url = await QRCode.toDataURL(cartaUrl, { width: 480, margin: 1 });
        if (!cancelled) setQrDataUrl(url);
      } catch {
        if (!cancelled) setQrDataUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cartaUrl]);

  // Sincroniza si el vendor cambia afuera (otra pestaña/sección).
  useEffect(() => {
    setCopied(false);
  }, [vendor?.carta_visibility]);

  async function setVisibility(next: "public" | "qr_only") {
    if (!vendor || saving || visibility === next) return;
    setSaving(true);
    try {
      await saveVendor({ carta_visibility: next });
      setMsg(
        next === "public"
          ? "Carta pública: el menú se ve en tu tienda, buscar e indexa."
          : "Carta solo-QR: el menú salió de tu tienda y buscar, solo se ve por QR."
      );
    } catch {
      setMsg("No se pudo guardar la visibilidad. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!cartaUrl) return;
    try {
      await navigator.clipboard.writeText(cartaUrl);
      setCopied(true);
    } catch {
      setMsg("No se pudo copiar. Copiá el link manualmente.");
    }
  }

  if (!vendor) return null;

  return (
    <CollapsibleSection id="carta-qr" icon="📱" title="Carta y QR">
      <div className="space-y-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-32 h-32 rounded-xl border border-border bg-white p-1.5 flex-shrink-0">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt={`QR de la carta de ${vendor.store_name}`} className="w-full h-full" />
            ) : (
              <div className="w-full h-full rounded-lg bg-skeleton animate-pulse" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-muted-foreground">
              Tu carta de mesa (solo lectura, sin carrito: el pedido lo levanta el mesero). Con Solo QR, el menú
              sale de tu tienda pública y solo se ve escaneando.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {cartaUrl && (
                <Link
                  href={`/carta/${slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Ver carta →
                </Link>
              )}
              <Button size="sm" variant="outline" onClick={copyLink} disabled={!cartaUrl}>
                {copied ? "¡Copiado!" : "Copiar link"}
              </Button>
              <Link
                href="/vendor/carta-qr"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline"
              >
                🖨️ Cartel para imprimir
              </Link>
            </div>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold mb-2">Quién puede verla</p>
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
        </div>
      </div>
    </CollapsibleSection>
  );
}
