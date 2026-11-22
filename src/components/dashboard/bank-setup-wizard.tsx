"use client";

import { useState } from "react";
import { SUPPORTED_BANKS } from "@/lib/bank-parsers";

interface BankSetupWizardProps {
  selectedBanks: string[];
  onBanksChange: (banks: string[]) => void;
  onClose: () => void;
}

export function BankSetupWizard({ selectedBanks, onBanksChange, onClose }: BankSetupWizardProps) {
  const [step, setStep] = useState(1);
  const [localBanks, setLocalBanks] = useState<string[]>(selectedBanks);

  const toggleBank = (bankId: string) => {
    setLocalBanks((prev) =>
      prev.includes(bankId) ? prev.filter((b) => b !== bankId) : [...prev, bankId]
    );
  };

  const handleSave = () => {
    onBanksChange(localBanks);
    setStep(3);
  };

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">Configurar conciliación bancaria</h4>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:underline">
          Cerrar
        </button>
      </div>

      {/* Pasos */}
      <div className="flex gap-2 text-xs">
        {[1, 2, 3].map((s) => (
          <span
            key={s}
            className={`px-2 py-1 rounded ${step === s ? "bg-primary text-white" : "bg-muted"}`}
          >
            Paso {s}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">1. ¿Qué bancos usás para cobrar?</p>
          <p className="text-xs text-muted-foreground">
            Seleccioná los bancos donde recibís transferencias de clientes.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_BANKS.filter((b) => b.id !== "generic").map((bank) => (
              <label key={bank.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={localBanks.includes(bank.id)}
                  onChange={() => toggleBank(bank.id)}
                  className="w-4 h-4"
                />
                {bank.name}
              </label>
            ))}
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={localBanks.length === 0}
            className="text-sm px-3 py-1.5 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            Siguiente →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">2. Configurar reenvío de emails</p>
          <p className="text-xs text-muted-foreground">
            Configurá tu correo para reenviar automáticamente los emails de tu banco al portal.
          </p>

          <div className="bg-white dark:bg-gray-800 rounded p-3 text-xs space-y-2 border">
            <p className="font-medium">En Gmail:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Ir a Configuración → Ver toda la configuración → Filtros</li>
              <li>Crear filtro nuevo → En "De" poner el email de tu banco</li>
              <li>En "Asunto" poner: ingreso, transferencia, acreditación</li>
              <li>Click "Crear filtro" → tildar "Reenviar a"</li>
              <li>Agregar: <code className="bg-muted px-1 rounded">pagos+tu-slug@portal659.com.ar</code></li>
              <li>Verificar la dirección de reenvío (te llega un código)</li>
            </ol>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded p-3 text-xs space-y-2 border">
            <p className="font-medium">En Outlook:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Ir a Configuración → Correo → Reglas</li>
              <li>Nueva regla → "Cuando llegue un mensaje de [banco]"</li>
              <li>Acción: "Reenviar a" → <code className="bg-muted px-1 rounded">pagos+tu-slug@portal659.com.ar</code></li>
            </ol>
          </div>

          <p className="text-xs text-amber-600">
            ⚠️ Algunos bancos permiten cambiar el email de notificaciones directamente en la app del banco.
            Si tu banco lo permite, poné <code className="bg-muted px-1 rounded">pagos+tu-slug@portal659.com.ar</code> como email de avisos.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="text-sm px-3 py-1.5 rounded bg-muted hover:bg-muted/80"
            >
              ← Atrás
            </button>
            <button
              onClick={handleSave}
              className="text-sm px-3 py-1.5 rounded bg-primary text-white hover:bg-primary/90"
            >
              Guardar configuración
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3 text-center">
          <p className="text-2xl">✅</p>
          <p className="text-sm font-medium">Configuración guardada</p>
          <p className="text-xs text-muted-foreground">
            A partir de ahora, los emails de tu banco que reenvíes al portal se procesarán automáticamente.
            Los depósitos aparecerán en la lista de "Depósitos detectados" en el tab Pedidos.
          </p>
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded bg-primary text-white hover:bg-primary/90"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}