"use client";

import { useState, useEffect } from "react";
import { Share, Upload, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SharePromoModal } from "@/components/dashboard/share-promo-modal";
import { ProductImage } from "@/components/product-image";

type PromoProduct = {
  id: string;
  name: string;
  price: number;
  promo_price: number;
  image_url: string | null;
  category: string | null;
};

export function PromosSection({
  vendorId,
  storeName,
  slug,
  vertical,
}: {
  vendorId: string;
  storeName: string;
  slug: string;
  vertical: string;
}) {
  const [products, setProducts] = useState<PromoProduct[]>([]);
  const [promoImage, setPromoImage] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [vendorId]);

  async function loadData(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/vendor/promos?vendorId=${vendorId}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
        setPromoImage(data.promoImage || null);
        const validIds = new Set((data.products || []).map((p: PromoProduct) => p.id));
        setSelection(((data.selection || []) as string[]).filter((id) => validIds.has(id)));
        setUpdatedAt(data.updatedAt || null);
        setMode(data.mode === "manual" ? "manual" : "auto");
      }
    } catch (e) {
      console.error("Error loading promos:", e);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function saveSelection(next: string[], nextMode: "auto" | "manual") {
    setSelectError(null);
    setSavingSelection(true);
    try {
      const res = await fetch("/api/vendor/promo-selection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: next, mode: nextMode }),
      });
      if (res.ok) {
        const data = await res.json();
        setUpdatedAt(data.updatedAt || null);
        setMode(data.mode === "manual" ? "manual" : "auto");
      } else if (res.status === 503) {
        setSelectError("Falta aplicar la migración migrate-promo-mode.sql en la DB.");
      } else {
        const data = await res.json().catch(() => null);
        setSelectError(data?.error || "No se pudo guardar.");
      }
    } catch (err) {
      console.error("Error saving selection:", err);
      setSelectError("No se pudo guardar.");
    } finally {
      setSavingSelection(false);
    }
  }

  async function toggleSelect(id: string) {
    const included = selection.includes(id);
    const next = included
      ? selection.filter((s) => s !== id)
      : selection.length >= 3
        ? selection
        : [...selection, id];
    if (next === selection) return;
    setSelection(next);
    await saveSelection(next, mode);
  }

  async function changeMode(nextMode: "auto" | "manual") {
    if (nextMode === mode) return;
    setMode(nextMode);
    await saveSelection(selection, nextMode);
  }

  async function refreshImage() {
    await saveSelection(selection, mode);
    await loadData(true);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/vendor/promo-image", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        await loadData(true);
      }
    } catch (err) {
      console.error("Error uploading:", err);
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteImage() {
    try {
      await fetch("/api/vendor/promo-image", { method: "DELETE" });
      await loadData(true);
    } catch (err) {
      console.error("Error deleting:", err);
    }
  }

  const hasPromos = products.length > 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar";
  const promoUrl = `${siteUrl}/promo/${slug}`;
  const ogImageUrl = updatedAt
    ? `${siteUrl}/og/promo/${slug}.jpg?v=${encodeURIComponent(updatedAt)}`
    : `${siteUrl}/og/promo/${slug}.jpg`;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share className="w-5 h-5" />
            Promos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">Cargando...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share className="w-5 h-5" />
            Promos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => setShareOpen(true)}
              disabled={!hasPromos}
              className="flex-1"
            >
              <Share className="w-4 h-4 mr-2 flex-shrink-0" />
              Compartir promos en WhatsApp
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowPreview(!showPreview)}
            >
              <Eye className="w-4 h-4 mr-2 flex-shrink-0" />
              {showPreview ? "Ocultar preview" : "Ver preview"}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => changeMode("auto")}
              aria-pressed={mode === "auto"}
              className={`rounded-xl border-2 p-3 text-left transition-colors ${
                mode === "auto" ? "border-red-400 bg-red-50/60" : "border-border hover:border-red-200"
              }`}
            >
              <p className="text-sm font-bold">Componer con productos</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Foto + logo + badge PROMO, armada sola.
              </p>
            </button>
            <button
              type="button"
              onClick={() => changeMode("manual")}
              aria-pressed={mode === "manual"}
              className={`rounded-xl border-2 p-3 text-left transition-colors ${
                mode === "manual" ? "border-red-400 bg-red-50/60" : "border-border hover:border-red-200"
              }`}
            >
              <p className="text-sm font-bold">Usar mi foto</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Subí una imagen propia para la tarjeta.
              </p>
            </button>
          </div>

          {showPreview && (
            <div className="border rounded-lg p-4 bg-gray-50">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-sm font-medium">Así se ve el link en WhatsApp:</p>
                <Button variant="outline" size="sm" onClick={refreshImage} disabled={savingSelection}>
                  {savingSelection ? "Actualizando…" : "Actualizar imagen"}
                </Button>
              </div>
              <div className="bg-white rounded-lg border p-3 max-w-sm">
                <div className="aspect-[1200/630] rounded overflow-hidden mb-2">
                  <img
                    src={ogImageUrl}
                    alt="Preview OG"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="font-bold text-sm">🔥 Promos en {storeName} — Portal 659</p>
                <p className="text-xs text-gray-600">
                  {storeName} en tu barrio. Pedí por WhatsApp o delivery.
                </p>
                <p className="text-xs text-gray-400 mt-1">{promoUrl}</p>
              </div>
            </div>
          )}

          {mode === "manual" && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Tu foto para la tarjeta:</p>
            <div className="flex gap-2">
              <label className="flex-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={uploading}
                  asChild
                >
                  <span>
                    <Upload className="w-4 h-4 mr-2" />
                    {uploading ? "Subiendo..." : promoImage ? "Cambiar imagen" : "Subir imagen"}
                  </span>
                </Button>
              </label>
              {promoImage && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDeleteImage}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            {promoImage && (
              <div className="mt-2">
                <img
                  src={promoImage}
                  alt="Imagen de promo"
                  className="w-32 h-32 object-cover rounded-lg border"
                />
              </div>
            )}
          </div>
          )}

          {mode === "auto" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Productos en promo ({products.length}):
              </p>
              {products.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Destacados en imagen: {selection.length}/3
                  {savingSelection ? " · guardando…" : ""}
                </p>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Tildá hasta 3 productos para armar la imagen (foto + logo + badge PROMO).
              Si no elegís, se usan los de mayor descuento.
            </p>
            {selectError && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg">{selectError}</p>
            )}
            {products.length === 0 ? (
              <p className="text-sm text-gray-500">
                No tenés productos en promo. Agregá un precio promocional a tus productos para que aparezcan acá.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {products.map((p) => {
                  const pct = Math.round((1 - p.promo_price / p.price) * 100);
                  const order = selection.indexOf(p.id);
                  const checked = order >= 0;
                  const disabled = !checked && selection.length >= 3;
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 p-2 border rounded-lg ${checked ? "border-red-300 bg-red-50/50" : ""}`}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        aria-label={`Destacar ${p.name} en la imagen`}
                        disabled={disabled}
                        onClick={() => toggleSelect(p.id)}
                        className={`h-5 w-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                          checked
                            ? "bg-red-500 border-red-500 text-white"
                            : disabled
                              ? "border-muted bg-muted/50 text-transparent cursor-not-allowed"
                              : "border-muted-foreground/40 hover:border-red-400"
                        }`}
                      >
                        {checked ? (
                          <span className="text-[11px] font-bold leading-none">{order + 1}</span>
                        ) : (
                          <span className="text-transparent text-[11px] leading-none">·</span>
                        )}
                      </button>
                      <div className="w-12 h-12 rounded overflow-hidden flex-shrink-0 bg-gray-100">
                        <ProductImage
                          src={p.image_url}
                          name={p.name}
                          category={p.category}
                          vertical={vertical}
                          alt={p.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="text-gray-400 line-through">
                            ${p.price.toLocaleString("es-AR")}
                          </span>
                          <span className="font-bold text-red-600">
                            ${p.promo_price.toLocaleString("es-AR")}
                          </span>
                          <Badge className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0">
                            −{pct}%
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </CardContent>
      </Card>

      <SharePromoModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        storeName={storeName}
        slug={slug}
        hasPromos={hasPromos}
      />
    </>
  );
}
