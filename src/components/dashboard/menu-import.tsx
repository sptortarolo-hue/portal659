"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type Props = {
  open: boolean;
  onClose: () => void;
  onImported: (summary: { imported: number; updated: number; createdCategories: string[]; errors: { name: string; error: string }[]; usedLlm: boolean }) => void;
};

export function MenuImportModal({ open, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{ imported: number; updated: number; categories: number } | null>(null);
  const [usedLlm, setUsedLlm] = useState(false);
  const [importErrors, setImportErrors] = useState<{ name: string; error: string }[]>([]);

  async function handleAnalyze(f: File) {
    setAnalyzing(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/vendor/offers/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "No se pudo procesar el archivo");
        return;
      }
      setUsedLlm(!!data.usedLlm);
      setImportErrors(data.errors || []);
      setSummary({
        imported: data.imported ?? 0,
        updated: data.updated ?? 0,
        categories: (data.createdCategories || []).length,
      });
      onImported(data);
    } catch {
      setError("Hubo un error al procesar el archivo");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    setSummary(null);
    setImportErrors([]);
    await handleAnalyze(file);
    setLoading(false);
  }

  function reset() {
    setFile(null);
    setError("");
    setSummary(null);
    setImportErrors([]);
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
          <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      {!summary ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Subí un archivo <strong>.xlsx</strong> con las columnas{" "}
            <strong>nombre, precio, categoría y descripción</strong> (pueden estar en
            cualquier orden/nombre). Se cargarán o actualizarán los platos del comercio.
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
                const f = e.target.files?.[0] || null;
                setFile(f);
                setSummary(null);
                setError("");
              }}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={!file || loading || analyzing}>
            {analyzing ? "Procesando con IA..." : loading ? "Importando..." : "Importar menú"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-fresh bg-fresh/20 p-4">
            <p className="font-semibold text-fresh-foreground">
              {usedLlm ? "✨ Menú importado con IA" : "Menú importado"}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Platos importados: <strong>{summary.imported}</strong></li>
              <li>Platos actualizados: <strong>{summary.updated}</strong></li>
              <li>Categorías creadas: <strong>{summary.categories}</strong></li>
            </ul>
          </div>

          {importErrors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-600">Se omitieron filas con errores:</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {importErrors.map((e, i) => (
                  <li key={i}>
                    <strong>{e.name}</strong>: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button type="button" className="w-full" variant="outline" onClick={() => setSummary(null)}>
            Importar otro archivo
          </Button>
        </div>
      )}
    </Modal>
  );
}
