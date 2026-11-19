"use client";

/**
 * Tarjeta "Impresora de etiquetas adhesivas" (bloque Balanza → Etiquetas).
 * La impresora de etiquetas es DISTINTA a la de tickets: rollo propio,
 * lenguaje propio (TSPL/ZPL/ESC-POS) y cola USB propia detectable con el
 * agente local. Desde acá se calibra y se abre el emisor de etiquetas.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_LABEL_PRINTER_CONFIG,
  LABEL_LANGUAGES,
  LABEL_PRESETS,
  LABEL_SIZE_MAX_MM,
  LABEL_TEMPLATES,
  labelPixelSize,
  readLabelPrinterConfig,
  type LabelLanguage,
  type LabelPrinterConfig,
  type LabelSizeId,
  type LabelTemplateId,
} from "@/lib/label-spec";
import { listLocalUsbPrinters, type UsbPrinterEntry } from "@/lib/local-print";

type Props = {
  vendor: Record<string, any> | null | undefined;
  saveVendor?: (data: Record<string, unknown>) => Promise<void> | void;
};

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function LabelPrinterCard({ vendor, saveVendor }: Props) {
  const [cfg, setCfg] = useState<LabelPrinterConfig>(() =>
    readLabelPrinterConfig((vendor as any)?.label_printer_config)
  );
  const [saving, setSaving] = useState(false);
  const [usbScanning, setUsbScanning] = useState(false);
  const [usbPrinters, setUsbPrinters] = useState<UsbPrinterEntry[] | null>(null);
  const [usbError, setUsbError] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState<string | null>(null);
  const [calibrateMsg, setCalibrateMsg] = useState<string | null>(null);
  const [calibrateErr, setCalibrateErr] = useState<string | null>(null);

  const columnReady =
    !vendor || Object.prototype.hasOwnProperty.call(vendor, "label_printer_config");

  const { widthPx, heightPx } = labelPixelSize(cfg);

  async function persist(next: LabelPrinterConfig) {
    setCfg(next);
    setSaving(true);
    try {
      await saveVendor?.({ label_printer_config: next ?? DEFAULT_LABEL_PRINTER_CONFIG });
    } finally {
      setSaving(false);
    }
  }

  function setSize(size: LabelSizeId) {
    if (size !== "custom") {
      const preset = LABEL_PRESETS[size];
      persist({ ...cfg, size, widthMm: preset.widthMm, heightMm: preset.heightMm });
      return;
    }
    persist({ ...cfg, size });
  }

  async function scanUsb() {
    setUsbScanning(true);
    setUsbError(null);
    try {
      const r = await listLocalUsbPrinters(String((vendor as any)?.id ?? ""));
      if (r.listeners.length === 0 || r.listeners.every((l) => l.printers.length === 0)) {
        setUsbPrinters([]);
        setUsbError(
          r.error ||
            "No apareció ninguna cola USB en este equipo. Revisá que el agente esté abierto y elegí un equipo con la v2.1+."
        );
        return;
      }
      setUsbPrinters(r.listeners.flatMap((l) => l.printers));
    } catch {
      setUsbError("No se pudo hablar con el agente de este equipo.");
    } finally {
      setUsbScanning(false);
    }
  }

  async function calibrate(lang: "tspl" | "zpl" | "escpos") {
    setCalibrating(lang);
    setCalibrateMsg(null);
    setCalibrateErr(null);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "sticker", calibrate: lang }),
      });
      const data = await res.json().catch(() => null);
      if (data?.ok) {
        setCalibrateMsg(`✔ Etiqueta de calibración enviada en ${lang.toUpperCase()}. Revisá qué salió de la impresora.`);
        // Si el lenguaje anduvo, lo dejamos fijado para no volver a preguntar.
        await persist({ ...cfg, language: lang });
      } else {
        setCalibrateErr(data?.error || `No se pudo imprimir con ${lang.toUpperCase()}.`);
      }
    } catch {
      setCalibrateErr("No se pudo hablar con el servidor. Reintentá.");
    } finally {
      setCalibrating(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">🏷️ Impresora de etiquetas adhesivas</p>
          <p className="text-muted-foreground">
            Para pegar en los productos por unidad y en los pesables (fiambrería, carnicería,
            verdulería): nombre, PLU, peso, precio y vencimiento. Es una impresora distinta a la
            de tickets y se configura acá.
          </p>
        </div>
        <Switch
          checked={cfg.enabled}
          disabled={!columnReady}
          onCheckedChange={(v) => persist({ ...cfg, enabled: v })}
        />
      </div>

      {!columnReady && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Falta aplicar <code>supabase/self-host/migrate-label-printer.sql</code> para guardar esta
          configuración.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="lp-size">Medida del rollo</Label>
          <select
            id="lp-size"
            className={`${selectClass} mt-1`}
            value={cfg.size}
            disabled={!columnReady}
            onChange={(e) => setSize(e.target.value as LabelSizeId)}
          >
            {Object.entries(LABEL_PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Personalizado…</option>
          </select>
        </div>
        {cfg.size === "custom" ? (
          <>
            <div>
              <Label htmlFor="lp-custom-w">Ancho (mm)</Label>
              <Input
                id="lp-custom-w"
                type="number"
                min={10}
                max={LABEL_SIZE_MAX_MM}
                className="mt-1 h-9"
                value={cfg.widthMm}
                onChange={(e) =>
                  setCfg((c) => ({ ...c, widthMm: Number(e.target.value) || 50 }))
                }
                onBlur={() => persist(cfg)}
              />
            </div>
            <div>
              <Label htmlFor="lp-custom-h">Alto (mm)</Label>
              <Input
                id="lp-custom-h"
                type="number"
                min={10}
                className="mt-1 h-9"
                value={cfg.heightMm}
                onChange={(e) =>
                  setCfg((c) => ({ ...c, heightMm: Number(e.target.value) || 30 }))
                }
                onBlur={() => persist(cfg)}
              />
            </div>
          </>
        ) : null}
        <div>
          <Label htmlFor="lp-tpl">Plantilla de etiqueta</Label>
          <select
            id="lp-tpl"
            className={`${selectClass} mt-1`}
            value={cfg.tpl}
            onChange={(e) => persist({ ...cfg, tpl: e.target.value as LabelTemplateId })}
          >
            {Object.entries(LABEL_TEMPLATES).map(([id, t]) => (
              <option key={id} value={id} title={t.hint}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{LABEL_TEMPLATES[cfg.tpl].hint}</p>
        </div>
        <div>
          <Label htmlFor="lp-lang">Lenguaje de la impresora</Label>
          <select
            id="lp-lang"
            className={`${selectClass} mt-1`}
            value={cfg.language}
            onChange={(e) => persist({ ...cfg, language: e.target.value as LabelLanguage })}
          >
            {Object.entries(LABEL_LANGUAGES).map(([id, l]) => (
              <option key={id} value={id} title={l.hint}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {LABEL_LANGUAGES[cfg.language].hint}
          </p>
        </div>
      </div>

      {/* Hueco (gap) entre etiquetas */}
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
        <p className="font-medium text-sm">📏 Hueco entre etiquetas (gap)</p>
        <div className="flex items-center gap-2">
          <Input
            id="lp-gap"
            type="number"
            min={1}
            max={10}
            step={0.5}
            className="h-9 w-24"
            value={cfg.gapMm}
            disabled={!columnReady}
            onChange={(e) =>
              setCfg((c) => ({ ...c, gapMm: Number(e.target.value) || 2 }))
            }
            onBlur={() => persist(cfg)}
          />
          <span className="text-sm text-muted-foreground">mm</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Medilo con regla del borde de una etiqueta al borde de la siguiente. Si la impresora
          imprime en el medio o no reconoce la etiqueta, ajustá este valor (típico 2–4 mm).
        </p>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Label htmlFor="lp-invert" className="text-sm">Negativo (invertir colores)</Label>
          <Switch
            id="lp-invert"
            checked={cfg.invert}
            disabled={!columnReady}
            onCheckedChange={(v) => persist({ ...cfg, invert: v })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Activá si la etiqueta sale invertida (más negro que blanco).
        </p>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
        <p className="flex items-center gap-2 font-medium">
          🧪 Calibrar impresora
          <span className="text-xs font-normal text-muted-foreground">
            (la impresora está en USB y este equipo tiene el agente de impresión abierto)
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {(["tspl", "zpl", "escpos"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              disabled={calibrating !== null || !columnReady || !cfg.usbName}
              onClick={() => calibrate(lang)}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              {calibrating === lang ? "Probando…" : `Probar ${lang.toUpperCase()}`}
            </button>
          ))}
        </div>
        {!cfg.usbName && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Primero elegí la <strong>cola USB</strong> de la impresora de etiquetas (debajo) y volvé a
            probar.
          </p>
        )}
        {calibrateMsg && <p className="text-xs text-green-700 dark:text-green-400">{calibrateMsg}</p>}
        {calibrateErr && (
          <p className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">{calibrateErr}</p>
        )}
      </div>

      {/* Cola USB */}
      <div className="space-y-2">
        <Label htmlFor="lp-usb">Cola USB en esta PC (la que usa la PL-500 u otra)</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="lp-usb"
            value={cfg.usbName}
            onChange={(e) => setCfg((c) => ({ ...c, usbName: e.target.value }))}
            onBlur={() => persist(cfg)}
            placeholder="Ej: Elitronic PL-500"
            className="h-9 flex-1 min-w-[220px]"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={scanUsb}
            disabled={usbScanning || !columnReady}
            className="h-9 px-3 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
          >
            {usbScanning ? "Buscando…" : "🔎 Buscar colas"}
          </button>
        </div>
        {usbPrinters && usbPrinters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {usbPrinters.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => persist({ ...cfg, usbName: p.name })}
                className="h-8 px-3 rounded-full border border-border text-xs hover:bg-accent"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        {usbError && <p className="text-xs text-amber-700 dark:text-amber-400">{usbError}</p>}
        <p className="text-[11px] text-muted-foreground">
          La cola se guarda en el comercio: cada PC que imprima etiquetas tiene que usar el agente de
          "Portal Print" y tener la impresora instalada en Windows. Tamaño actual: {widthPx}×{heightPx} px
          (203 dpi).
        </p>
      </div>

      {/* Por dónde se emite */}
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        🏷️ Para <strong>imprimir</strong> etiquetas vas a{" "}
        <strong>Catálogo → Productos → 🏷️ Etiquetas → solapa “Adhesiva (PL-500)”</strong>: ahí
        buscás el producto, pesás en vivo y sale. Esta sección queda para configurar la impresora y
        calibrarla.
      </p>
    </div>
  );
}
