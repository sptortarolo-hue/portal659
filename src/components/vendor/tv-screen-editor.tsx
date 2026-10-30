"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TV_THEME_LABELS, TV_THEME_SWATCH, type TvThemeTokens } from "@/components/tv/tv-themes";
import { TvPlayer } from "@/components/tv/tv-player";
import { TV_THEMES, normalizeTvConfig, TV_LAYOUT_CHOICES, type TvConfig } from "@/lib/tv-config";
import type { TvSnapshot } from "@/lib/tv-snapshot";

type ScreenApi = {
  id: string;
  name: string;
  kind: string;
  token: string;
  version: number;
  publishedAt: string | null;
  lastSeenAt: string | null;
  published: boolean;
  unpublishedDraft: boolean;
  config: TvConfig;
};

const DAYS = ["D", "L", "M", "X", "J", "V", "S"];

type Props = {
  open: boolean;
  screen: ScreenApi | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Editor de la pantalla con PREVIEW REAL: renderiza el mismo reproductor que
 * ve la TV, alimentado por el borrador. "Cómo queda" y "cómo se ve" no pueden
 * divergir, y no hace falta publicar para probar un cambio.
 */
export function TvScreenEditor({ open, screen, categories, onClose, onSaved }: Props) {
  const [config, setConfig] = useState<TvConfig>(() => normalizeTvConfig(screen?.config));
  const [snapshot, setSnapshot] = useState<TvSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open && screen) setConfig(normalizeTvConfig(screen.config));
    setDirty(false);
    setMsg(null);
  }, [open, screen]);

  // Preview: snapshot del BORRADOR (el borrador se guarda en cada cambio, así
  // que este endpoint devuelve exactamente lo que está editando).
  const loadPreview = useCallback(async () => {
    if (!screen) return;
    try {
      const r = await fetch(`/api/vendor/tv-screens/${screen.id}/preview`, { cache: "no-store" });
      if (r.ok) setSnapshot((await r.json()) as TvSnapshot);
    } catch {
      /* el preview es best-effort: no rompe la edición */
    }
  }, [screen]);

  useEffect(() => {
    if (!open || !screen) return;
    const id = setTimeout(loadPreview, 300);
    return () => clearTimeout(id);
  }, [open, screen, config, loadPreview]);

  /** Cada cambio guarda como BORRADOR (la TV no se entera hasta Publicar). */
  const edit = (patch: Partial<TvConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
    setMsg(null);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      if (!screen) return;
      await fetch(`/api/vendor/tv-screens/${screen.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...config, ...patch } }),
      }).catch(() => {});
      onSaved();
    }, 700);
  };

  const items = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.sections.flatMap((s) => s.items.map((i) => ({ id: i.id, name: i.name, priceLabel: i.priceLabel })));
  }, [snapshot]);

  const toggleDay = (idx: number, day: number) => {
    const next = config.dayparts.map((d, i) => {
      if (i !== idx) return d;
      const has = d.days.includes(day);
      return { ...d, days: has ? d.days.filter((x) => x !== day) : [...d.days, day].sort() };
    });
    edit({ dayparts: next });
  };

  if (!screen) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Editar ${screen.name}`}
      footer={
        <div className="flex w-full items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {dirty ? "Guardado como borrador · publicá para que la TV lo muestre" : "Sin cambios"}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            <Button
              onClick={async () => {
                setSaving(true);
                const r = await fetch(`/api/vendor/tv-screens/${screen.id}/publish`, { method: "POST" }).catch(() => null);
                setSaving(false);
                setDirty(false);
                setMsg(r && r.ok ? "Publicado: la TV se actualiza sola." : "No se pudo publicar.");
                onSaved();
              }}
              disabled={saving}
            >
              {saving ? "Publicando…" : "Publicar en la TV"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_640px]">
        {/* ------------------------------------------------ configuración */}
        <div className="space-y-6">
          <Field label="Tema">
            <div className="grid grid-cols-4 gap-2">
              {TV_THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => edit({ theme: t })}
                  className={`rounded-xl border-2 p-2 text-left transition-colors ${
                    config.theme === t ? "border-primary" : "border-border hover:border-primary/40"
                  }`}
                >
                  <span
                    className="mb-1 block h-8 rounded-lg"
                    style={{ background: TV_THEME_SWATCH[t].bg, border: `2px solid ${TV_THEME_SWATCH[t].accent}` }}
                  />
                  <span className="text-[11px] font-medium">{TV_THEME_LABELS[t]}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Densidad">
            <RadioCards
              options={TV_LAYOUT_CHOICES.map((c) => ({ label: c.label, value: String(c.columns), icon: "▦", desc: c.hint }))}
              value={String(config.columns)}
              onChange={(v) => edit({ columns: Number(v) as TvConfig["columns"] })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Duración de cada pantalla">
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={config.slideSeconds}
                onChange={(e) => edit({ slideSeconds: Number(e.target.value) as TvConfig["slideSeconds"] })}
              >
                <option value={6}>6 segundos</option>
                <option value={10}>10 segundos</option>
                <option value={15}>15 segundos</option>
                <option value={20}>20 segundos</option>
              </select>
            </Field>
            <Field label="Fotos de producto">
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={config.photoStyle}
                onChange={(e) => edit({ photoStyle: e.target.value as TvConfig["photoStyle"] })}
              >
                <option value="thumb">Con foto</option>
                <option value="none">Solo texto (carta más larga)</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Toggle label="Mostrar precios" value={config.showPrices} onChange={(v) => edit({ showPrices: v })} />
            <Toggle label="Mostrar descripciones" value={config.showDescriptions} onChange={(v) => edit({ showDescriptions: v })} />
            <Toggle label="Ocultar agotados" value={config.hideSoldOut} onChange={(v) => edit({ hideSoldOut: v })} />
            <Toggle label="Reloj" value={config.showClock} onChange={(v) => edit({ showClock: v })} />
            <Toggle label="Pantalla de cerrado" value={config.closedScreen} onChange={(v) => edit({ closedScreen: v })} />
            <Toggle label="Cinta inferior" value={config.ticker.enabled} onChange={(v) => edit({ ticker: { ...config.ticker, enabled: v } })} />

          </div>

          {config.ticker.enabled && (
            <Field label="Texto de la cinta">
              <input
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={config.ticker.text}
                onChange={(e) => edit({ ticker: { ...config.ticker, text: e.target.value } })}
                placeholder="Ej: Envíos sin cargo desde $8.000"
              />
            </Field>
          )}

          <Field label="Categorías (arrastrá el orden con las flechas)">
            <div className="space-y-1.5">
              {categories.length === 0 && <p className="text-xs text-muted-foreground">Todas las de tu carta.</p>}
              {config.categories.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                  <input
                    type="checkbox"
                    checked={c.visible}
                    onChange={(e) => {
                      const next = config.categories.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x));
                      edit({ categories: next });
                    }}
                  />
                  <span className="flex-1 truncate text-sm">{c.id}</span>
                  <button
                    type="button"
                    className="px-1 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      if (i === 0) return;
                      const next = [...config.categories];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      edit({ categories: next });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="px-1 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      if (i === config.categories.length - 1) return;
                      const next = [...config.categories];
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      edit({ categories: next });
                    }}
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>
          </Field>

          <Field label="Destacado (banda de arriba)">
            <div className="flex gap-2">
              {(["auto", "manual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => edit({ hero: { ...config.hero, mode: m } })}
                  className={`rounded-lg border-2 px-3 py-1.5 text-xs font-medium ${
                    config.hero.mode === m ? "border-primary text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {m === "auto" ? "Automático (ofertas)" : "Elegir a mano"}
                </button>
              ))}
            </div>
            {config.hero.mode === "manual" && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Elegí hasta 3 desde el preview: se guardan como destacados.
              </p>
            )}
          </Field>

          <Field label="Upsell (zona que más vende)">
            <div className="flex items-center gap-2">
              <Switch checked={config.upsell.enabled} onCheckedChange={(v) => edit({ upsell: { ...config.upsell, enabled: v } })} />
              <span className="text-sm">Mostrar “sumá …”</span>
            </div>
            {config.upsell.enabled && (
              <>
                <input
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={config.upsell.text}
                  onChange={(e) => edit({ upsell: { ...config.upsell, text: e.target.value } })}
                  placeholder="Hacelo combo con papas"
                />
                <select
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={config.upsell.productId ?? ""}
                  onChange={(e) => edit({ upsell: { ...config.upsell, productId: e.target.value || null } })}
                >
                  <option value="">Sin producto (solo texto)</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} {i.priceLabel ? `· ${i.priceLabel}` : ""}
                    </option>
                  ))}
                </select>
              </>
            )}
          </Field>

          <Field label="Franjas horarias (desayuno / almuerzo / cena)">
            <div className="space-y-2">
              {config.dayparts.map((d, i) => (
                <div key={d.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                      value={d.label}
                      onChange={(e) => {
                        const next = config.dayparts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x));
                        edit({ dayparts: next });
                      }}
                      placeholder="Almuerzo"
                    />
                    <input
                      type="time"
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                      value={d.from}
                      onChange={(e) => {
                        const next = config.dayparts.map((x, j) => (j === i ? { ...x, from: e.target.value } : x));
                        edit({ dayparts: next });
                      }}
                    />
                    <input
                      type="time"
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                      value={d.to}
                      onChange={(e) => {
                        const next = config.dayparts.map((x, j) => (j === i ? { ...x, to: e.target.value } : x));
                        edit({ dayparts: next });
                      }}
                    />
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => edit({ dayparts: config.dayparts.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex gap-1">
                    {DAYS.map((lbl, day) => {
                      const on = d.days.length === 0 || d.days.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleDay(i, day)}
                          className={`h-7 w-7 rounded-md border text-[11px] font-semibold ${
                            on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                          }`}
                        >
                          {lbl}
                        </button>
                      );
                    })}
                    <span className="ml-2 self-center text-[10px] text-muted-foreground">
                      todos marcados = todos los días
                    </span>
                  </div>
                </div>
              ))}
              <Button
                variant="secondary"
                onClick={() =>
                  edit({
                    dayparts: [
                      ...config.dayparts,
                      { id: Math.random().toString(36).slice(2, 8), label: "Almuerzo", from: "11:30", to: "15:00", days: [], categoryIds: [], theme: "" },
                    ],
                  })
                }
              >
                + Agregar franja
              </Button>
            </div>
          </Field>

          <Field label="Pie de pantalla">
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={config.footerText}
              onChange={(e) => edit({ footerText: e.target.value })}
              placeholder="Ej: Delivery 221 201 0898"
            />
          </Field>

          {msg && <p className="text-xs font-medium text-primary">{msg}</p>}
        </div>

        {/* ---------------------------------------------------- preview */}
        <div className="lg:sticky lg:top-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vista previa (16:9)</p>
          <div className="overflow-hidden rounded-xl border border-border bg-black" style={{ aspectRatio: "16 / 9" }}>
            {snapshot ? (
              <TvPlayer snapshot={snapshot} token="" mode="preview" debug={false} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando…</div>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Lo que ves acá es exactamente lo que muestra la TV (mismo reproductor, mismos datos).
          </p>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <Switch checked={value} onCheckedChange={onChange} />
      <span className="flex-1">{label}</span>
    </label>
  );
}

function RadioCards({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string; icon: string; desc?: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-xl border-2 p-2 text-center text-xs font-medium transition-colors ${
            value === o.value ? "border-primary text-primary" : "border-border text-muted-foreground"
          }`}
        >
          <span className="block text-base">{o.icon}</span>
          {o.label}
          {o.desc && <span className="mt-0.5 block text-[10px] text-muted-foreground">{o.desc}</span>}
        </button>
      ))}
    </div>
  );
}

export type { ScreenApi };
