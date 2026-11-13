"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CARTEL_SIZES,
  cartelSize,
  cartelTarget,
  isCartelServiceVertical,
  type CartelSize,
  type CartelTarget,
  type CartelTemplate,
} from "@/lib/cartel";
import { CartelHoja, CartelPoster, type CartelPosterData } from "@/components/vendor/cartel-poster";

type VendorMini = {
  slug: string;
  store_name: string | null;
  logo_url: string | null;
  image_url: string | null;
  vertical?: string | null;
  carta_visibility?: string | null;
  carta_qr_target?: string | null;
  category?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  location?: string | null;
  hours?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
};

const TEMPLATES: { id: CartelTemplate; label: string; hint: string }[] = [
  { id: "colorido", label: "Colorido", hint: "Fondo con el color de tu rubro" },
  { id: "foto", label: "Foto", hint: "Tu foto de portada de fondo" },
  { id: "minimal", label: "Minimal", hint: "Blanco y negro, para b/n" },
];

/** CSS px por mm (96 dpi) — para que la impresión salga del tamaño exacto. */
const MM_TO_PX = 96 / 25.4;

/**
 * Cartel imprimible de la carta con QR (sticker de mesa / vidrio).
 * El QR apunta al destino que elige el comercio: la carta de mesa
 * (/carta/[slug], solo lectura) o su micrositio (/tienda/[slug], con carrito
 * o turnos). Se puede imprimir desde el navegador o descargar el PNG/PDF.
 */
export default function CartaQrPage() {
  const [vendor, setVendor] = useState<VendorMini | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [target, setTarget] = useState<CartelTarget>("carta");
  const [template, setTemplate] = useState<CartelTemplate>("colorido");
  const [size, setSize] = useState<CartelSize>("a4");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const serviceVertical = isCartelServiceVertical(vendor?.vertical);

  function cartaUrl(slug: string, t: CartelTarget) {
    return `${origin}${t === "tienda" ? "/tienda" : "/carta"}/${slug}`;
  }

  async function setVisibility(next: "public" | "qr_only") {
    if (!vendor || saving || (vendor.carta_visibility ?? "qr_only") === next) return;
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
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

  async function saveTarget(next: CartelTarget) {
    if (!vendor || saving || target === next) return;
    setTarget(next);
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carta_qr_target: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo guardar");
      setVendor({ ...vendor, carta_qr_target: next });
      setNotice(
        next === "tienda"
          ? "Listo: el cartel lleva a tu tienda (el cliente puede pedir/reservar solo)."
          : "Listo: el cartel lleva a la carta de mesa (solo lectura, el mesero toma el pedido)."
      );
    } catch {
      setNotice("No se pudo guardar el destino (podés seguir usando el cartel igual).");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    // El origen se lee en el cliente: la página es un Client Component y
    // durante el SSR no hay `window` (evita el crash de prerender).
    setOrigin(window.location.origin);
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
      setTarget(cartelTarget(v.vertical, v.carta_qr_target));
    })();
  }, []);

  // QR: se regenera cuando cambia el destino (carta ↔ micrositio).
  useEffect(() => {
    if (!vendor?.slug || !origin) return;
    let cancelled = false;
    (async () => {
      try {
        const { default: QRCode } = await import("qrcode");
        const url = cartaUrl(vendor.slug!, target);
        // margin 3 = zona de silencio amplia (se escanea de lejos y con
        // impresora mala); corrección de errores alta para que aguante dirt.
        const dataUrl = await QRCode.toDataURL(url, {
          width: 1200,
          margin: 3,
          errorCorrectionLevel: "H",
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch {
        if (!cancelled) setQrDataUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.slug, target, origin]);

  const storeName = vendor?.store_name || "tu comercio";
  const visibility = vendor?.carta_visibility === "public" ? "public" : "qr_only";
  const catalog = (vendor?.vertical ?? "gastronomia") !== "gastronomia";

  const spec = useMemo(() => cartelSize(size), [size]);

  const posterData: CartelPosterData | null = useMemo(() => {
    if (!vendor?.slug || !qrDataUrl || !origin) return null;
    return {
      storeName: vendor.store_name || "Tu comercio",
      slug: vendor.slug,
      vertical: vendor.vertical ?? null,
      target,
      rubro: vendor.category ?? null,
      barrio: vendor.neighborhood ?? null,
      address: vendor.address || vendor.location || null,
      hours: vendor.hours ?? null,
      whatsapp: vendor.whatsapp ?? null,
      instagram: vendor.instagram ?? null,
      logoUrl: vendor.logo_url ?? null,
      imageUrl: vendor.image_url ?? null,
      qrDataUrl,
      siteUrl: origin,
    };
  }, [vendor, qrDataUrl, target, origin]);

  const previewW = 400;
  const previewH = Math.round((previewW * spec.pxH) / spec.pxW);
  const printW = spec.pageWmm * MM_TO_PX;
  const printH = spec.pageHmm * MM_TO_PX;

  const downloadUrl = (formato: "png" | "pdf") =>
    vendor?.slug
      ? `/api/vendor/cartel/${vendor.slug}?formato=${formato}&plantilla=${template}&size=${size}&target=${target}`
      : "";

  const pageSize = spec.id === "a5" ? "A5" : spec.id === "sticker" ? "100mm 150mm" : "A4";

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: ${pageSize}; margin: 0; }`}</style>

      {/* Barra de controles (no se imprime) */}
      <div className="no-print sticky top-14 sm:top-0 z-10 bg-background border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
          <Link href="/vendor/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            ← Volver al panel
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {posterData && (
              <>
                <a
                  href={downloadUrl("png")}
                  download={`cartel-${vendor?.slug}.png`}
                  className="rounded-xl border border-border bg-background text-sm font-medium px-3 py-1.5 hover:bg-muted transition-colors"
                >
                  ⬇️ PNG
                </a>
                <a
                  href={downloadUrl("pdf")}
                  download={`cartel-${vendor?.slug}.pdf`}
                  className="rounded-xl border border-border bg-background text-sm font-medium px-3 py-1.5 hover:bg-muted transition-colors"
                >
                  ⬇️ PDF
                </a>
              </>
            )}
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

      <div className="max-w-3xl mx-auto px-4 py-6 print:p-0 print:max-w-none">
        {error ? (
          <p className="no-print text-sm text-muted-foreground text-center py-12">
            Iniciá sesión con tu comercio para generar el cartel.
          </p>
        ) : !vendor || !qrDataUrl || !posterData ? (
          <div className="no-print h-[70vh] rounded-2xl bg-skeleton animate-pulse" />
        ) : (
          <>
            {/* Controles */}
            <div className="no-print space-y-4 mb-6">
              {/* Destino del QR */}
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold">¿A dónde lleva el QR?</p>
                  <span className="text-[11px] text-muted-foreground">
                    Lo elige el comercio — el cartel se arma solo con el texto correcto.
                  </span>
                </div>
                {serviceVertical ? (
                  <div className="rounded-xl border border-primary bg-primary/5 px-3 py-2 text-sm">
                    📱 <strong>Tu tienda</strong> (micrositio) — en tu rubro el QR va a la vidriera
                    para que el cliente pueda reservar o pedir un presupuesto.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveTarget("carta")}
                      className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                        target === "carta"
                          ? "border-primary bg-primary/10 font-semibold"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      📋 Carta de mesa
                      <span className="block text-xs font-normal mt-0.5">
                        Solo lectura, sin carrito: el mesero toma el pedido.
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveTarget("tienda")}
                      className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                        target === "tienda"
                          ? "border-primary bg-primary/10 font-semibold"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      🛍️ Mi tienda
                      <span className="block text-xs font-normal mt-0.5">
                        El micrositio: el cliente pide, reserva o consulta y te escribe por WhatsApp.
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* Plantilla + tamaño */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
                  <p className="text-sm font-semibold">Plantilla</p>
                  <div className="grid grid-cols-3 gap-2">
                    {TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTemplate(t.id)}
                        title={t.hint}
                        className={`rounded-xl border px-2 py-2 text-xs transition ${
                          template === t.id
                            ? "border-primary bg-primary/10 font-semibold"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {TEMPLATES.find((t) => t.id === template)?.hint}
                    {template === "foto" && !vendor.image_url && " (sin foto de portada: sale el color del rubro)"}
                  </p>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
                  <p className="text-sm font-semibold">Tamaño</p>
                  <div className="grid grid-cols-4 gap-2">
                    {CARTEL_SIZES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSize(s.id)}
                        title={s.hint}
                        className={`rounded-xl border px-2 py-2 text-xs transition ${
                          size === s.id
                            ? "border-primary bg-primary/10 font-semibold"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{spec.hint}</p>
                </div>
              </div>
            </div>

            {/* Vista previa (pantalla) */}
            <div className="no-print flex justify-center">
              <div
                style={{
                  width: previewW,
                  height: previewH,
                  overflow: "hidden",
                  borderRadius: 16,
                  boxShadow: "0 10px 40px rgba(0,0,0,0.12)",
                }}
              >
                {spec.sheet ? (
                  <CartelHoja data={posterData} template={template} width={previewW} height={previewH} />
                ) : (
                  <CartelPoster
                    data={posterData}
                    template={template}
                    width={previewW}
                    height={previewH}
                    compact={spec.compact}
                  />
                )}
              </div>
            </div>

            {/* Hoja real para imprimir (1:1) */}
            <div
              className="hidden print:block"
              style={{ width: `${spec.pageWmm}mm`, height: `${spec.pageHmm}mm` }}
            >
              <div
                style={{
                  width: printW,
                  height: printH,
                  printColorAdjust: "exact",
                  WebkitPrintColorAdjust: "exact",
                }}
              >
                {spec.sheet ? (
                  <CartelHoja data={posterData} template={template} width={printW} height={printH} />
                ) : (
                  <CartelPoster
                    data={posterData}
                    template={template}
                    width={printW}
                    height={printH}
                    compact={spec.compact}
                  />
                )}
              </div>
            </div>

            <p className="no-print mt-4 text-center text-[11px] text-muted-foreground">
              Al imprimir, si el fondo no sale de color: en el diálogo de impresión activá
              «Gráficos de fondo» (Chrome) o «Imprimir gráficos de fondo» (Safari).
            </p>
          </>
        )}

        {/* Visibilidad de la carta (no se imprime) */}
        {vendor && (
          <div className="no-print max-w-3xl mx-auto px-4 pb-10 -mt-2">
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-semibold">Visibilidad de {catalog ? "el catálogo" : "la carta"}</p>
                <a
                  href={`/carta/${vendor.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Ver {catalog ? "catálogo" : "carta"} →
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
                {catalog
                  ? "El catálogo es solo lectura (sin carrito). Con Solo QR, los productos salen de tu tienda pública y solo se ven escaneando."
                  : "La carta es solo lectura (sin carrito): el pedido lo levanta el mesero. Con Solo QR, el menú sale de tu tienda pública y solo se ve escaneando."}
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
        }
      `}</style>
    </main>
  );
}
