"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type EditableItem = {
  name: string;
  price: string;
  category: string;
  description: string;
  group?: string;
  modifiers?: { desc: string; price_mod: number }[];
};

type AnalyzeResult = {
  usedLlm: boolean;
  read: number;
  valid: number;
  toImport: number;
  willUpdate: number;
  invalid: { row: string; reason: string }[];
  items: EditableItem[];
};

type ImportResult = {
  imported: number;
  updated: number;
  createdCategories: string[];
  errors: { name: string; error: string }[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onImported: (sum: { imported: number; updated: number; createdCategories: string[]; errors: { name: string; error: string }[] }) => void;
};

export function MenuImportModal({ open, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAnalyze(f: File) {
    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("action", "analyze");
      fd.append("file", f);
      const res = await fetch("/api/vendor/offers/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "No se pudo procesar el archivo");
        return;
      }
      setAnalyze(data);
      setItems((data.items || []).map((it: EditableItem) => ({ ...it, price: String(it.price) })));
      setStep("preview");
    } catch {
      setError("Hubo un error al procesar el archivo");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("action", "import");
      fd.append("items", JSON.stringify(items));
      const res = await fetch("/api/vendor/offers/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "No se pudo importar");
        return;
      }
      setResult(data);
      setStep("done");
      onImported(data);
    } catch {
      setError("Hubo un error al importar");
    } finally {
      setLoading(false);
    }
  }

  function updateItem(idx: number, key: keyof EditableItem, value: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    setFile(null);
    setStep("upload");
    setAnalyze(null);
    setItems([]);
    setResult(null);
    setError("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Importar menú (Excel)"
      footer={
        <div className="flex w-full gap-3">
          {step === "preview" && (
            <Button type="button" className="flex-1" disabled={loading || items.length === 0} onClick={handleImport}>
              {loading ? "Importando..." : `Importar ${items.length} platos`}
            </Button>
          )}
          <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      {step === "upload" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (file) handleAnalyze(file);
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">
            Subí un archivo <strong>.xlsx</strong> con columnas{" "}
            <strong>nombre, precio, categoría y descripción</strong> (en cualquier orden o nombre). Opcionalmente
            podés agregar una columna <strong>"Grupo"</strong> y columnas{" "}
            <strong>"Modificante 1 descripción"</strong> + <strong>"Modificante 1 precio"</strong>,{" "}
            <strong>"Modificante 2 descripción"</strong> + <strong>"Modificante 2 precio"</strong>, etc. — se cargan
            como grupo de opciones del producto. Primero se analiza y te mostramos un preview editable antes de importar.
          </p>
          <label className="block">
            <span className="text-sm font-medium">Archivo Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="mt-1 block w-full text-sm text-muted-foreground
                file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2
                file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError("");
              }}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={!file || loading}>
            {loading ? "Analizando..." : "Analizar archivo"}
          </Button>
        </form>
      )}

      {step === "preview" && analyze && (
        <div className="space-y-4">
          <div className="rounded-xl border border-fresh bg-fresh/20 p-4">
            <p className="font-semibold text-fresh-foreground">
              {analyze.usedLlm ? "✨ Analizado con IA" : "Analizado (modo básico)"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Leídos: <strong>{analyze.read}</strong> filas · Válidos: <strong>{analyze.valid}</strong> · A
              importar: <strong>{analyze.toImport}</strong> · Se actualizarán: <strong>{analyze.willUpdate}</strong>{" "}
              {analyze.invalid.length > 0 && <>· Descartados: <strong className="text-amber-600">{analyze.invalid.length}</strong></>}
            </p>
          </div>

          {items.length > 0 && (
            <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="p-2 font-medium">Nombre</th>
                    <th className="p-2 w-24 font-medium">Precio</th>
                    <th className="p-2 w-32 font-medium">Categoría</th>
                    <th className="p-2 font-medium">Opciones</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-b border-border last:border-0 align-top">
                      <td className="p-1">
                        <input
                          className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                          value={it.name}
                          onChange={(e) => updateItem(i, "name", e.target.value)}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                          value={it.price}
                          inputMode="decimal"
                          onChange={(e) => updateItem(i, "price", e.target.value)}
                        />
                      </td>
                      <td className="p-1">
                        <input
                          className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                          value={it.category}
                          onChange={(e) => updateItem(i, "category", e.target.value)}
                        />
                      </td>
                      <td className="p-1">
                        {it.modifiers && it.modifiers.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {it.group && (
                              <span className="inline-flex items-center text-[10px] font-medium text-primary">
                                {it.group}:
                              </span>
                            )}
                            {it.modifiers.map((m, mi) => (
                              <span key={mi} className="inline-flex items-center gap-1 text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                                {m.desc}
                                {Number(m.price_mod) > 0 && <span className="text-primary font-medium">+${Number(m.price_mod).toLocaleString("es-AR")}</span>}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          className="text-xs text-red-600 hover:underline"
                          aria-label="Quitar"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {analyze.invalid.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-600">Filas descartadas:</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {analyze.invalid.map((e, i) => (
                  <li key={i}>
                    <strong>{e.row}</strong>: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-4">
          <div className="rounded-xl border border-fresh bg-fresh/20 p-4">
            <p className="font-semibold text-fresh-foreground">✅ Menú importado</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Platos importados: <strong>{result.imported}</strong></li>
              <li>Platos actualizados: <strong>{result.updated}</strong></li>
              <li>Categorías creadas: <strong>{result.createdCategories.length}</strong></li>
            </ul>
          </div>

          {result.errors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-600">Se omitieron filas con errores:</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <strong>{e.name}</strong>: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            variant="outline"
            onClick={() => {
              setFile(null);
              setStep("upload");
              setAnalyze(null);
              setItems([]);
              setResult(null);
              setError("");
            }}
          >
            Importar otro archivo
          </Button>
        </div>
      )}
    </Modal>
  );
}