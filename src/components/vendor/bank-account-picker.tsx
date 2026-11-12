"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { bankAccountLabel, needsAccountPicker, type VendorBankAccount } from "@/lib/bank-accounts";

/**
 * Hook para leer las cuentas del comercio (mismo endpoint que el ABM).
 * Cada instancia fetcha; es liviano. Devuelve accounts=null mientras carga.
 */
export function useBankAccounts(): {
  accounts: VendorBankAccount[] | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [accounts, setAccounts] = useState<VendorBankAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/bank-accounts");
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.accounts)) setAccounts(data.accounts);
      else setAccounts([]);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { accounts, loading, refresh };
}

export type BankAccountPickerProps = {
  /** Cuentas del comercio (solo se muestra si hay 2+ activas). */
  accounts: VendorBankAccount[] | null | undefined;
  open: boolean;
  onClose: () => void;
  onPick: (account: VendorBankAccount) => void;
  title?: string;
  /** Mensaje chico debajo del título (contexto). */
  hint?: string;
};

/**
 * Modal de elección de cuenta. Se usa en el cobro, al compartir datos de
 * pago y al editar un pedido a transferencia. Con 0/1 cuenta activa el
 * caller no debería abrirlo (no hay elección).
 */
export function BankAccountPickerModal({
  accounts,
  open,
  onClose,
  onPick,
  title = "¿A qué cuenta va la transferencia?",
  hint,
}: BankAccountPickerProps) {
  const active = (accounts || []).filter((a) => a.active);
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" zIndex={90}>
      <div className="space-y-3">
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <div className="space-y-2">
          {active.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onPick(a)}
              className="w-full rounded-xl border border-border bg-card p-3 text-left hover:border-primary/50 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">🏦 {bankAccountLabel(a)}</span>
                {a.is_default && (
                  <span className="rounded-full bg-sun px-2 py-0.5 text-[10px] font-bold text-ink">Principal</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 break-all">
                {[a.alias && `Alias: ${a.alias}`, a.cbu && `CBU: ${a.cbu}`, a.holder && `Titular: ${a.holder}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          La cuenta elegida queda registrada en el cobro y en los informes.
        </p>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Helper para callers: ¿hay que abrir el picker antes de cobrar? (2+ activas).
 * Si no, se usa la cuenta principal sin preguntar.
 */
export { needsAccountPicker };
