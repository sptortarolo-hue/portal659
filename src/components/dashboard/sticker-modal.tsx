"use client";

/**
 * Emisor de etiquetas adhesivas — el corazón del módulo.
 *
 * Flujo de mostrador: elegís el producto (o lo escaneás), la balanza pesa en
 * vivo, la etiqueta en pantalla es EXACTAMENTE la que sale por la impresora,
 * se imprime y se queda lista para el siguiente producto sin cerrar el modal.
 *
 * El servidor recalcula precio, total e importe codificado desde la DB; el
 * cliente solo manda los kilos pesados.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  arISODate,
  addDaysISO,
  buildLabelSpec,
  fmtKg,
  fmtMoney,
  labelPixelSize,
  readLabelPrinterConfig,
  LABEL_TEMPLATES,
  type LabelContent,
  type LabelTemplateId,
} from "@/lib/label-spec";
import { drawLabel } from "@/lib/label-render";
import { readScaleLabelConfig } from "@/lib/scale-barcode";
import {
  getCachedScalePort,
  isWebSerialSupported,
  requestScalePort,
  watchScale,
  type WatchHandle,
} from "@/lib/scale-reader";

type StickerProduct = {
  id: string;
  name: string;
  price?: number | string | null;
  promo_price?: number | string | null;
  unit?: string | null;
  sku?: string | null;
  scale_plu?: string | null;
  expires_at?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  vendor: Record<string, any> | null | undefined;
  offers?: StickerProduct[];
};

const SHELF_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: "Sin sugerir" },
  { days: 7, label: "+7 días" },
  { days: 15, label: "+15 días" },
  { days: 30, label: "+30 días" },
];

const QUICK_KG: { kg: number; label: string }[] = [
  { kg: 0.25, label: "250 g" },
  { kg: 0.5, label: "500 g" },
  { kg: 1, label: "1 kg" },
  { kg: 1.5, label: "1,5 kg" },
];

function unitPriceOf(p: StickerProduct): number {
  return Number(p.promo_price ?? p.price) || 0;
}

function parseKgInput(raw: string): number | null {
  if (!raw.trim()) return null;
  const v = Number(raw.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) / 1000 : null;
}

export function StickerModal({ open, onClose, vendor, offers }: Props) {
  const catalog = useMemo(() => (Array.isArray(offers) ? offers : []), [offers]);
  const cfg = useMemo(
    () => readLabelPrinterConfig((vendor as any)?.label_printer_config),
    [vendor]
  );

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StickerProduct | null>(null);
  const [kgLive, setKgLive] = useState<number | null>(null);
  const [kgManual, setKgManual] = useState("");
  const [autoPrint, setAutoPrint] = useState(false);
  const [copies, setCopies] = useState(1);
  const [template, setTemplate] = useState<LabelTemplateId>(cfg.tpl);
  const [shelfLifeDays, setShelfLifeDays] = useState<number | null>(cfg.shelfLifeDays);
  const [packedAt, setPackedAt] = useState(() => arISODate());
  const [scaleState, setScaleState] = useState<"idle" | "connecting" | "watching" | "error">(
    "idle"
  );
  const [scaleMsg, setScaleMsg] = useState<string | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [printMsg, setPrintMsg] = useState<string | null>(null);
  const [printErr, setPrintErr] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const watchRef = useRef<WatchHandle | null>(null);
  const stableKgRef = useRef<number | null>(null);
  const stableSinceRef = useRef(0);
  const lastAutoPrintedRef = useRef<number | null>(null);

  const isKgProduct = selected ? String(selected.unit ?? "unidad") === "kg" : false;
  const effectiveKg = isKgProduct
    ? kgLive ?? parseKgInput(kgManual)
    : null;
  const limitKg = effectiveKg != null && effectiveKg > 0;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (p: StickerProduct) => {
      if (!q) return true;
      const hay = `${String(p.name).toLowerCase()} ${String(p.sku ?? "").toLowerCase()} ${String(
        p.scale_plu ?? ""
      ).toLowerCase()}`;
      return q.split(/\s+/).every((token) => hay.includes(token));
    };
    return catalog.filter(matches).slice(0, 12);
  }, [catalog, query]);

  // ── Contenido de la etiqueta (mismo cálculo que el server) ────────────────
  const preview = useMemo(() => {
    if (!selected) return null;
    const price = unitPriceOf(selected);
    const isKg = isKgProduct;
    const kg = isKg ? effectiveKg : null;
    const total = isKg ? Math.round((kg || 0) * price * 100) / 100 : price;
    const packed = packedAt;
    let expiresAt: string | null = null;
    const isEnvasado = template === "envasado";
    if (isEnvasado) {
      const m = String(selected.expires_at ?? "").match(/^\d{4}-\d{2}-\d{2}$/);
      if (m) expiresAt = m[0];
      else if (shelfLifeDays && shelfLifeDays > 0) expiresAt = addDaysISO(packed, shelfLifeDays);
    }
    const priceWithPromo = selected.promo_price != null ? Number(selected.price) : null;
    const content: LabelContent = {
      template,
      storeName: String((vendor as any)?.store_name || "Mi comercio"),
      productName: String(selected.name),
      brand: null,
      plu: isKg && selected.scale_plu ? String(selected.scale_plu) : null,
      unit: isKg ? "kg" : "unidad",
      price,
      oldPrice: priceWithPromo != null && priceWithPromo > price ? priceWithPromo : null,
      kg,
      total,
      packedAt: isEnvasado ? packed : null,
      expiresAt,
      code: String(selected.sku ?? "").trim() || String(selected.id).slice(0, 8).toUpperCase(),
    };
    const scaleCfg =
      isKg && selected.scale_plu ? readScaleLabelConfig((vendor as any)?.scale_label_config) : null;
    const spec = buildLabelSpec(content, cfg, {
      scaleFormat: scaleCfg && scaleCfg.enabled ? scaleCfg : null,
    });
    return { content, spec };
  }, [selected, cfg, effectiveKg, template, packedAt, shelfLifeDays, isKgProduct, vendor]);

  // Dibujar la etiqueta en el canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview) return;
    drawLabel(canvas, preview.spec);
  }, [preview]);

  const printNow = useCallback(
    async (auto: boolean) => {
      if (!selected) return;
      if (isKgProduct && !(effectiveKg && effectiveKg > 0)) {
        setPrintErr("Poné el producto en la balanza o cargá los kilos a mano.");
        return;
      }
      setPrintBusy(true);
      if (!auto) {
        setPrintMsg(null);
        setPrintErr(null);
      }
      try {
        const res = await fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "sticker",
            productId: selected.id,
            kg: isKgProduct ? effectiveKg : null,
            copies,
            template,
            packedAt,
            shelfLifeDays: shelfLifeDays ?? null,
          }),
        });
        const data = await res.json().catch(() => null);
        if (data?.ok) {
          setPrintMsg(
            `✅ “${selected.name}” — TOTAL ${fmtMoney(Number(data.total) || 0, 2)} impresa (${data.barcode?.digits ?? data.code ?? ""}).`
          );
          setPrintErr(null);
        } else {
          setPrintErr(data?.error || "No se pudo imprimir la etiqueta.");
        }
      } catch {
        setPrintErr("No se pudo hablar con el servidor. Reintentá.");
      } finally {
        setPrintBusy(false);
      }
    },
    [selected, isKgProduct, effectiveKg, copies, template, packedAt, shelfLifeDays]
  );

  const maybeAutoPrint = useCallback(
    (kg: number | null) => {
      if (!autoPrint) return;
      const now = Date.now();
      if (kg == null || kg <= 0.05) {
        stableKgRef.current = null;
        lastAutoPrintedRef.current = null;
        return;
      }
      const rounded = Math.round(kg * 1000) / 1000;
      if (stableKgRef.current == null || Math.abs(rounded - stableKgRef.current) > 0.006) {
        stableKgRef.current = rounded;
        stableSinceRef.current = now;
        return;
      }
      if (now - stableSinceRef.current >= 1500 && lastAutoPrintedRef.current !== rounded) {
        lastAutoPrintedRef.current = rounded;
        void printNow(true);
      }
    },
    [autoPrint, printNow]
  );

  // ── Balanza en vivo ──────────────────────────────────────────────────────
  const stopWatching = useCallback(() => {
    watchRef.current?.stop();
    watchRef.current = null;
    setScaleState("idle");
  }, []);

  const startWatching = useCallback(async () => {
    if (!isWebSerialSupported()) {
      setScaleState("error");
      setScaleMsg("Este navegador no soporta balanza directa. Usá Chrome o Edge; mientras tanto podés cargar los kilos a mano.");
      return;
    }
    setScaleState("connecting");
    setScaleMsg(null);
    try {
      let port = getCachedScalePort();
      if (!port) port = await requestScalePort();
      const handle = await watchScale(port, {
        vendorId: (vendor as any)?.id ?? null,
        onKg: (kg) => {
          setKgLive(kg);
          maybeAutoPrint(kg);
        },
        onError: (msg) => {
          setScaleState("error");
          setScaleMsg(msg);
        },
      });
      watchRef.current = handle;
      setScaleState("watching");
    } catch (e: any) {
      if (e?.name === "NotFoundError") {
        setScaleState("idle");
        return;
      }
      setScaleState("error");
      setScaleMsg(e?.message || "No se pudo abrir la balanza.");
    }
  }, [vendor, maybeAutoPrint]);

  // Al cerrar: parar la balanza y limpiar el estado de la venta.
  useEffect(() => {
    if (!open) {
      stopWatching();
      setQuery("");
      setSelected(null);
      setKgLive(null);
      setKgManual("");
      setAutoPrint(false);
      setCopies(1);
      setTemplate(cfg.tpl);
      setShelfLifeDays(cfg.shelfLifeDays);
      setPackedAt(arISODate());
      setPrintBusy(false);
      setPrintMsg(null);
      setPrintErr(null);
      stableKgRef.current = null;
      stableSinceRef.current = 0;
      lastAutoPrintedRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const previewSize = labelPixelSize(cfg);

  const previewHref =
    selected && (!isKgProduct || effectiveKg)
      ? `/api/vendor/label/preview?productId=${encodeURIComponent(selected.id)}` +
        `&template=${template}&packedAt=${encodeURIComponent(packedAt)}` +
        (isKgProduct ? `&kg=${effectiveKg}` : "") +
        (shelfLifeDays ? `&shelfLifeDays=${shelfLifeDays}` : "")
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="🏷️ Emitir etiqueta"
      size="lg"
      footer={
        <div className="flex flex-wrap items-center gap-2 w-full">
          <button
            type="button"
            onClick={() => printNow(false)}
            disabled={!selected || printBusy || (isKgProduct && !limitKg)}
            className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {printBusy ? "Imprimiendo…" : "🖨️ Imprimir"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-md border border-border text-sm hover:bg-accent"
          >
            Cerrar
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {previewHref && (
              <>
                <a
                  href={previewHref}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 px-3 rounded-md border border-border text-xs inline-flex items-center hover:bg-accent"
                >
                  🖼️ Etiqueta real (PNG)
                </a>
                <a
                  href={`${previewHref}&format=pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 px-3 rounded-md border border-border text-xs inline-flex items-center hover:bg-accent"
                >
                  📄 PDF
                </a>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        {/* ── Columna izquierda: producto ───────────────────────────── */}
        <div className="space-y-3 min-w-0">
          <div>
            <Label htmlFor="st-search">Producto</Label>
            <Input
              id="st-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, SKU o PLU…"
              className="mt-1 h-9"
              autoComplete="off"
              autoFocus
            />
          </div>
          {!selected && (
            <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {results.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Ningún producto coincide. Probá con menos palabras o revisá el catálogo.
                </p>
              ) : (
                results.map((p) => {
                  const isKg = String(p.unit ?? "unidad") === "kg";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium truncate">{p.name}</span>
                        <span className="block text-muted-foreground">
                          {isKg
                            ? `Pesable · ${p.scale_plu ? `PLU ${p.scale_plu}` : "sin PLU"}`
                            : "Por unidad"}
                          {p.sku ? ` · ${p.sku}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {fmtMoney(unitPriceOf(p), unitPriceOf(p) % 1 === 0 ? 0 : 2)}
                        {isKg ? "/kg" : ""}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {selected && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium leading-tight">{selected.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {isKgProduct ? `Pesable${selected.scale_plu ? ` · PLU ${selected.scale_plu}` : ""}` : "Por unidad"}
                    {selected.sku ? ` · ${selected.sku}` : ""}
                    {selected.promo_price != null && Number(selected.promo_price) > 0
                      ? ` · en oferta ${fmtMoney(Number(selected.promo_price), 2)}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="h-7 px-2 rounded-md border border-border text-xs hover:bg-accent shrink-0"
                >
                  Cambiar
                </button>
              </div>
            </div>
          )}

          {/* ── Peso ─────────────────────────────────────────────── */}
          {selected && isKgProduct && (
            <div className="space-y-2">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Peso en la balanza
                  </p>
                  <p
                    className={`text-3xl font-semibold tabular-nums leading-none ${
                      kgLive != null ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {kgLive != null ? fmtKg(kgLive) : "— · — —"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Auto-imprimir</span>
                  <Switch checked={autoPrint} onCheckedChange={setAutoPrint} />
                </div>
              </div>

              {scaleState === "idle" && (
                <button
                  type="button"
                  onClick={startWatching}
                  className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                >
                  ⚖️ Conectar balanza
                </button>
              )}
              {scaleState === "connecting" && (
                <p className="text-xs text-muted-foreground">Abriendo balanza…</p>
              )}
              {scaleState === "watching" && (
                <button
                  type="button"
                  onClick={stopWatching}
                  className="h-8 px-3 rounded-md border border-border text-xs hover:bg-accent"
                >
                  ⏸️ Dejar de pesar
                </button>
              )}
              {scaleState === "error" && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {scaleMsg}{" "}
                  <button onClick={startWatching} className="underline hover:no-underline">
                    Reintentar
                  </button>
                </p>
              )}
              {autoPrint && (
                <p className="text-[11px] text-muted-foreground">
                  Se imprime sola cuando el peso queda quieto 1,5 segundos. Para imprimir otra
                  del mismo producto, volvé a ponerlo en la balanza.
                </p>
              )}

              <div>
                <Label htmlFor="st-kg">…o cargar el peso a mano</Label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Input
                    id="st-kg"
                    inputMode="decimal"
                    value={kgManual}
                    onChange={(e) => setKgManual(e.target.value)}
                    placeholder="0,000"
                    className="h-9 w-28 tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">kg</span>
                  {QUICK_KG.map(({ kg, label }) => (
                    <button
                      key={kg}
                      type="button"
                      onClick={() => setKgManual(String(kg).replace(".", ","))}
                      className="h-8 px-2 rounded-md border border-border text-xs hover:bg-accent"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Copias + plantilla + vencimiento ───────────────────── */}
          {selected && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="st-copies">Copias</Label>
                <Input
                  id="st-copies"
                  type="number"
                  min={1}
                  max={50}
                  value={copies}
                  onChange={(e) => setCopies(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                  className="mt-1 h-9 w-24"
                />
              </div>
              <div>
                <Label htmlFor="st-tpl">Plantilla</Label>
                <select
                  id="st-tpl"
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value as LabelTemplateId)}
                >
                  {Object.entries(LABEL_TEMPLATES).map(([id, t]) => (
                    <option key={id} value={id} title={t.hint}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {template === "envasado" && (
                <div className="sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Vencimiento si la ficha del producto no tiene:
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {SHELF_OPTIONS.map((o) => (
                      <button
                        key={String(o.days)}
                        type="button"
                        onClick={() => setShelfLifeDays(o.days)}
                        className={`h-8 px-2 rounded-md border text-xs ${
                          shelfLifeDays === o.days
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                    <Input
                      type="date"
                      value={packedAt}
                      onChange={(e) => setPackedAt(e.target.value)}
                      className="h-8 w-auto text-xs"
                      title="Fecha de envasado"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Columna derecha: etiqueta en vivo ─────────────────────── */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Vista previa · {previewSize.widthPx}×{previewSize.heightPx} px
          </p>
          <div
            className="rounded-md border border-border bg-white"
            style={{ padding: 6 }}
          >
            {preview ? (
              <canvas
                ref={canvasRef}
                className="block max-w-full h-auto"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <div className="w-64 h-40 flex items-center justify-center text-xs text-muted-foreground">
                Elegí un producto
              </div>
            )}
          </div>
          {preview && (
            <p className="text-xs text-muted-foreground">
              {preview.content.template === "envasado"
                ? `TOTAL ${fmtMoney(preview.content.total, 2)}`
                : `PRECIO ${fmtMoney(preview.content.price, 2)}`}
            </p>
          )}
        </div>
      </div>

      {printMsg && <p className="mt-3 text-xs text-green-700 dark:text-green-400">{printMsg}</p>}
      {printErr && <p className="mt-3 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">{printErr}</p>}
    </Modal>
  );
}
