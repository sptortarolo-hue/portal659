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
};

type InvoiceRow = {
  id: string;
  cbte_nro: number;
  punto_venta: number;
  cae: string;
  cae_vto: string;
  total: number;
  env: string;
  created_at: string;
  pickup_number: number | null;
  customer_name: string | null;
};

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
  onStep3Done,
}: {
  env: string;
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
  step4Done: boolean;
  step5Done: boolean;
  onStep3Done: () => void;
}) {
  const steps = [
    { done: step1Done, label: "Cargá CUIT y punto de venta", anchor: null as string | null },
    { done: step2Done, label: "Generá la clave + CSR acá", anchor: null },
    {
      done: step3Done,
      label:
        env === "prod"
          ? "Pegá el CSR en Adm. de Certificados (ARCA)"
          : "Pegá el CSR en WSASS (ARCA)",
      anchor: "https://www.arca.gob.ar/",
    },
    { done: step4Done, label: "Pegá acá el .crt que te devuelve ARCA", anchor: null },
    { done: step5Done, label: "Probá la conexión", anchor: null },
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
 * Sección "Facturación electrónica ARCA" (plan Gestión).
 * CUIT + punto de venta electrónico + certificado/clave (cifrados en el
 * server) + entorno homo/prod + historial de comprobantes con CAE.
 * Sin plan Gestión muestra el upsell.
 */
export function FiscalConfigSection() {
  const [status, setStatus] = useState<FiscalStatus | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [cuit, setCuit] = useState("");
  const [ptoVta, setPtoVta] = useState("");
  const [env, setEnv] = useState("homo");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [csrPem, setCsrPem] = useState<string | null>(null);
  const [csrBusy, setCsrBusy] = useState(false);
  const [csrCopied, setCsrCopied] = useState(false);
  const [pingBusy, setPingBusy] = useState(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; ms?: number; error?: string; hint?: string } | null>(null);
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
    <CollapsibleSection icon="🧾" title="Facturación electrónica (ARCA)">
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

          <FiscalSteps
            env={status.fiscal_env}
            step1Done={!!(status.cuit && status.fiscal_punto_venta)}
            step2Done={status.has_key || !!csrPem}
            step3Done={arcaStepDone || status.has_cert}
            step4Done={status.has_cert}
            step5Done={!!pingResult?.ok}
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

          <div className="grid grid-cols-2 gap-2">
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
          </div>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => save({ cuit, fiscal_punto_venta: ptoVta === "" ? null : Number(ptoVta) })}
          >
            {saving ? "Guardando…" : "Guardar CUIT y punto de venta"}
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
                    <p className="text-[11px] text-muted-foreground">
                      En ARCA (WSASS o Adm. de Certificados) subí el archivo descargado.
                    </p>
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
                      C {String(inv.punto_venta).padStart(4, "0")}-{String(inv.cbte_nro).padStart(8, "0")}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      ${Number(inv.total).toLocaleString("es-AR")}
                    </span>
                    <span className="ml-auto text-muted-foreground tabular-nums" title={`CAE ${inv.cae}`}>
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
