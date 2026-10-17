"use client";

/**
 * Check "🧾 Con comprobante fiscal (Factura C)" + selector de receptor,
 * compartido por Mostrador y Mesas. Se renderiza solo cuando la config
 * fiscal del comercio está completa (fiscalReady); si no está tildado el
 * cobro imprime ticket no fiscal / no imprime, igual que siempre.
 * Receptor: consumidor final por default; con DNI/CUIT la factura sale a
 * nombre (RG 5700/2025: CF solo se identifica desde $10M).
 */

export type FiscalReceptorTipo = "cf" | "dni" | "cuit";

export type FiscalReceptor = {
  tipo: FiscalReceptorTipo;
  nro: string;
  nombre: string;
  cond: string;
};

type Props = {
  withFiscal: boolean;
  onWithFiscal: (v: boolean) => void;
  receptor: FiscalReceptor;
  onReceptor: (r: FiscalReceptor) => void;
  /** Total a cobrar: para el aviso de identificación obligatoria desde $10M. */
  payableTotal?: number;
};

export function FiscalSaleFields({
  withFiscal,
  onWithFiscal,
  receptor,
  onReceptor,
  payableTotal,
}: Props) {
  return (
    <>
      <button
        type="button"
        onClick={() => onWithFiscal(!withFiscal)}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${
          withFiscal
            ? "border-primary bg-primary/5 text-primary"
            : "border-border text-muted-foreground"
        }`}
        aria-pressed={withFiscal}
      >
        <span
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 text-[12px] font-bold ${
            withFiscal ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 text-transparent"
          }`}
          aria-hidden
        >
          ✓
        </span>
        🧾 Con comprobante fiscal (Factura C)
      </button>
      {withFiscal && (
        <div className="space-y-1.5 rounded-xl border border-border p-2.5">
          <div className="flex gap-1.5">
            <select
              value={receptor.tipo}
              onChange={(e) => onReceptor({ ...receptor, tipo: e.target.value as FiscalReceptorTipo })}
              className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
              aria-label="Receptor del comprobante"
            >
              <option value="cf">Consumidor final</option>
              <option value="dni">DNI</option>
              <option value="cuit">CUIT</option>
            </select>
            {receptor.tipo !== "cf" && (
              <input
                value={receptor.nro}
                onChange={(e) => onReceptor({ ...receptor, nro: e.target.value })}
                placeholder={receptor.tipo === "cuit" ? "CUIT (11 dígitos)" : "DNI (7-8 dígitos)"}
                inputMode="numeric"
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs"
              />
            )}
          </div>
          {receptor.tipo === "cuit" && (
            <div className="flex gap-1.5">
              <input
                value={receptor.nombre}
                onChange={(e) => onReceptor({ ...receptor, nombre: e.target.value })}
                placeholder="Razón social (opcional)"
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs"
              />
              <select
                value={receptor.cond}
                onChange={(e) => onReceptor({ ...receptor, cond: e.target.value })}
                className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
                aria-label="Condición IVA del receptor"
              >
                <option value="6">Monotributo</option>
                <option value="1">Resp. Inscripto</option>
                <option value="4">Exento</option>
              </select>
            </div>
          )}
          {receptor.tipo === "cf" && (payableTotal ?? 0) >= 10000000 && (
            <p className="text-[11px] text-amber-700">
              ⚠️ ARCA exige identificar al comprador desde $10.000.000: cargá DNI o CUIT.
            </p>
          )}
        </div>
      )}
    </>
  );
}
