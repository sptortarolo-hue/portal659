"use client";

import { useState } from "react";
import {
  isWebSerialSupported,
  getCachedScalePort,
  setCachedScalePort,
  requestScalePort,
  readScaleFromPort,
  ScaleUnparsedError,
} from "@/lib/scale-reader";

/**
 * Sección "Balanza" de Configuración (comercio de barrio): guía de conexión
 * universal (USB / USB-serial DB9 / Bluetooth) + probador con diagnóstico
 * crudo (baudios detectados y texto exacto que envía la balanza).
 * Misma lógica de lectura que el Mostrador (src/lib/scale-reader.ts).
 */
export function ScaleConfigSection() {
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

  return (
    <div className="space-y-4 text-sm">
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
