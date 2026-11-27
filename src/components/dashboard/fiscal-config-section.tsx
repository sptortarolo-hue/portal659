"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

type FiscalStatus = {
  can_fiscal: boolean;
  cuit: string | null;
  fiscal_cond_iva: string;
  fiscal_punto_venta: number | null;
  fiscal_env: string;
  has_cert: boolean;
  has_key: boolean;
  cert_info: { subject: string; issuer: string; notAfter: string } | null;
  ready: boolean;
  fiscal_auto_emit?: boolean;
};

type InvoiceRow = {
  id: string;
  cbte_tipo: number;
  cbte_nro: number;
  punto_venta: number;
  cae: string;
  cae_vto: string;
  total: number;
  env: string;
  created_at: string;
  pickup_number: number | null;
  customer_name: string | null;
  booking_id?: string | null;
  booking_customer_name?: string | null;
  asoc_pto?: number | null;
  asoc_nro?: number | null;
};

/** Etiqueta corta del comprobante (11 = Factura C, 13 = Nota de Crédito C). */
function cbteLabel(tipo: number | null | undefined): string {
  return tipo === 13 ? "NC" : "C";
}

/**
 * Asistente guiado de 5 pasos (estilo facturadores SaaS): cada paso muestra
 * su estado automático y el actual queda resaltado. El paso 3 (pegar el CSR
 * en ARCA) es manual y el comercio lo marca como hecho.
 */
function FiscalSteps({
  env,
  step1Done,
  step2Done,
  step3Done,
  step4Done,
  step5Done,
  step6Done,
  onStep3Done,
}: {
  env: string;
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
  step4Done: boolean;
  step5Done: boolean;
  step6Done: boolean;
  onStep3Done: () => void;
}) {
  const steps = [
    { done: step1Done, label: "Cargá CUIT, punto de venta y condición IVA", anchor: null as string | null },
    { done: step2Done, label: "Generá la clave + CSR acá (sin instalar nada)", anchor: null },
    {
      done: step3Done,
      label:
        env === "prod"
          ? "En ARCA: crear certificado y asociar el servicio WSFE"
          : "En ARCA (WSASS): crear certificado y autorizar wsfe",
      anchor: "https://www.arca.gob.ar/",
    },
    { done: step4Done, label: "Pegá acá el .crt que te devuelve ARCA", anchor: null },
    { done: step5Done, label: "Probá la conexión (login)", anchor: null },
    { done: step6Done, label: "Verificá la facturación (WSFE + punto de venta)", anchor: null },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="space-y-1 rounded-xl border border-border bg-muted/40 p-2.5">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2 text-xs">
          <span aria-hidden>{s.done ? "✅" : i === current ? "➡️" : "⬜"}</span>
          <span className={s.done ? "text-muted-foreground line-through" : i === current ? "font-bold" : ""}>
            {i + 1}. {s.label}
          </span>
          {s.anchor && !s.done && (
            <a
              href={s.anchor}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex-shrink-0 text-primary underline"
            >
              Abrir ARCA
            </a>
          )}
          {i === 2 && !s.done && (
            <button
              type="button"
              onClick={onStep3Done}
              className="ml-auto flex-shrink-0 text-[11px] font-bold text-primary hover:underline"
            >
              Ya lo pegué
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Reporte fiscal por período: facturado − anulado = neto, con tabla y
 * export CSV (base del libro IVA ventas). Período default: mes actual.
 */
function FiscalReport() {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = now.toISOString().slice(0, 10);
  const [desde, setDesde] = useState(monthStart);
  const [hasta, setHasta] = useState(today);
  const [data, setData] = useState<{
    summary: { facturas: number; notas_credito: number; facturado: number; anulado: number; neto: number };
    rows?: {
      created_at: string;
      cbte_tipo: number;
      cbte_nro: number;
      punto_venta: number;
      total: number;
      customer_name: string | null;
      booking_id?: string | null;
    }[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(d: string, h: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/fiscal/reporte?desde=${d}&hasta=${h}`);
      const out = await res.json().catch(() => null);
      if (res.ok && out?.summary) setData(out);
    } catch {
      /* panel tolerante */
    }
    setLoading(false);
  }

  useEffect(() => {
    load(desde, hasta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = data?.summary;
  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <Label>Reporte del período</Label>
      <div className="flex gap-1.5">
        <input
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => {
            setDesde(e.target.value);
            load(e.target.value, hasta);
          }}
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
        />
        <input
          type="date"
          value={hasta}
          min={desde}
          max={today}
          onChange={(e) => {
            setHasta(e.target.value);
            load(desde, e.target.value);
          }}
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
        />
        <a
          href={`/api/vendor/fiscal/reporte?desde=${desde}&hasta=${hasta}&format=csv`}
          className="flex-shrink-0 inline-flex items-center rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"
        >
          ⬇️ CSV
        </a>
      </div>
      {data?.rows && data.rows.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1">Fecha</th>
                <th className="px-2 py-1">Comprobante</th>
                <th className="px-2 py-1">Cliente</th>
                <th className="px-2 py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1 tabular-nums">{String(r.created_at).slice(0, 10)}</td>
                  <td className="px-2 py-1 tabular-nums">
                    {cbteLabel(r.cbte_tipo)} {String(r.punto_venta).padStart(4, "0")}-
                    {String(r.cbte_nro).padStart(8, "0")}
                  </td>
                  <td className="max-w-[10rem] truncate px-2 py-1" title={r.customer_name || ""}>
                    {r.customer_name || "Consumidor final"}
                    {r.booking_id ? " · Turno" : ""}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    ${Number(r.total).toLocaleString("es-AR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-muted px-1 py-2">
          <p className="text-[10px] text-muted-foreground">Facturado{s ? ` (${s.facturas})` : ""}</p>
          <p className="text-sm font-extrabold tabular-nums">
            {loading ? "…" : `$${Number(s?.facturado ?? 0).toLocaleString("es-AR")}`}
          </p>
        </div>
        <div className="rounded-lg bg-muted px-1 py-2">
          <p className="text-[10px] text-muted-foreground">Anulado{s ? ` (${s.notas_credito})` : ""}</p>
          <p className="text-sm font-extrabold tabular-nums text-amber-600">
            {loading ? "…" : `$${Number(s?.anulado ?? 0).toLocaleString("es-AR")}`}
          </p>
        </div>
        <div className="rounded-lg bg-muted px-1 py-2">
          <p className="text-[10px] text-muted-foreground">Neto</p>
          <p className="text-sm font-extrabold tabular-nums text-green-600">
            {loading ? "…" : `$${Number(s?.neto ?? 0).toLocaleString("es-AR")}`}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Sección "Facturación electrónica ARCA" (plan Gestión).
 * CUIT + punto de venta electrónico + certificado/clave (cifrados en el
 * server) + entorno homo/prod + historial de comprobantes con CAE.
 * Sin plan Gestión muestra el upsell.
 */
export function FiscalConfigSection({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [status, setStatus] = useState<FiscalStatus | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [cuit, setCuit] = useState("");
  const [ptoVta, setPtoVta] = useState("");
  const [condIva, setCondIva] = useState("monotributo");
  const [env, setEnv] = useState("homo");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [csrPem, setCsrPem] = useState<string | null>(null);
  const [csrBusy, setCsrBusy] = useState(false);
  const [csrCopied, setCsrCopied] = useState(false);
  const [pingBusy, setPingBusy] = useState(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; ms?: number; error?: string; hint?: string } | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    env?: string;
    ms?: number;
    ultimo?: number;
    proximo?: number;
    puntosVenta?: number[];
    warnings?: string[];
    error?: string;
    hint?: string;
  } | null>(null);
  // Paso 3 (pegar CSR en ARCA) es manual: el comercio lo marca como hecho.
  const [arcaStepDone, setArcaStepDone] = useState(false);
  const certFileRef = useRef<HTMLInputElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/fiscal/config");
      const data = await res.json();
      if (res.ok) {
        setStatus(data);
        setCuit(data.cuit || "");
        setPtoVta(data.fiscal_punto_venta != null ? String(data.fiscal_punto_venta) : "");
        setCondIva(data.fiscal_cond_iva || "monotributo");
        setEnv(data.fiscal_env || "homo");
      }
      const inv = await fetch("/api/vendor/fiscal/invoices").then((r) => r.json()).catch(() => null);
      if (inv?.invoices) setInvoices(inv.invoices);
    } catch {
      /* panel tolerante: la sección queda en "reintentar" */
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function readFile(ref: React.RefObject<HTMLInputElement | null>, set: (v: string) => void) {
    const f = ref.current?.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => set(String(reader.result || ""));
    reader.readAsText(f);
  }

  // Genera clave + CSR en el server (la clave queda cifrada ahí).
  async function generateCsr() {
    setCsrBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/vendor/fiscal/csr", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "No se pudo generar el CSR");
      } else {
        setCsrPem(data.csr_pem);
        setCsrCopied(false);
      }
    } catch {
      setErr("Sin conexión, reintentá");
    }
    setCsrBusy(false);
  }

  async function copyCsr() {
    if (!csrPem) return;
    try {
      await navigator.clipboard.writeText(csrPem);
      setCsrCopied(true);
    } catch {
      /* portapapeles no disponible: seleccionar manual */
    }
  }

  // WSASS / Adm. de Certificados piden SUBIR el CSR como archivo (.csr).
  function downloadCsr() {
    if (!csrPem) return;
    const blob = new Blob([csrPem], { type: "application/pkcs10" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "portal659.csr";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Borra certificado + clave (sale de fiscal hasta subir otro).
  async function deleteCreds() {
    if (!window.confirm("¿Eliminar el certificado y la clave ARCA? Vas a quedar sin facturación hasta subir otro.")) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/vendor/fiscal/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear_fiscal_creds: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "No se pudo eliminar");
      } else {
        setMsg("Certificado eliminado ✓");
        setCertPem("");
        setKeyPem("");
        setCsrPem(null);
        load();
      }
    } catch {
      setErr("Sin conexión, reintentá");
    }
    setSaving(false);
  }

  // Prueba solo el login WSAA (rápido, sin emitir ni gastar numeración).
  async function pingArca() {
    setPingBusy(true);
    setPingResult(null);
    try {
      const res = await fetch("/api/vendor/fiscal/ping", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPingResult({ ok: true, ms: data.ms });
      } else {
        setPingResult({ ok: false, error: data.error || "ARCA no contestó (revisá docker logs [fiscal])", hint: data.hint });
      }
    } catch {
      setPingResult({ ok: false, error: "Se cortó esperando a ARCA (proxy o red del VPS)" });
    }
    setPingBusy(false);
  }

  // Verificación end-to-end SIN numeración: WSAA + WSFE + punto de venta.
  async function verifyArca() {
    setVerifyBusy(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/vendor/fiscal/verify", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setVerifyResult(
        res.ok
          ? {
              ok: true,
              env: data.env,
              ms: data.ms,
              ultimo: data.ultimo,
              proximo: data.proximo,
              puntosVenta: data.puntosVenta,
              warnings: data.warnings,
            }
          : { ok: false, error: data.error || "ARCA no contestó", hint: data.hint }
      );
    } catch {
      setVerifyResult({ ok: false, error: "Se cortó esperando a ARCA (proxy o red del VPS)" });
    }
    setVerifyBusy(false);
  }

  async function save(data: Record<string, unknown>) {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/vendor/fiscal/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const out = await res.json();
      if (!res.ok) {
        setErr(out.error || "No se pudo guardar");
      } else {
        setMsg("Guardado ✓");
        setCertPem("");
        setKeyPem("");
        load();
      }
    } catch {
      setErr("Sin conexión, reintentá");
    }
    setSaving(false);
  }

  return (
    <CollapsibleSection icon="🧾" title="Facturación electrónica (ARCA)" defaultOpen={defaultOpen}>
      {loading || !status ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Cargando…" : "No se pudo cargar. Reintentá."}
        </p>
      ) : !status.can_fiscal ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Emití <strong>Factura C con CAE</strong> al cobrar (mostrador, mesa o pedido),
            eligiendo con/sin comprobante en cada venta.
          </p>
          <p className="text-sm font-medium">
            Exclusivo del plan <a href="/planes" className="text-primary underline">Gestión integral</a>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div
            className={`rounded-xl border px-3 py-2 text-sm font-medium ${
              status.ready
                ? "border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
                : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
            }`}
          >
            {status.ready
              ? `✅ Lista para facturar (${status.fiscal_env === "prod" ? "producción" : "prueba"})`
              : "⚠️ Completá CUIT, punto de venta y certificado para activar"}
          </div>

          {status.cert_info?.notAfter &&
            Math.ceil((new Date(status.cert_info.notAfter).getTime() - Date.now()) / 86400000) <= 30 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                ⚠️ Tu certificado vence el{" "}
                {new Date(status.cert_info.notAfter).toLocaleDateString("es-AR")}. Generá uno nuevo en ARCA
                (podés usar la misma clave, no hace falta repetir el CSR) y pegalo en el paso 4.
              </div>
            )}

          <details className="rounded-xl border border-border bg-muted/40 p-2.5 text-xs">
            <summary className="cursor-pointer font-bold">Antes de empezar — esto se hace una sola vez</summary>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <p>El portal guarda el certificado cifrado y no volvés a ARCA hasta que venza (1 año).</p>
              <p>Necesitás el <strong>CUIT del comercio</strong> (no el del contador) y su <strong>Clave Fiscal</strong> en <a href="https://www.arca.gob.ar/" target="_blank" rel="noopener noreferrer" className="text-primary underline">arca.gob.ar</a>.</p>
              <p>Probá primero en <strong>Prueba</strong>. Recién cuando todo salga bien pasás a <strong>Producción</strong>.</p>
            </div>
          </details>

          <FiscalSteps
            env={status.fiscal_env}
            step1Done={!!(status.cuit && status.fiscal_punto_venta)}
            step2Done={status.has_key || !!csrPem}
            step3Done={arcaStepDone || status.has_cert}
            step4Done={status.has_cert}
            step5Done={!!pingResult?.ok}
            step6Done={!!verifyResult?.ok}
            onStep3Done={() => setArcaStepDone(true)}
          />

          {status.ready && (
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={pingBusy} onClick={pingArca}>
                {pingBusy ? "Probando…" : "📡 Probar conexión con ARCA"}
              </Button>
              {pingResult && (
                <span className={`text-xs font-medium ${pingResult.ok ? "text-green-600" : "text-red-600"}`}>
                  {pingResult.ok ? `✅ ARCA responde (${pingResult.ms}ms)` : `⚠️ ${pingResult.error}`}
                  {!pingResult.ok && pingResult.hint && (
                    <><br />💡 {pingResult.hint}</>
                  )}
                </span>
              )}
            </div>
          )}

          {status.ready && (
            <div className="space-y-1.5 rounded-xl border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" disabled={verifyBusy} onClick={verifyArca}>
                  {verifyBusy ? "Verificando…" : "✅ Verificar facturación (sin gastar numeración)"}
                </Button>
                {verifyResult?.ok && (
                  <span className="text-xs font-bold text-green-600">
                    WSFE autorizado · PV {status.fiscal_punto_venta} válido · último N°{verifyResult.ultimo} (próximo {verifyResult.proximo})
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Solo consulta a ARCA si el servicio WSFE está autorizado y qué punto de venta tenés habilitado. No emite facturas ni consume números.
              </p>
              {verifyResult?.ok && verifyResult.puntosVenta && verifyResult.puntosVenta.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Puntos de venta habilitados: {verifyResult.puntosVenta.join(", ")}
                </p>
              )}
              {verifyResult?.warnings?.map((w, i) => (
                <p key={i} className="text-xs font-medium text-amber-700 dark:text-amber-400">⚠️ {w}</p>
              ))}
              {verifyResult && !verifyResult.ok && (
                <p className="text-xs font-medium text-red-600">
                  ⚠️ {verifyResult.error}
                  {verifyResult.hint && <><br />💡 {verifyResult.hint}</>}
                </p>
              )}
              {verifyResult?.ok && (
                <p className="text-[11px] text-muted-foreground">
                  Ahora hacé una venta de prueba con "Con comprobante fiscal" y revisá que el ticket tenga CAE + QR. Recién ahí pasá a Producción.
                </p>
              )}
            </div>
          )}

          {status.ready && (
             <label className="flex items-center gap-2 text-sm mt-2">
               <input
                 type="checkbox"
                 checked={status.fiscal_auto_emit === true}
                 onChange={async (e) => {
                   await fetch("/api/vendor/me", {
                     method: "POST",
                     headers: { "Content-Type": "application/json" },
                     body: JSON.stringify({ fiscal_auto_emit: e.target.checked }),
                   });
                   fetch("/api/vendor/fiscal/config")
                     .then((r) => r.json())
                     .then((d) => setStatus((s: any) => ({ ...s, fiscal_auto_emit: d?.fiscal_auto_emit === true })));
                 }}
               />
               Emitir comprobante fiscal automáticamente al cobrar con Mercado Pago (QR y online)
             </label>
           )}

           <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <Label>CUIT</Label>
              <Input
                inputMode="numeric"
                placeholder="20-12345678-9"
                value={cuit}
                onChange={(e) => setCuit(e.target.value)}
              />
            </div>
            <div>
              <Label>Punto de venta electrónico</Label>
              <Input
                inputMode="numeric"
                placeholder="1"
                value={ptoVta}
                onChange={(e) => setPtoVta(e.target.value)}
              />
            </div>
            <div>
              <Label>Condición frente al IVA</Label>
              <select
                value={condIva}
                onChange={(e) => setCondIva(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
              >
                <option value="monotributo">Monotributo</option>
                <option value="responsable_inscripto">Responsable inscripto</option>
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            La condición se imprime en el encabezado; esta versión emite siempre Factura C.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() =>
               save({
                 cuit,
                 fiscal_punto_venta: ptoVta === "" ? null : Number(ptoVta),
                 fiscal_cond_iva: condIva,
               })
             }
          >
            {saving ? "Guardando…" : "Guardar datos fiscales"}
          </Button>

          <div>
            <Label>Entorno ARCA</Label>
            <div className="flex gap-1.5 mt-1">
              {(["homo", "prod"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setEnv(v);
                    save({ fiscal_env: v });
                  }}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    env === v ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {v === "homo" ? "🧪 Prueba" : "🚀 Producción"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Probá en homologación antes de pasar a producción (requiere certificado de prod).
            </p>
          </div>

          <div className="rounded-xl border border-border p-3 space-y-2">
            <Label>Certificado ARCA (.crt)</Label>
            {status.has_cert && status.cert_info ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  ✅ {status.cert_info.subject} · vence{" "}
                  {new Date(status.cert_info.notAfter).toLocaleDateString("es-AR")}
                  <br />
                  <span className="opacity-80">Emitido por: {status.cert_info.issuer}</span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={deleteCreds}
                >
                  🗑️ Eliminar certificado
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Sin terminal ni OpenSSL: generá la clave acá, pegá el CSR en ARCA
                  (WSASS para prueba, Administrador de Certificados para producción)
                  y subí el .crt que te devuelve. Todo se guarda cifrado.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving || csrBusy || !cuit.replace(/\D/g, "")}
                  onClick={generateCsr}
                  title={!cuit.replace(/\D/g, "") ? "Cargá primero el CUIT arriba" : undefined}
                >
                  {csrBusy ? "Generando…" : "🔑 Generar clave + CSR"}
                </Button>
                {csrPem && (
                  <div className="space-y-1">
                    <Label>CSR (pegá esto en ARCA)</Label>
                    <textarea
                      readOnly
                      rows={5}
                      value={csrPem}
                      className="w-full rounded-lg border border-input bg-muted p-2 font-mono text-[10px] leading-tight"
                    />
                    <div className="flex gap-1.5">
                      <Button type="button" size="sm" variant="outline" onClick={copyCsr}>
                        {csrCopied ? "¡Copiado!" : "📋 Copiar CSR"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={downloadCsr}>
                        ⬇️ Descargar .csr
                      </Button>
                    </div>
                    <details className="w-full rounded-lg border border-border bg-background p-2 text-[11px]" open>
                      <summary className="cursor-pointer font-bold">
                        Paso 3: qué hacer en ARCA con este CSR (el paso que todos se saltean)
                      </summary>
                      <div className="mt-2 space-y-2 text-muted-foreground">
                        {env === "prod" ? (
                          <>
                            <p className="font-medium text-foreground">PRODUCCIÓN</p>
                            <ol className="list-decimal space-y-1 pl-4">
                              <li>Entrá a <a href="https://www.arca.gob.ar/" target="_blank" rel="noopener noreferrer" className="text-primary underline">arca.gob.ar</a> con tu <strong>Clave Fiscal</strong> (nivel 2 o más) del CUIT del paso 1.</li>
                              <li>Buscá <strong>Administración de Certificados Digitales</strong> → <strong>Agregar Alias</strong>.</li>
                              <li>Alias: escribí <code>portal659</code> (sin espacios). Pegá el CSR completo y confirmá.</li>
                              <li>En la lista, <strong>Ver</strong> ese alias y <strong>Descargar</strong> el <code>.crt</code>. Volvé acá al paso 4.</li>
                              <li className="font-medium text-amber-700 dark:text-amber-400">⚠️ Después, en el <strong>Administrador de Relaciones de Clave Fiscal</strong> → <strong>Nueva Relación</strong>: servicio <strong>Factura Electrónica / WSFE</strong>, representante <strong>tu Computador Fiscal (el alias portal659)</strong> → Confirmar. Sin esto la factura falla con "no autorizado", aunque la conexión dé bien.</li>
                            </ol>
                          </>
                        ) : (
                          <>
                            <p className="font-medium text-foreground">PRUEBA (HOMOLOGACIÓN)</p>
                            <ol className="list-decimal space-y-1 pl-4">
                              <li>Entrá a <a href="https://www.arca.gob.ar/" target="_blank" rel="noopener noreferrer" className="text-primary underline">arca.gob.ar</a> y buscá <strong>WSASS</strong>. Si no aparece en tus servicios, primero hacé <strong>Adherir WSASS</strong> en <em>Servicios interactivos</em>.</li>
                              <li>Elegí <strong>Nuevo Certificado</strong>. Alias: <code>portal659</code> (sin espacios).</li>
                              <li>En <strong>Solicitud del certificado en formato PKCS#10</strong> pegá el CSR completo y tocá <strong>Crear DN y obtener certificado</strong>.</li>
                              <li>Copiá todo desde <code>-----BEGIN CERTIFICATE-----</code> hasta <code>-----END CERTIFICATE-----</code> y guardalo en un Bloc de notas como <code>certificado-prueba.crt</code>. Volvé acá al paso 4.</li>
                              <li className="font-medium text-amber-700 dark:text-amber-400">⚠️ En WSASS buscá <strong>Autorización de acceso a un servicio</strong>: certificado recién creado + CUIT representado + servicio <code>wsfe</code> → Confirmar. Sin esto la factura falla con "no autorizado".</li>
                            </ol>
                          </>
                        )}
                        <p>Si los botones se llaman distinto, buscá las palabras <strong>certificado</strong>, <strong>CSR</strong> y <strong>wsfe</strong>. La <strong>clave privada nunca se sube a ARCA</strong> ni se la mandes a nadie.</p>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1">
              <Label>Pegar certificado (.crt que te devuelve ARCA)</Label>
              <textarea
                rows={4}
                value={certPem}
                onChange={(e) => setCertPem(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE----- ..."
                className="w-full rounded-lg border border-input bg-background p-2 font-mono text-[10px] leading-tight"
              />
            </div>
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant="outline" onClick={() => certFileRef.current?.click()}>
                📄 Subir .crt
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => keyFileRef.current?.click()}>
                🔑 Subir .key (solo vía manual)
              </Button>
              <input
                ref={certFileRef}
                type="file"
                accept=".crt,.cer,.pem,.txt"
                className="hidden"
                onChange={() => readFile(certFileRef, setCertPem)}
              />
              <input
                ref={keyFileRef}
                type="file"
                accept=".key,.pem,.txt"
                className="hidden"
                onChange={() => readFile(keyFileRef, setKeyPem)}
              />
            </div>
            {(certPem || keyPem) && (
              <p className="text-xs font-medium">
                {certPem ? "✅ cert cargado" : "⬜ falta cert"}
                {keyPem ? " · ✅ clave cargada" : ""}
              </p>
            )}
            <Button
              type="button"
              size="sm"
              disabled={saving || !certPem}
              onClick={() => save(keyPem ? { cert_pem: certPem, key_pem: keyPem } : { cert_pem: certPem })}
              title={keyPem ? undefined : "Se valida contra la clave generada en el portal"}
            >
              {saving ? "Validando…" : "Validar y guardar certificado"}
            </Button>
          </div>

          {msg && <p className="text-sm font-medium text-green-600">{msg}</p>}
          {err && <p className="text-sm font-medium text-red-600">⚠️ {err}</p>}

          {status.ready && <FiscalReport />}
          {invoices.length > 0 && (
            <div>
              <Label>Últimos comprobantes</Label>
              <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 text-xs"
                  >
                    <span className="font-extrabold tabular-nums">
                      {cbteLabel(inv.cbte_tipo)} {String(inv.punto_venta).padStart(4, "0")}-{String(inv.cbte_nro).padStart(8, "0")}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      ${Number(inv.total).toLocaleString("es-AR")}
                    </span>
                    {inv.customer_name && (
                      <span
                        className="min-w-0 truncate text-muted-foreground"
                        title={inv.customer_name}
                      >
                        {inv.customer_name}
                      </span>
                    )}
                    {inv.booking_id && (
                      <span className="flex-shrink-0 text-[10px] text-muted-foreground">Turno</span>
                    )}
                    {inv.cbte_tipo === 13 && inv.asoc_nro != null && (
                      <span className="text-muted-foreground" title="Factura anulada">
                        → {String(inv.asoc_pto ?? inv.punto_venta).padStart(4, "0")}-{String(inv.asoc_nro).padStart(8, "0")}
                      </span>
                    )}
                    <a
                      href={`/api/vendor/fiscal/pdf?invoiceId=${encodeURIComponent(inv.id)}&format=url`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto flex-shrink-0 text-primary underline"
                      title="Abrir PDF del comprobante"
                    >
                      📄 PDF
                    </a>
                    <span className="text-muted-foreground tabular-nums" title={`CAE ${inv.cae}`}>
                      CAE …{inv.cae.slice(-4)}
                      {inv.env === "homo" ? " 🧪" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

/**
 * Acceso compacto a la pestaña Facturación (se usa dentro de Config en
 * lugar del wizard completo: la operatoria vive en su propia pestaña).
 */
export function FiscalTabShortcut() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("portal:open-fiscal-tab"))}
      className="w-full flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 min-h-[52px] text-left active:bg-muted transition-colors"
    >
      <span className="text-xl" aria-hidden>
        🧾
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">Abrir Facturación</span>
        <span className="block text-xs text-muted-foreground truncate">
          Comprobantes, notas de crédito y reportes.
        </span>
      </span>
      <span className="text-muted-foreground flex-shrink-0">›</span>
    </button>
  );
}
