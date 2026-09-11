"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VendorCard } from "@/components/store/vendor-card";
import type { Vendor as VendorDB } from "@/types/database";
import {
  Eye,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Send,
  ExternalLink,
} from "lucide-react";

/**
 * Modo prueba del comercio: vista previa del micrositio + cómo se ve en la
 * home + solicitud de publicación (la aprueba el admin).
 */
export function StorePreviewCard({
  vendor,
  onChanged,
}: {
  vendor: VendorDB;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");

  const v = vendor as any;
  const isVisible = !!v.visible;
  const requested = !!v.publish_requested_at;
  const token: string | null = v.preview_token ?? null;
  const slug: string | null = v.slug ?? null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // Dueño con sesión: preview sin token (?preview=1). Con token: link compartible.
  const micrositePreviewUrl = slug
    ? `${origin}/tienda/${slug}?preview=${token ? encodeURIComponent(token) : "1"}`
    : null;
  const homePreviewUrl = token ? `${origin}/preview/${encodeURIComponent(token)}` : null;

  async function call(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMsg(data.error || "No se pudo completar la acción");
        return null;
      }
      onChanged?.();
      return data;
    } catch {
      setMsg("Error de conexión");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string | null) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg("No se pudo copiar el link");
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-violet-100 text-violet-700 flex-shrink-0">
          <Eye className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Vista previa y publicación</p>
          <p className="text-xs text-muted-foreground truncate">
            Probá tu comercio antes de hacerlo público
          </p>
        </div>
        {isVisible ? (
          <Badge className="bg-green-100 text-green-700 flex-shrink-0">Visible al público</Badge>
        ) : requested ? (
          <Badge className="bg-amber-100 text-amber-700 flex-shrink-0">Solicitud enviada</Badge>
        ) : (
          <Badge variant="secondary" className="flex-shrink-0">Oculto · en prueba</Badge>
        )}
      </div>

      {!isVisible && (
        <>
          {/* Así se ve en la home (mismo componente que la home pública) */}
          <div>
            <p className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground mb-2">
              Así se ve en la home
            </p>
            <div className="w-full max-w-[300px] min-w-0">
              <VendorCard
                id={vendor.id}
                slug={vendor.slug}
                store_name={vendor.store_name}
                image_url={vendor.image_url}
                logo_url={vendor.logo_url}
                description={vendor.description}
                vertical={vendor.vertical}
                hours={vendor.hours}
                open_override={(vendor as any).open_override ?? null}
                href={micrositePreviewUrl}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {micrositePreviewUrl && (
              <Button size="sm" asChild disabled={busy}>
                <a href={micrositePreviewUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Abrir micrositio en prueba
                </a>
              </Button>
            )}
            {homePreviewUrl ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => copyLink(homePreviewUrl)}
              >
                {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                {copied ? "¡Copiado!" : "Copiar link de prueba"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !slug}
                onClick={() => call("/api/vendor/preview-token", { action: "generate", expiresInDays: 30 })}
                title="Genera un link compartible válido por 30 días"
              >
                <Copy className="h-3.5 w-3.5 mr-1" />
                Generar link de prueba
              </Button>
            )}
            {token && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => call("/api/vendor/preview-token", { action: "generate", expiresInDays: 30 })}
                  title="Genera un link nuevo e invalida el anterior"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Regenerar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => call("/api/vendor/preview-token", { action: "revoke" })}
                  className="text-red-600"
                  title="El link de prueba deja de funcionar"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Revocar
                </Button>
              </>
            )}
          </div>
          {token && (
            <p className="text-[11px] text-muted-foreground break-all">
              Link de prueba: {homePreviewUrl}
            </p>
          )}

          {/* Publicación con aprobación del admin */}
          <div className="rounded-xl border border-border p-3 flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Publicar comercio</p>
              <p className="text-xs text-muted-foreground">
                {requested
                  ? "Tu solicitud está pendiente de aprobación del admin."
                  : "Cuando esté listo, pedí la publicación y el admin lo aprueba."}
              </p>
            </div>
            {requested ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => call("/api/vendor/publish-request", { action: "cancel" })}
              >
                Cancelar solicitud
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => call("/api/vendor/publish-request", { action: "request" })}
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                Solicitar publicación
              </Button>
            )}
          </div>
        </>
      )}

      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </Card>
  );
}
