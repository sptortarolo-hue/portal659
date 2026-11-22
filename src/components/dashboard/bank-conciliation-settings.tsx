"use client";

import { useState } from "react";
import { BankSetupWizard } from "./bank-setup-wizard";
import { VoiceToggle } from "./voice-toggle";
import { BankConciliation } from "./bank-conciliation";
import { SUPPORTED_BANKS } from "@/lib/bank-parsers";

interface BankConciliationSettingsProps {
  vendor: any;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
}

export function BankConciliationSettings({ vendor, saveVendor }: BankConciliationSettingsProps) {
  const [enabled, setEnabled] = useState<boolean>(!!vendor?.bank_conciliation_enabled);
  const [banks, setBanks] = useState<string[]>(vendor?.bank_conciliation_banks || []);
  const [voice, setVoice] = useState<boolean>(!!vendor?.bank_conciliation_voice);
  const [showWizard, setShowWizard] = useState(false);

  const handleToggleEnabled = async (v: boolean) => {
    setEnabled(v);
    await saveVendor({ bank_conciliation_enabled: v });
  };

  const handleBanksChange = async (newBanks: string[]) => {
    setBanks(newBanks);
    await saveVendor({ bank_conciliation_banks: newBanks });
  };

  const handleVoiceToggle = async (v: boolean) => {
    setVoice(v);
    await saveVendor({ bank_conciliation_voice: v });
  };

  return (
    <div className="space-y-4 border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-medium text-sm">Conciliación bancaria por email</h4>
          <p className="text-xs text-muted-foreground">
            Detecta transferencias automáticamente desde los emails de tu banco.
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleToggleEnabled(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm">{enabled ? "Activada" : "Desactivada"}</span>
        </label>
      </div>

      {enabled && (
        <>
          <div>
            <p className="text-xs font-medium mb-1">Bancos configurados:</p>
            <div className="flex flex-wrap gap-1">
              {banks.length === 0 ? (
                <span className="text-xs text-muted-foreground">Ninguno — configurá en el wizard</span>
              ) : (
                banks.map((b) => (
                  <span key={b} className="text-xs px-2 py-0.5 rounded bg-muted">
                    {SUPPORTED_BANKS.find((s) => s.id === b)?.name || b}
                  </span>
                ))
              )}
            </div>
          </div>

          <VoiceToggle enabled={voice} onToggle={handleVoiceToggle} />

          {!showWizard ? (
            <button
              onClick={() => setShowWizard(true)}
              className="text-sm px-3 py-1.5 rounded bg-primary text-white hover:bg-primary/90"
            >
              ⚙️ Configurar reenvío de emails
            </button>
          ) : (
            <BankSetupWizard
              selectedBanks={banks}
              onBanksChange={handleBanksChange}
              onClose={() => setShowWizard(false)}
            />
          )}
        </>
      )}

      {enabled && vendor?.id && (
        <div className="mt-4 border-t pt-4">
          <BankConciliation
            vendorId={vendor.id}
            enabled={enabled}
            banks={banks}
            voiceEnabled={voice}
            onSettingsChange={() => {}}
          />
        </div>
      )}
    </div>
  );
}