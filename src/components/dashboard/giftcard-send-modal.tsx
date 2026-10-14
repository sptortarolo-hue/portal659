"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TarjetaRegalo } from "@/components/store/tarjeta-regalo";
import {
  buildGiftcardWaText,
  giftcardCardUrl,
  giftcardWaLink,
} from "@/lib/gift-card-share";

export type SendModalCard = {
  id: string;
  code: string;
  amount: number;
  expires_at?: string | null;
  customer_phone?: string | null;
};

/**
 * Modal de tarjeta generada: muestra el diseño + Enviar por WhatsApp
 * (marca sent_at) + Copiar código + Ver ficha pública.
 */
export function GiftcardSendModal({
  card,
  storeName,
  logoUrl,
  vertical,
  fallbackPhone,
  onClose,
}: {
  card: SendModalCard;
  storeName: string;
  logoUrl?: string | null;
  vertical?: string | null;
  /** Teléfono del comprador (pedido) si la tarjeta no trae uno propio. */
  fallbackPhone?: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  function sendWA() {
    const text = buildGiftcardWaText({
      storeName: storeName || "el local",
      amount: Math.round(Number(card.amount) || 0),
      code: card.code,
      expiresAt: card.expires_at ?? null,
      cardUrl:
        typeof window !== "undefined"
          ? giftcardCardUrl(window.location.origin, card.code)
          : null,
    });
    fetch("/api/vendor/giftcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_sent", id: card.id }),
    }).catch(() => {});
    const raw = String(card.customer_phone || fallbackPhone || "");
    const digits = raw.startsWith("lid:") ? "" : raw.replace(/[^0-9]/g, "");
    window.open(giftcardWaLink(digits, text), "_blank");
    setSent(true);
  }

  function copyCode() {
    try {
      navigator.clipboard?.writeText(String(card.code || ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-label="Tarjeta de regalo generada"
    >
      <div
        className="bg-card rounded-2xl p-4 max-w-sm w-full space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <TarjetaRegalo
          storeName={storeName || "Tu comercio"}
          logoUrl={logoUrl}
          amount={Math.round(Number(card.amount) || 0)}
          code={card.code}
          expiresAt={card.expires_at ?? null}
          vertical={vertical}
        />
        <Button type="button" className="w-full" onClick={sendWA}>
          {sent ? "✓ Abierto en WhatsApp" : "Enviar por WhatsApp"}
        </Button>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={copyCode}>
            {copied ? "✓ Copiado" : "Copiar código"}
          </Button>
          <a
            href={`/g/${encodeURIComponent(String(card.code || "").trim().toUpperCase())}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Ver ficha
          </a>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
