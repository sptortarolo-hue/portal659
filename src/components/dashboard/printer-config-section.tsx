"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { dispatchOfflinePrint, probeLocalListeners, type LocalListener } from "@/lib/local-print";
import type { Vendor } from "@/types/database";

type Props = {
  vendor: Vendor | null;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  setMsg: (m: string) => void;
  /** Texto del toggle de impresión automática (cambia según vertical). */
  autoPrintDesc?: string;
};

/**
 * Sección "Impresora térmica" compartida por los dashboards con impresión
 * (gastronomía y comercio). Escucha "portal:open-printer-config" para abrirse
 * desde el PrinterStatus del header del panel.
 */
export function PrinterConfigSection({
  vendor,
  saveVendor,
  setMsg,
  autoPrintDesc = "Imprime comanda automáticamente al aceptar un pedido",
}: Props) {
  const [printerIp, setPrinterIp] = useState(vendor?.printer_ip || "");
  const [printerPort, setPrinterPort] = useState(String(vendor?.printer_port || 9100));
  const [printMode, setPrintMode] = useState<"server" | "app">(
    vendor?.print_mode === "app" ? "app" : "server"
  );
  const [agentOnline, setAgentOnline] = useState(false);
  const [bridgeConfigured, setBridgeConfigured] = useState(false);
  const [printToken, setPrintToken] = useState<string | null>(vendor?.print_token || null);
  const [lastPrint, setLastPrint] = useState<{
    at: string | null;
    ok: boolean | null;
    error: string | null;
  }>({ at: null, ok: null, error: null });
  const [printQueue, setPrintQueue] = useState<{ id: string; type: string; enqueuedAt: number }[]>(
    []
  );
  const [queueLoading, setQueueLoading] = useState(false);

  const [printerSectionOpen, setPrinterSectionOpen] = useState(false);

  // Impresión sin internet (contingencia, track Impresión F4): detecta
  // listeners locales en ESTE equipo (agente PC :8792 / app Android :8793).
  // Funciona sin internet (localhost). Requiere app/agente actualizados.
  const [localListeners, setLocalListeners] = useState<LocalListener[] | null>(null);
  const [localProbing, setLocalProbing] = useState(false);
  const [localTesting, setLocalTesting] = useState(false);

  const probeLocal = async () => {
    setLocalProbing(true);
    try {
      setLocalListeners(await probeLocalListeners());
    } finally {
      setLocalProbing(false);
    }
  };

  const testLocalPrint = async () => {
    if (!vendor?.id) {
      setMsg("Sin comercio cargado");
      return;
    }
    setLocalTesting(true);
    try {
      const r = await dispatchOfflinePrint(vendor.id, {
        kind: "TICKET",
        items: [{ qty: 1, name: "Prueba de impresión local" }],
        total: 0,
        createdAt: Date.now(),
      });
      setMsg(
        r.printed
          ? `✅ Prueba local impresa (${r.via}): ticket provisorio sin validez fiscal`
          : `❌ No se pudo imprimir local: ${r.error || "sin listener"}`
      );
    } finally {
      setLocalTesting(false);
    }
    setTimeout(() => setMsg(""), 4000);
  };

  useEffect(() => {
    const handler = () => setPrinterSectionOpen(true);
    window.addEventListener("portal:open-printer-config", handler);
    return () => window.removeEventListener("portal:open-printer-config", handler);
  }, []);

  useEffect(() => {
    setPrinterIp(vendor?.printer_ip || "");
    setPrinterPort(String(vendor?.printer_port || 9100));
    setPrintMode(vendor?.print_mode === "app" ? "app" : "server");
    setPrintToken(vendor?.print_token || null);
  }, [vendor]);

  useEffect(() => {
    if (printMode !== "app") return;
    let mounted = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/vendor/print/status");
        const data = await res.json();
        if (!mounted || !data.vendor) return;
        setAgentOnline(!!data.agent?.online);
        setBridgeConfigured(!!data.bridgeConfigured);
        setPrintToken(data.vendor.print_token || null);
        setLastPrint({
          at: data.vendor.last_print_at || null,
          ok: data.vendor.last_print_ok ?? null,
          error: data.vendor.last_print_error || null,
        });
      } catch {
        /* relay sin configurar o error transitorio */
      }
    };
    poll();
    const interval = setInterval(poll, 6000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [printMode]);

  const changePrintMode = async (mode: "server" | "app") => {
    setPrintMode(mode);
    await saveVendor({ print_mode: mode });
    if (mode === "app") {
      const res = await fetch("/api/vendor/print/status");
      const data = await res.json().catch(() => null);
      setPrintToken(data?.vendor?.print_token || printToken);
    }
  };

  const regenerateToken = async () => {
    const res = await fetch("/api/vendor/print/token", { method: "POST" });
    const data = await res.json().catch(() => ({ error: "Error de red" }));
    if (data.token) {
      setPrintToken(data.token);
      setMsg("✅ Token regenerado — pegá el nuevo token en la app Portal Print");
    } else {
      setMsg(`❌ ${data.error || "No se pudo regenerar el token"}`);
    }
  };

  const testPrinter = async () => {
    const res = await fetch("/api/print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    const data = await res.json().catch(() => ({ error: "Respuesta inválida del servidor" }));
    if (data.offline) {
      setMsg("❌ La app Portal Print no está conectada (abrí la app en tu celu)");
    } else if (data.ok) {
      setMsg("✅ Impresión de prueba enviada");
    } else {
      setMsg(`❌ ${data.error || (data.reason ?? "Error al imprimir")}`);
    }
  };

  const loadPrintQueue = async () => {
    setQueueLoading(true);
    try {
      const res = await fetch("/api/vendor/print/queue");
      const data = await res.json().catch(() => null);
      setPrintQueue(data?.jobs || []);
    } catch {
      setPrintQueue([]);
    } finally {
      setQueueLoading(false);
    }
  };

  const cancelPrintJob = async (jobId: string) => {
    const res = await fetch(`/api/vendor/print/queue?id=${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) setMsg("🗑️ Trabajo cancelado de la cola");
    else setMsg(`❌ ${data.error || "No se pudo cancelar el trabajo"}`);
    setTimeout(() => setMsg(""), 2500);
    loadPrintQueue();
  };

  const clearPrintQueue = async () => {
    const res = await fetch("/api/vendor/print/queue", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (data.ok) setMsg(`🧹 Cola vaciada (${data.removed ?? "0"} trabajos descartados)`);
    else setMsg(`❌ ${data.error || "No se pudo vaciar la cola"}`);
    setTimeout(() => setMsg(""), 2500);
    loadPrintQueue();
  };

  return (
    <CollapsibleSection id="printer-config" icon="🖨️" title="Impresora térmica" open={printerSectionOpen} onToggle={setPrinterSectionOpen}>
      <div className="space-y-3">
        <div>
          <Label>Cómo imprime</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={() => changePrintMode("app")}
              className={`rounded-lg border-2 px-3 py-2 text-sm font-medium text-left transition-colors ${
                printMode === "app"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30"
              }`}
            >
              📱 App en tu celu
              <p className="text-[10px] font-normal mt-1 opacity-80">
                Impresora en la red local (recomendado)
              </p>
            </button>
            <button
              type="button"
              onClick={() => changePrintMode("server")}
              className={`rounded-lg border-2 px-3 py-2 text-sm font-medium text-left transition-colors ${
                printMode === "server"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30"
              }`}
            >
              🖥️ Servidor (TCP)
              <p className="text-[10px] font-normal mt-1 opacity-80">
                El VPS imprime directo a la impresora
              </p>
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {printMode === "app"
              ? "La app Portal Print (en tu celular, mismo Wi-Fi que la impresora) recibe el ticket y lo imprime. No hace falta abrir puertos ni IP pública."
              : "El servidor envía el ticket por TCP directo. Requiere alcanzar la impresora desde el VPS (VPN o puerto reenviado)."}
          </p>
        </div>

        {printMode === "app" && (
          <>
            <div className="flex items-start justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className={agentOnline ? "text-green-500" : "text-red-500"}>
                  {agentOnline ? "🟢" : "🔴"}
                </span>
                <div>
                  <p className="text-sm font-medium">
                    {agentOnline ? "App conectada" : "App no conectada"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {agentOnline
                      ? "Impresión automática activa: los pedidos confirmados salen solos"
                      : "Instalá y conectá la app abajo"}
                  </p>
                </div>
              </div>
            </div>

            <details className="rounded-lg border px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                📱 Configurar la app Portal Print
              </summary>

              <a
                href="/downloads/portal-print.apk?v=2"
                download="portal-print.apk"
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
              >
                📥 Descargar la app (Android)
              </a>
              <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                Habilitá {`"Instalar apps desconocidas"`} cuando lo pida el navegador.
              </p>

              <ol className="mt-2 space-y-1 list-decimal pl-4 text-muted-foreground">
                <li>
                  Conectá el celular al <strong>mismo Wi-Fi</strong> que la impresora.
                </li>
                <li>
                  Descargá e instalá la app tocando el botón de arriba.
                </li>
                <li>
                  En la app pegá el <strong>token</strong> de abajo, guardá y conectá.
                </li>
                <li>
                  Dejá la app <strong>abierta</strong> en el mostrador (enchufada) y tocá
                  "Imprimir prueba".
                </li>
              </ol>
            </details>

            <details className="rounded-lg border px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                💻 Descargar para PC (Windows)
              </summary>

              <a
                href="/uploads/downloads/portal-print-agent.zip?v=4"
                download="portal-print-agent.zip"
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-fresh text-fresh-foreground px-4 py-2.5 text-sm font-semibold hover:bg-fresh/80 active:scale-[0.98] transition-all"
              >
                📥 Descargar el agente (Windows, .zip)
              </a>

              <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                No instala nada ni requiere permisos de administrador: descargás el .zip,
                extraés la carpeta y abrís <code>Portal Print Agent.exe</code>.
              </p>

              <ol className="mt-2 space-y-1 list-decimal pl-4 text-muted-foreground">
                <li>La impresora debe estar en la <strong>misma red</strong> que la PC.</li>
                <li>Descargá el <strong>.zip</strong> y <strong>extraelo</strong> en una carpeta.</li>
                <li>Abrí <strong>Portal Print Agent.exe</strong> (doble clic).</li>
                <li>Pegá el <strong>token</strong> de abajo, la <strong>IP de la impresora</strong> y tocá <strong>Guardar</strong>.</li>
                <li>Usá <strong>Probar impresora</strong> para verificar y activá <strong>«Arrancar al encender la PC»</strong>.</li>
              </ol>

              <p className="mt-2 rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
                Al cerrar la ventana, el agente sigue imprimiendo en segundo plano desde la
                bandeja del sistema (ícono junto al reloj).
              </p>
              <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800">
                ¿Tu antivirus (AVG/Avast) lo marca? Es un <strong>falso positivo heurístico</strong>.
                Restaurá el archivo, agregá una excepción y avisanos. Guía en
                <a href="/manuales/impresora" className="underline"> el manual de impresora</a>.
              </p>
            </details>

            {printToken && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Token de la app</Label>
                  <button
                    type="button"
                    className="text-xs text-primary font-medium"
                    onClick={() => {
                      navigator.clipboard?.writeText(printToken).catch(() => undefined);
                      setMsg("✅ Token copiado");
                    }}
                  >
                    Copiar
                  </button>
                </div>
                <p className="font-mono text-xs break-all bg-muted rounded px-2 py-1.5">
                  {printToken}
                </p>
                <button
                  type="button"
                  className="text-xs text-destructive"
                  onClick={regenerateToken}
                >
                  Regenerar token
                </button>
              </div>
            )}

            {!bridgeConfigured && (
              <p className="text-[10px] text-amber-500">
                ⚠️ El relay de impresión aún no está configurado en el servidor
                (PRINT_BRIDGE_URL). Avisá al administrador.
              </p>
            )}

            {lastPrint.at && (
              <p className="text-[10px] text-muted-foreground/70">
                Última impresión: {new Date(lastPrint.at).toLocaleString("es-AR")} ·{" "}
                {lastPrint.ok === true
                  ? "✅ OK"
                  : lastPrint.ok === false
                    ? `❌ ${lastPrint.error || "error"}`
                    : ""}
              </p>
            )}
          </>
        )}

        <div className="flex items-center justify-between">
          <div>
            <Label>Impresión automática</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {autoPrintDesc}
            </p>
          </div>
          <Switch
            checked={vendor?.auto_print || false}
            onCheckedChange={(v) => saveVendor({ auto_print: v })}
          />
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div>
            <Label className="text-sm font-semibold">Configuración de ticket</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Qué sale en el encabezado de todos los documentos impresos. El nombre del
              local y el pie de página siempre se imprimen.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Logo del comercio</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Redondo, junto al nombre (cargalo en Datos del local)
              </p>
            </div>
            <Switch
              checked={vendor?.print_logo ?? true}
              onCheckedChange={(v) => saveVendor({ print_logo: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Dirección</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                La dirección que cargaste en Datos del local
              </p>
            </div>
            <Switch
              checked={vendor?.print_address ?? true}
              onCheckedChange={(v) => saveVendor({ print_address: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Teléfono / WhatsApp</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Los números de contacto del local
              </p>
            </div>
            <Switch
              checked={vendor?.print_phone ?? true}
              onCheckedChange={(v) => saveVendor({ print_phone: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Redes sociales</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Instagram y Facebook del local
              </p>
            </div>
            <Switch
              checked={vendor?.print_social ?? true}
              onCheckedChange={(v) => saveVendor({ print_social: v })}
            />
          </div>
        </div>
        <div>
          <Label>IP de la impresora</Label>
          <Input
            value={printerIp}
            onChange={(e) => setPrinterIp(e.target.value)}
            onBlur={() => saveVendor({ printer_ip: printerIp || null })}
            placeholder="192.168.1.100"
            className="mt-1"
          />
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            Impresora conectada a la red local (TCP)
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Puerto</Label>
            <Input
              type="number"
              value={printerPort}
              onChange={(e) => setPrinterPort(e.target.value)}
              onBlur={() => saveVendor({ printer_port: Number(printerPort) || 9100 })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Tamaño papel</Label>
            <div className="flex gap-2 mt-1">
              {["58mm", "80mm"].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => saveVendor({ paper_size: size })}
                  className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                    (vendor?.paper_size || "80mm") === size
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" type="button" onClick={testPrinter}>
          🖨️ Imprimir prueba
        </Button>

        <details className="rounded-lg border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">
            📡 Impresión sin internet (contingencia)
          </summary>
          <p className="mt-2 text-muted-foreground">
            Si se corta internet, el ticket provisorio (solo-texto, sin logo ni
            factura) sale por el agente PC o la app Android <strong>de este mismo
            equipo</strong> directo a la impresora. Requiere agente/app actualizados
            y corriendo acá.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" type="button" onClick={probeLocal} disabled={localProbing}>
              {localProbing ? "Detectando…" : "Detectar impresión local"}
            </Button>
            <Button variant="outline" size="sm" type="button" onClick={testLocalPrint} disabled={localTesting}>
              {localTesting ? "Imprimiendo…" : "🧪 Probar impresión local"}
            </Button>
          </div>
          {localListeners !== null && (
            <p className="mt-2 text-muted-foreground">
              {localListeners.length === 0 ? (
                <>🔴 Sin listener local en este equipo (abrí el agente o la app acá).</>
              ) : (
                <>🟢 Listener local: {localListeners.map((l) => `${l.service} (:${l.port})`).join(", ")}</>
              )}
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            Cobertura: panel en PC con agente, o panel en Android con la app en el
            mismo equipo. iOS y equipos cruzados encolan para imprimir al reconectar.
          </p>
        </details>

        {printMode === "app" && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>Cola de impresión</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs text-primary font-medium"
                  onClick={loadPrintQueue}
                >
                  {queueLoading ? "Cargando..." : "Actualizar"}
                </button>
                {printQueue.length > 0 && (
                  <button type="button" className="text-xs text-destructive font-medium" onClick={clearPrintQueue}>
                    Vaciar cola
                  </button>
                )}
              </div>
            </div>
            {printQueue.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No hay trabajos esperando a la app.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {printQueue.map((job) => (
                  <div key={job.id} className="flex items-center justify-between rounded-lg bg-muted/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium">
                        {job.type === "comanda" ? "🍳 Comanda" : job.type === "retiro" ? "🎫 Retiro" : job.type === "precuenta" ? "🧾 Precuenta" : job.type === "ticket" ? "🧾 Ticket" : job.type === "test" ? "🧪 Prueba" : job.type}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(job.enqueuedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-destructive font-medium flex-shrink-0"
                      onClick={() => cancelPrintJob(job.id)}
                    >
                      Cancelar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
