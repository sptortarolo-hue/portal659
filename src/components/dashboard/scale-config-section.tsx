"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  fmtScaleKg,
  guessScaleLabelFormats,
  normalizePlu,
  parseScaleLabel,
  readScaleLabelConfig,
  scaleLabelFormatSummary,
  scaleLabelLength,
  type ScaleFormatGuess,
  type ScaleLabelConfig,
} from "@/lib/scale-barcode";
import {
  isWebSerialSupported,
  getCachedScalePort,
  setCachedScalePort,
  requestScalePort,
  readScaleFromPort,
  ScaleUnparsedError,
  diagnoseScale,
  continuousRead,
  paramsLabel,
  paramsKey,
  BAUDS,
  type PortParams,
  type DiagComboResult,
} from "@/lib/scale-reader";
import { LabelPrinterCard } from "@/components/dashboard/label-printer-card";

type ScaleProduct = {
  id: string;
  name: string;
  price?: number | string | null;
  promo_price?: number | string | null;
  unit?: string | null;
  sku?: string | null;
  scale_plu?: string | null;
};

type Props = {
  vendor?: Record<string, any> | null;
  saveVendor?: (data: Record<string, unknown>) => Promise<void> | void;
  /** Catálogo (para matchear PLU en la prueba y la detección de formato). */
  offers?: ScaleProduct[];
};

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/** Busca el producto por PLU de balanza, con fallback al SKU. */
function findProductByPlu(offers: ScaleProduct[], plu: string): ScaleProduct | null {
  const n = normalizePlu(plu);
  if (!n) return null;
  return (
    offers.find((o) => normalizePlu(o.scale_plu) === n) ||
    offers.find((o) => normalizePlu(o.sku) === n) ||
    null
  );
}

function unitPriceOf(p: ScaleProduct): number {
  return Number(p.promo_price ?? p.price) || 0;
}

/**
 * Sección "Balanza" de Configuración (comercio de barrio): etiquetas con
 * lector + guía de conexión universal + probador con diagnóstico crudo.
 *
 * Las etiquetas son EAN-13 "de medida variable": prefijo + PLU + peso/importe
 * + dígito verificador impresos por la balanza. El formato varía por marca, por
 * eso se configura acá (una sola vez) y el Mostrador lo usa al escanear.
 */
export function ScaleConfigSection({ vendor, saveVendor, offers }: Props) {
  const catalog = useMemo(() => (Array.isArray(offers) ? offers : []), [offers]);

  // Config de etiquetas. Se resincroniza solo si el server devuelve otra cosa
  // (un cambio guardado), para no pisar lo que se está editando.
  const incoming = useMemo(
    () => JSON.stringify(readScaleLabelConfig((vendor as any)?.scale_label_config)),
    [vendor]
  );
  const [cfg, setCfg] = useState<ScaleLabelConfig>(() =>
    readScaleLabelConfig((vendor as any)?.scale_label_config)
  );
  const [synced, setSynced] = useState(incoming);
  useEffect(() => {
    if (incoming === synced) return;
    setCfg(readScaleLabelConfig(JSON.parse(incoming)));
    setSynced(incoming);
  }, [incoming, synced]);

  // Sin la migración, `vendor` no trae la columna. No bloqueamos el ABM: se
  // avisa y el switch no se puede guardar.
  const columnReady = !vendor || Object.prototype.hasOwnProperty.call(vendor, "scale_label_config");

  const [saving, setSaving] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [guesses, setGuesses] = useState<ScaleFormatGuess[] | null>(null);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  const parsed = useMemo(
    () => (testCode.trim() ? parseScaleLabel(testCode, cfg) : null),
    [testCode, cfg]
  );
  const testProduct = parsed ? findProductByPlu(catalog, parsed.plu) : null;
  const testTotal =
    parsed && testProduct
      ? parsed.kind === "peso"
        ? Math.round((parsed.kg || 0) * unitPriceOf(testProduct) * 100) / 100
        : parsed.amount || 0
      : 0;

  const length = scaleLabelLength(cfg);

  async function persist(next: ScaleLabelConfig) {
    setCfg(next);
    setSaving(true);
    try {
      await saveVendor?.({ scale_label_config: next });
    } finally {
      setSaving(false);
    }
  }

  function detectFormat() {
    setDetectMsg(null);
    setGuesses(null);
    const code = testCode.trim();
    if (!code) {
      setDetectMsg("Primero escaneá o pegá una etiqueta de un producto que ya tenga PLU.");
      return;
    }
    const known: string[] = [];
    for (const p of catalog) {
      const plu = normalizePlu(p.scale_plu);
      if (plu && /^\d+$/.test(plu)) known.push(plu);
      else {
        const sku = normalizePlu(p.sku);
        if (sku && /^\d+$/.test(sku)) known.push(sku);
      }
    }
    if (known.length === 0) {
      setDetectMsg(
        "Ningún producto tiene PLU cargado. Cargá el PLU en Catálogo (productos “Por peso”) y volvé a probar."
      );
      return;
    }
    const found = guessScaleLabelFormats(code, known);
    if (found.length === 0) {
      setDetectMsg(
        "No pude detectar el formato con esa etiqueta. Verificá que el producto tenga el PLU correcto cargado."
      );
      return;
    }
    setGuesses(found);
    if (found.length === 1) {
      setCfg({ ...found[0].config, enabled: true });
      setDetectMsg(
        `Formato detectado: ${scaleLabelFormatSummary(found[0].config)}. Revisá y tocá “Guardar formato”.`
      );
    } else {
      setDetectMsg(
        `Hay ${found.length} formatos posibles con esa etiqueta. Elegí el que muestre el producto correcto.`
      );
    }
  }

  function applyGuess(g: ScaleFormatGuess) {
    setCfg({ ...g.config, enabled: true });
    const p = findProductByPlu(catalog, g.plu);
    setDetectMsg(
      `Formato aplicado: ${scaleLabelFormatSummary(g.config)}${
        p ? ` → “${p.name}”` : ""
      }. Revisá y tocá “Guardar formato”.`
    );
    setGuesses(null);
  }

  // ── Probador de balanza física (sin cambios) ──────────────────────────────
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function testScale(forcePicker: boolean) {
    setBusy(true);
    setOkMsg(null);
    setErrMsg(null);
    try {
      if (!isWebSerialSupported()) {
        setErrMsg("Este navegador no soporta balanza directa. Usá Chrome o Edge en la PC.");
        return;
      }
      let port = getCachedScalePort();
      if (!port || forcePicker) port = await requestScalePort();
      setCachedScalePort(port);
      const { kg, baud } = await readScaleFromPort(port, { onBaud: () => {} });
      setOkMsg(
        `✔ Balanza OK: leyó ${kg.toLocaleString("es-AR", { maximumFractionDigits: 3 })} kg a ${baud} baudios. En el Mostrador ya podés usar el botón Pesar.`
      );
    } catch (e: any) {
      if (e?.name === "NotFoundError") {
        // El usuario cerró el picker: no es un error.
        return;
      }
      if (e instanceof ScaleUnparsedError) {
        const raw = e.raw.replace(/[^\x20-\x7E]/g, "·").trim().slice(-120);
        setErrMsg(
          `La balanza envió datos pero no se entendieron. A ${e.baud} baudios llegó: «${raw}». Anotá ese texto y avisá a soporte para sumar el formato exacto de tu modelo.`
        );
      } else {
        setErrMsg(e?.message || "No se pudo leer la balanza.");
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Modo diagnóstico: volcado crudo de todas las combinaciones ───────────
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagMsg, setDiagMsg] = useState<string | null>(null);
  const [diagResults, setDiagResults] = useState<DiagComboResult[] | null>(null);
  const [diagProgress, setDiagProgress] = useState<string | null>(null);

  async function runDiagnose(forcePicker: boolean, bauds?: number[]) {
    setDiagBusy(true);
    setDiagMsg(null);
    setDiagResults(null);
    setDiagProgress(null);
    try {
      if (!isWebSerialSupported()) {
        setDiagMsg("Este navegador no soporta balanza directa. Usá Chrome o Edge en la PC.");
        return;
      }
      let port = getCachedScalePort();
      if (!port || forcePicker) port = await requestScalePort();
      setCachedScalePort(port);
      const res = await diagnoseScale(port, { onProgress: (l) => setDiagProgress(l), bauds });
      setDiagResults(res.combos);
      if (res.totalBytes === 0) {
        setDiagMsg(
          "No llegó ningún byte en ninguna combinación. Revisá: cable/adaptador, driver instalado, balanza encendida, y probá apretar la tecla Imprimir/Enviar mientras lee."
        );
      } else {
        const winners = res.combos.filter((c) => c.bytes > 0);
        setDiagMsg(
          `Llegaron ${res.totalBytes} bytes en ${winners.length} combinación(es). Copiá el volcado de abajo y pasalo a soporte.`
        );
      }
    } catch (e: any) {
      if (e?.name === "NotFoundError") return;
      setDiagMsg(e?.message || "No se pudo diagnosticar.");
    } finally {
      setDiagBusy(false);
      setDiagProgress(null);
    }
  }

  function copyDiag() {
    if (!diagResults) return;
    const lines: string[] = [];
    for (const c of diagResults) {
      if (c.bytes === 0) continue;
      lines.push(`=== ${paramsLabel(c.params)} (${c.bytes} bytes) ===`);
      lines.push(`HEX: ${c.hex}`);
      lines.push(`ASCII: ${c.raw.replace(/[^\x20-\x7E]/g, "·")}`);
      lines.push("");
    }
    const text = lines.join("\n");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setDiagMsg((prev) => (prev ? prev + " (copiado)" : "Copiado"));
  }

  // ── Lectura continua (para disparar con la tecla Imprimir) ───────────────
  const [contBusy, setContBusy] = useState(false);
  const [contBaud, setContBaud] = useState<number>(9600);
  const [contParity, setContParity] = useState<PortParams["parity"]>("none");
  const [contDataBits, setContDataBits] = useState<7 | 8>(8);
  const [contStopBits, setContStopBits] = useState<1 | 2>(1);
  const [contMsg, setContMsg] = useState<string | null>(null);
  const [contRaw, setContRaw] = useState<string>("");
  const [contHex, setContHex] = useState<string>("");
  const [contBytes, setContBytes] = useState<number>(0);

  async function runContinuous(forcePicker: boolean) {
    setContBusy(true);
    setContMsg(null);
    setContRaw("");
    setContHex("");
    setContBytes(0);
    try {
      if (!isWebSerialSupported()) {
        setContMsg("Este navegador no soporta balanza directa. Usá Chrome o Edge en la PC.");
        return;
      }
      let port = getCachedScalePort();
      if (!port || forcePicker) port = await requestScalePort();
      setCachedScalePort(port);
      const params: PortParams = {
        baudRate: contBaud,
        parity: contParity,
        dataBits: contDataBits,
        stopBits: contStopBits,
      };
      const res = await continuousRead(port, params, {
        ms: 15000,
        onChunk: (s) => {
          setContRaw((prev) => (prev + s).slice(-2000));
          setContHex((prev) => {
            const added = Array.from(s).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
            return (prev + " " + added).trim().slice(-4000);
          });
        },
        onProgress: (m) => setContMsg(m),
      });
      setContBytes(res.bytes);
      if (res.bytes === 0) {
        setContMsg("No llegó ningún byte en 15 s. Probá otra velocidad/paridad o revisá el modo PC de la balanza y el adaptador.");
      } else {
        setContMsg(`✔ Llegaron ${res.bytes} bytes. Copiá el volcado y pasalo a soporte.`);
      }
    } catch (e: any) {
      if (e?.name === "NotFoundError") return;
      setContMsg(e?.message || "No se pudo leer.");
    } finally {
      setContBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Etiquetas de balanza */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">🏷️ Etiquetas con lector</p>
            <p className="text-muted-foreground">
              Leé con el lector de barras la etiqueta que imprime tu balanza (código con el
              PLU y el peso) y el producto entra solo al Mostrador, con los kilos ya cargados.
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
            Falta aplicar <code>supabase/self-host/migrate-scale-labels.sql</code> para guardar
            esta configuración.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="scale-prefix">Prefijo</Label>
            <Input
              id="scale-prefix"
              inputMode="numeric"
              value={cfg.prefix}
              maxLength={4}
              onChange={(e) =>
                setCfg((c) => ({ ...c, prefix: e.target.value.replace(/\D+/g, "").slice(0, 4) }))
              }
              placeholder="2"
              className="mt-1 h-9"
            />
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Lo que va antes del PLU (casi siempre 2).
            </p>
          </div>
          <div>
            <Label htmlFor="scale-plu-digits">Dígitos del PLU</Label>
            <select
              id="scale-plu-digits"
              className={`${selectClass} mt-1`}
              value={cfg.pluDigits}
              onChange={(e) => setCfg((c) => ({ ...c, pluDigits: Number(e.target.value) }))}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="scale-value-digits">Dígitos del valor</Label>
            <select
              id="scale-value-digits"
              className={`${selectClass} mt-1`}
              value={cfg.valueDigits}
              onChange={(e) => setCfg((c) => ({ ...c, valueDigits: Number(e.target.value) }))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="scale-value-kind">El valor es</Label>
            <select
              id="scale-value-kind"
              className={`${selectClass} mt-1`}
              value={cfg.valueKind}
              onChange={(e) =>
                setCfg((c) => ({ ...c, valueKind: e.target.value as ScaleLabelConfig["valueKind"] }))
              }
            >
              <option value="peso_g">Peso en gramos</option>
              <option value="peso_kg">Peso en kilos</option>
              <option value="importe">Importe en pesos</option>
            </select>
          </div>
          <div>
            <Label htmlFor="scale-decimals">Decimales del valor</Label>
            <select
              id="scale-decimals"
              className={`${selectClass} mt-1`}
              value={cfg.decimals}
              disabled={cfg.valueKind === "peso_g"}
              onChange={(e) => setCfg((c) => ({ ...c, decimals: Number(e.target.value) }))}
            >
              <option value={0}>0 (entero)</option>
              <option value={1}>1 (décima)</option>
              <option value={2}>2 (centésima)</option>
              <option value={3}>3 (milésima)</option>
            </select>
          </div>
          <div>
            <Label htmlFor="scale-check-digit">Dígito verificador</Label>
            <select
              id="scale-check-digit"
              className={`${selectClass} mt-1`}
              value={cfg.checkDigit}
              onChange={(e) =>
                setCfg((c) => ({ ...c, checkDigit: e.target.value as ScaleLabelConfig["checkDigit"] }))
              }
            >
              <option value="validar">Validar (recomendado)</option>
              <option value="ignorar">Ignorar (viene pero no se valida)</option>
              <option value="ninguno">No tiene</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {scaleLabelFormatSummary(cfg)}
            {length !== 13 && (
              <span className="text-amber-700 dark:text-amber-400">
                {" "}
                · ojo: las etiquetas de balanza suelen tener 13 dígitos
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => persist(cfg)}
            disabled={saving || !columnReady || !cfg.prefix || cfg.pluDigits < 1}
            className="ml-auto h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar formato"}
          </button>
        </div>

        {/* Probar etiqueta */}
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <Label htmlFor="scale-test">Probar etiqueta</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="scale-test"
              value={testCode}
              onChange={(e) => {
                setTestCode(e.target.value);
                setGuesses(null);
                setDetectMsg(null);
              }}
              placeholder="Escaneá o pegá una etiqueta de la balanza"
              className="h-9 flex-1 min-w-[200px] font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={detectFormat}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-accent"
              title="Adivina el formato a partir de una etiqueta de un producto con PLU"
            >
              🔍 Detectar formato
            </button>
          </div>

          {testCode.trim() && !parsed && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              No coincide con el formato: revisá el largo ({length} dígitos), el prefijo y el
              dígito verificador.
            </p>
          )}
          {parsed && (
            <div className="text-xs space-y-1">
              <p>
                <span className="font-medium">PLU {parsed.plu}</span> ·{" "}
                {parsed.kind === "peso" ? (
                  <span className="font-medium">⚖️ {fmtScaleKg(parsed.kg)}</span>
                ) : (
                  <span className="font-medium">
                    💲 Importe $
                    {(parsed.amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </span>
                )}
              </p>
              {testProduct ? (
                <p>
                  Producto: <span className="font-medium">“{testProduct.name}”</span>
                  {parsed.kind === "peso" ? (
                    <>
                      {" "}
                      · ${unitPriceOf(testProduct).toLocaleString("es-AR")}/kg → total{" "}
                      <span className="font-medium">
                        ${testTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="text-amber-700 dark:text-amber-400">
                  Ningún producto tiene el PLU {parsed.plu}. Cargalo en Catálogo, en el producto
                  “Por peso”.
                </p>
              )}
              {testProduct && String(testProduct.unit || "") !== "kg" && (
                <p className="text-amber-700 dark:text-amber-400">
                  “{testProduct.name}” no está marcado como <strong>Por peso</strong>: el
                  Mostrador no va a poder usar la etiqueta.
                </p>
              )}
            </div>
          )}

          {guesses && guesses.length > 1 && (
            <div className="space-y-1">
              {guesses.slice(0, 5).map((g, i) => {
                const p = findProductByPlu(catalog, g.plu);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => applyGuess(g)}
                    className="w-full text-left rounded-md border border-border bg-background px-2 py-1.5 text-xs hover:bg-accent"
                  >
                    <span className="font-medium">
                      {g.kind === "peso" ? fmtScaleKg(g.kg) : `$${g.amount?.toFixed(2)}`}
                    </span>{" "}
                    · {scaleLabelFormatSummary(g.config)}
                    {p ? ` · “${p.name}”` : ""}
                  </button>
                );
              })}
            </div>
          )}
          {detectMsg && <p className="text-xs text-muted-foreground">{detectMsg}</p>}
        </div>

        <p className="text-xs text-muted-foreground">
          El PLU de cada producto se carga en <strong>Catálogo → producto → PLU de balanza</strong>{" "}
          (los productos “Por peso”). Si lo dejás vacío se usa el código de barras del producto.
          ¿Solo querés probar tu balanza?{" "}
          <a
            href="/manuales/pesables"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Ver el manual
          </a>
          .
        </p>
      </div>

      {/* Impresora de etiquetas adhesivas (config + calibración) */}
      <LabelPrinterCard vendor={vendor} saveVendor={saveVendor} />

      {/* Probador */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <p className="font-medium">⚖️ Probar balanza</p>
        <p className="text-muted-foreground">
          Poné algo en la balanza y probá. El portal prueba los baudios más comunes
          (9600 · 19200 · 4800 · 2400) automáticamente y recuerda el que funciona para la próxima.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => testScale(false)}
            disabled={busy}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Leyendo…" : "Probar balanza"}
          </button>
          <button
            type="button"
            onClick={() => testScale(true)}
            disabled={busy}
            className="h-9 px-4 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            title="Vuelve a pedir el puerto (para conectar otro equipo)"
          >
            Cambiar dispositivo
          </button>
        </div>
        {busy && (
          <p className="text-xs text-muted-foreground">
            Leyendo… si tu balanza no envía sola, apretá su tecla <span className="font-medium">Imprimir / Enviar</span> mientras lee.
          </p>
        )}
        {okMsg && <p className="text-green-700 dark:text-green-400">{okMsg}</p>}
        {errMsg && <p className="text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">{errMsg}</p>}
      </div>

      {/* Diagnóstico crudo */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <p className="font-medium">🔬 Diagnóstico (balanza no reconocida)</p>
        <p className="text-muted-foreground">
          Prueba TODAS las combinaciones de baudios y paridad/bits, enviando todos
          los comandos candidatos, y muestra los bytes crudos que llegó la balanza.
          Usalo cuando "Probar balanza" dice que no llegó ningún dato.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runDiagnose(false)}
            disabled={diagBusy}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {diagBusy ? "Diagnosticando…" : "Diagnosticar (todas)"}
          </button>
          <button
            type="button"
            onClick={() => runDiagnose(false, [115200])}
            disabled={diagBusy}
            className="h-9 px-4 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
          >
            Solo 115200
          </button>
          <button
            type="button"
            onClick={() => runDiagnose(true)}
            disabled={diagBusy}
            className="h-9 px-4 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
          >
            Cambiar dispositivo
          </button>
          {diagResults && diagResults.some((c) => c.bytes > 0) && (
            <button
              type="button"
              onClick={copyDiag}
              className="h-9 px-4 rounded-md border border-border text-sm hover:bg-accent"
            >
              Copiar diagnóstico
            </button>
          )}
        </div>
        {diagBusy && diagProgress && (
          <p className="text-xs text-muted-foreground">Probando {diagProgress}…</p>
        )}
        {diagMsg && <p className="text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">{diagMsg}</p>}
        {diagResults && (
          <div className="space-y-2 max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-2">
            {diagResults
              .filter((c) => c.bytes > 0)
              .map((c, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  <p className="font-medium">
                    {paramsLabel(c.params)} — {c.bytes} bytes
                  </p>
                  <p className="font-mono break-all text-muted-foreground">{c.hex}</p>
                  <p className="font-mono break-all">{c.raw.replace(/[^\x20-\x7E]/g, "·")}</p>
                </div>
              ))}
            {diagResults.every((c) => c.bytes === 0) && (
              <p className="text-xs text-muted-foreground">Sin bytes en ninguna combinación.</p>
            )}
          </div>
        )}
      </div>

      {/* Lectura continua */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <p className="font-medium">⏱️ Lectura continua (15 s)</p>
        <p className="text-muted-foreground">
          Abre el puerto y lee durante 15 segundos, reenviando ENQ cada segundo. Apretá la tecla
          <span className="font-medium"> Imprimir / Enviar </span> de la balanza cuando quieras
          durante la lectura. Útil cuando la balanza solo envía al apretar una tecla.
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <Label>Velocidad</Label>
            <select
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={contBaud}
              onChange={(e) => setContBaud(Number(e.target.value))}
              disabled={contBusy}
            >
              {BAUDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Paridad/bits</Label>
            <select
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={`${contParity}-${contDataBits}-${contStopBits}`}
              onChange={(e) => {
                const [p, d, s] = e.target.value.split("-");
                setContParity(p as PortParams["parity"]);
                setContDataBits(Number(d) as 7 | 8);
                setContStopBits(Number(s) as 1 | 2);
              }}
              disabled={contBusy}
            >
              <option value="none-8-1">8N1</option>
              <option value="even-7-1">7E1</option>
              <option value="odd-7-1">7O1</option>
              <option value="even-8-1">8E1</option>
              <option value="none-7-1">7N1</option>
              <option value="none-8-2">8N2</option>
            </select>
          </div>
          <div className="sm:col-span-2 flex items-end gap-2">
            <button
              type="button"
              onClick={() => runContinuous(false)}
              disabled={contBusy}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {contBusy ? "Leyendo…" : "Leer 15 s"}
            </button>
            <button
              type="button"
              onClick={() => runContinuous(true)}
              disabled={contBusy}
              className="h-9 px-4 rounded-md border border-border text-sm hover:bg-accent disabled:opacity-50"
            >
              Cambiar dispositivo
            </button>
          </div>
        </div>
        {contMsg && <p className="text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">{contMsg}</p>}
        {contBytes > 0 && (
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
            <p className="text-xs font-medium">{contBytes} bytes recibidos</p>
            <p className="font-mono text-xs break-all text-muted-foreground">{contHex}</p>
            <p className="font-mono text-xs break-all">{contRaw.replace(/[^\x20-\x7E]/g, "·")}</p>
          </div>
        )}
      </div>

      {/* Guía de conexión */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <p className="font-medium">Cómo conectar la balanza</p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Conectala a la PC</span> del mostrador:
            cable USB directo, adaptador <span className="font-medium">USB a serial (DB9)</span> con
            el cable de la balanza, o por <span className="font-medium">Bluetooth</span> emparejado
            (aparece como puerto COM).
          </li>
          <li>
            <span className="font-medium text-foreground">Driver del adaptador</span>: si Windows no
            detecta el adaptador USB-serial, instalá su driver (los comunes son{" "}
            <span className="font-medium">CH340</span>, <span className="font-medium">FTDI</span> y{" "}
            <span className="font-medium">PL2303</span>).
          </li>
          <li>
            <span className="font-medium text-foreground">Usá Chrome o Edge</span> en la PC: el
            navegador pide permiso la primera vez y elige el puerto de la balanza.
          </li>
          <li>
            <span className="font-medium text-foreground">Modo continuo</span>: si tu balanza tiene
            opción de transmisión continua ("stream" / "auto"), activála — así el
            portal lee sola. Si solo envía al apretar una tecla, tocá{" "}
            <span className="font-medium">Pesar</span> y apretá la tecla{" "}
            <span className="font-medium">Imprimir / Enviar</span> de la balanza.
          </li>
          <li>
            <span className="font-medium text-foreground">Probá</span> con el botón de arriba y
            después usá el botón <span className="font-medium">Pesar</span> del Mostrador en los
            productos marcados como <span className="font-medium">Por peso</span>.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Funciona con cualquier marca (Tor-rey, Ram, Baxtran, Toledo, genéricas, etc.): el portal
          detecta baudios y entiende los formatos de texto más comunes (kg, gramos y frames
          continuos tipo MT/Toledo).
        </p>
      </div>
    </div>
  );
}
