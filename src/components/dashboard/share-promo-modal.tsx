"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";

export function SharePromoModal({
  open,
  onOpenChange,
  storeName,
  slug,
  hasPromos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeName: string;
  slug: string;
  hasPromos: boolean;
}) {
  const [message, setMessage] = useState(
    `🔥 ¡Promos en ${storeName}!\nDescuentos exclusivos por tiempo limitado\n👉 Ver promos: https://www.portal659.com.ar/promo/${slug}`
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMessage(
      `🔥 ¡Promos en ${storeName}!\nDescuentos exclusivos por tiempo limitado\n👉 Ver promos: https://www.portal659.com.ar/promo/${slug}`
    );
  }, [storeName, slug, open]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Modal open={open} onClose={() => onOpenChange(false)} title="Compartir promos en WhatsApp">
      <div className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">
          Copiá el mensaje y pegalo en tu grupo de WhatsApp, o abrí WhatsApp directamente.
        </p>

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          className="resize-none"
        />

        <div className="flex gap-2">
          <Button onClick={handleCopy} variant="outline" className="flex-1">
            <Copy className="w-4 h-4 mr-2" />
            {copied ? "¡Copiado!" : "Copiar mensaje"}
          </Button>
          <Button onClick={handleOpenWhatsApp} className="flex-1">
            <ExternalLink className="w-4 h-4 mr-2" />
            Abrir WhatsApp
          </Button>
        </div>

        {!hasPromos && (
          <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
            ⚠️ No tenés promos activas. Agregá productos con precio promo para que el link muestre ofertas.
          </p>
        )}
      </div>
    </Modal>
  );
}
