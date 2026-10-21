"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VERTICALS } from "@/lib/config";

/**
 * Switcher de tiendas (multi-comercio): pill con el comercio activo que
 * despliega los demás comercios propios + alta de un comercio nuevo.
 * El cambio de tienda usa la cookie `portal659-vendor-id` (POST
 * /api/vendor/select) y recarga el dashboard para re-bootstrappear.
 */
export type OwnerStore = {
  id: string;
  slug: string | null;
  store_name: string;
  vertical: string | null;
  logo_url: string | null;
  image_url: string | null;
};

const VERTICAL_EMOJI: Record<string, string> = {
  gastronomia: "🍽️",
  comercio: "🏪",
  servicio: "🔧",
  moda: "👗",
  estetica: "💅",
  otro: "📋",
};

function verticalMeta(vertical: string | null): { emoji: string; name: string } {
  const found = VERTICALS.find((v) => v.slug === vertical);
  return found
    ? { emoji: found.emoji, name: found.name }
    : { emoji: VERTICAL_EMOJI[vertical || "otro"] || "📋", name: "Otro" };
}

export function StoreSwitcher({
  stores,
  activeId,
  impersonating = false,
}: {
  stores: OwnerStore[];
  activeId: string | null;
  /** Modo admin llave en mano: alterna/crea con la cookie admin-as. */
  impersonating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ store_name: "", vertical: "gastronomia", neighborhood: "sicardi", whatsapp: "" });
  const [formErr, setFormErr] = useState("");

  if (!stores || stores.length === 0) return null;
  const active = stores.find((s) => s.id === activeId) ?? stores[0];

  async function switchTo(id: string) {
    if (id === activeId || busy) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/vendor/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: id, as: impersonating }),
      });
      // Impersonación: la URL lleva ?as= y el dashboard resetea la cookie
      // admin-as on-load → alinear la URL con la cookie elegida aca.
      if (impersonating) {
        const url = new URL(window.location.href);
        url.searchParams.set("as", id);
        window.location.href = url.toString();
        return;
      }
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  async function createStore(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormErr("");
    if (!form.store_name.trim()) {
      setFormErr("Ingresá el nombre del comercio");
      return;
    }
    if (form.whatsapp.replace(/\D/g, "").length < 10) {
      setFormErr("Ingresá un WhatsApp válido (celular argentino)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, as: impersonating }),
      });
      const data = await res.json().catch(() => null);
      if (data?.vendor) {
        if (impersonating) {
          const url = new URL(window.location.href);
          url.searchParams.set("as", String(data.vendor.id));
          window.location.href = url.toString();
        } else {
          setWizardOpen(false);
          setOpen(false);
          window.location.reload();
        }
        return;
      }
      setFormErr(data?.error || "No se pudo crear el comercio");
    } catch {
      setFormErr("No se pudo crear el comercio");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors flex-shrink-0 max-w-[130px] sm:max-w-[160px]"
        title="Cambiar de comercio"
        aria-label="Cambiar de comercio"
      >
        <span className="truncate pointer-events-none">{active?.store_name || "Mi comercio"}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => !busy && setOpen(false)} />
          <div className="fixed z-[61] top-16 left-3 sm:left-auto sm:top-14 sm:right-10 sm:left-3 lg:left-52 w-[calc(100%-1.5rem)] max-w-xs bg-card border border-border rounded-xl shadow-lg p-2 space-y-1">
            <p className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Mis comercios
            </p>
            {stores.map((s) => {
              const meta = verticalMeta(s.vertical);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => switchTo(s.id)}
                  disabled={busy}
                  className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                    s.id === active?.id
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="text-base flex-shrink-0">{meta.emoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{s.store_name}</span>
                    <span className="block text-[10px] font-normal text-muted-foreground truncate">{meta.name}</span>
                  </span>
                  {s.id === active?.id && <Check className="h-4 w-4 flex-shrink-0" />}
                </button>
              );
            })}
            <div className="border-t border-border pt-1 mt-1">
              <button
                type="button"
                onClick={() => {
                  setFormErr("");
                  setWizardOpen(true);
                }}
                disabled={busy}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm font-medium text-left text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <span className="text-base flex-shrink-0">➕</span>
                <span className="flex-1 truncate">Sumar otro comercio</span>
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {wizardOpen && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
          onClick={() => !busy && setWizardOpen(false)}
        >
          <form
            onSubmit={createStore}
            className="bg-card rounded-2xl p-5 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-display text-base font-semibold">
                {impersonating ? "Sumar comercio al dueño" : "Sumar otro comercio"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {impersonating
                  ? "Se crea a nombre del dueño del comercio impersonado; quedás administrándolo."
                  : "Nueva tienda independiente: micrositio y QR propios, plan Gratuito."}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Nombre del comercio</label>
              <input
                value={form.store_name}
                onChange={(e) => setForm({ ...form, store_name: e.target.value })}
                placeholder="Ej: Panadería Don Pan"
                maxLength={60}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Rubro</label>
              <select
                value={form.vertical}
                onChange={(e) => setForm({ ...form, vertical: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              >
                {VERTICALS.filter((v) => v.slug !== "salud").map((v) => (
                  <option key={v.slug} value={v.slug}>{v.emoji} {v.name}</option>
                ))}
                <option value="otro">📋 Otro</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">WhatsApp del negocio</label>
              <input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="Ej: 221 555 5555"
                inputMode="tel"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Barrio</label>
              <input
                value={form.neighborhood}
                onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
                placeholder="Sicardi / Garibaldi"
                maxLength={40}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            {formErr && <p className="text-xs text-red-500">{formErr}</p>}
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" className="flex-1" disabled={busy}>
                {busy ? "Creando..." : "Crear comercio"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setWizardOpen(false)}
                disabled={busy}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </>
  );
}
