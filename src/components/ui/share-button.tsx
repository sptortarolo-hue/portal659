"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

type ShareButtonProps = {
  url: string;
  title: string;
  text?: string;
  className?: string;
};

export function ShareButton({ url, title, text, className = "" }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: text || title, url });
      } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <button
      onClick={handleShare}
      className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors ${className}`}
      aria-label="Compartir"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4 text-green-500" />
          <span className="text-green-500">Copiado</span>
        </>
      ) : (
        <>
          <Share2 className="h-4 w-4" />
          <span>Compartir</span>
        </>
      )}
    </button>
  );
}
