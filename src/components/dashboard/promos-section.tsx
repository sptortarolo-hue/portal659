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
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    loadData();
  }, [vendorId]);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/promos?vendorId=${vendorId}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
        setPromoImage(data.promoImage || null);
      }
    } catch (e) {
      console.error("Error loading promos:", e);
    } finally {
      setLoading(false);
    }
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
        const data = await res.json();
        setPromoImage(data.url);
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
      setPromoImage(null);
    } catch (err) {
      console.error("Error deleting:", err);
    }
  }

  const hasPromos = products.length > 0;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar";
  const promoUrl = `${siteUrl}/promo/${slug}`;
  const ogImageUrl = `${siteUrl}/og/promo/${slug}.jpg`;

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
          <div className="flex gap-2">
            <Button
              onClick={() => setShareOpen(true)}
              disabled={!hasPromos}
              className="flex-1"
            >
              <Share className="w-4 h-4 mr-2" />
              Compartir promos en WhatsApp
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowPreview(!showPreview)}
            >
              <Eye className="w-4 h-4 mr-2" />
              {showPreview ? "Ocultar preview" : "Ver preview"}
            </Button>
          </div>

          {showPreview && (
            <div className="border rounded-lg p-4 bg-gray-50">
              <p className="text-sm font-medium mb-2">Así se ve el link en WhatsApp:</p>
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

          <div className="space-y-2">
            <p className="text-sm font-medium">Imagen de promo (opcional):</p>
            <p className="text-xs text-gray-500">
              Si no subís una imagen, se usa la foto de tu tienda con un badge "PROMO".
            </p>
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

          <div className="space-y-2">
            <p className="text-sm font-medium">
              Productos en promo ({products.length}):
            </p>
            {products.length === 0 ? (
              <p className="text-sm text-gray-500">
                No tenés productos en promo. Agregá un precio promocional a tus productos para que aparezcan acá.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {products.map((p) => {
                  const pct = Math.round((1 - p.promo_price / p.price) * 100);
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 p-2 border rounded-lg"
                    >
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
                        <div className="flex items-center gap-2 text-xs">
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
