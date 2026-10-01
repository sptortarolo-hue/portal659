"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export const WA_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/beambfgmpbbncelafdodhppkjgnnabgf";

type EditableItem = {
  index: string;
  name: string;
  price: string;
  category: string;
  description: string;
  hasImage: boolean;
};

type AnalyzeResult = {
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
  onImported: (sum: ImportResult) => void;
  isComercio?: boolean;
};

export function MenuImportWaModal({ open, onClose, onImported, isComercio = false }: Props) {
  const itemLabel = isComercio ? "productos" : "platos";
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [analyze, setAnalyze] = useState<AnalyzeResult | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAnalyze(f: File, cat: string) {
    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("action", "analyze_wa");
      fd.append("file", f);
      fd.append("category", cat.trim() || "otras");
      const res = await fetch("/api/vendor/offers/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "No se pudo procesar el CSV");
        return;
      }
      setAnalyze(data);
      setItems(
        (data.items || []).map(
          (it: { index: string; name: string; price: number; category: string; description: string; hasImage: boolean }) => ({
            index: it.index || "",
            name: it.name,
            price: String(it.price),
            category: it.category || cat.trim() || "otras",
            description: it.description || "",
            hasImage: Boolean(it.hasImage),
          })
        )
      );
      setStep("preview");
    } catch {
      setError("Hubo un error al procesar el CSV");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!file) {
      setError("Se perdió el archivo original (necesario para las fotos). Volvé a elegirlo.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("action", "import_wa");
      fd.append("file", file);
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

  function updateItem(idx: number, key: "name" | "price" | "category" | "description", value: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    setFile(null);
    setCategory("");
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
      title="Importar desde WhatsApp"
      footer={
        <div className="flex w-full gap-3">
          {step === "preview" && (
            <Button type="button" className="flex-1" disabled={loading || items.length === 0} onClick={handleImport}>
              {loading ? "Importando..." : `Importar ${items.length} ${itemLabel}`}
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
            if (file) handleAnalyze(file, category);
          }}
          className="space-y-4"
        >
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-sm font-semibold">Cómo generar el archivo (una sola vez)</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Instalá la extensión{" "}
                <a
                  href={WA_EXTENSION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline"
                >
                  WhatsApp Catalogue Exporter
                </a>{" "}
                en Chrome.
              </li>
              <li>
                Abrí <strong>web.whatsapp.com</strong> con la cuenta del comercio, abrí el catálogo/tienda y usá la
                extensión para <strong>exportar a CSV</strong>.
              </li>
              <li>Subí ese archivo <strong>.csv</strong> acá abajo. Se importan nombre, precio, descripción y foto.</li>
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              La extensión es de un tercero (no es de Portal 659). Si WhatsApp cambia su web, la exportación puede
              fallar. El CSV puede pesar varios MB por las fotos: es normal que el análisis tarde unos segundos.
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Archivo CSV de WhatsApp</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="mt-1 block w-full text-sm text-muted-foreground
                file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-2
                file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError("");
              }}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Categoría para los productos importados</span>
            <input
              className="mt-1 block w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="Ej. Dietética (el CSV de WhatsApp no trae categorías)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={!file || loading}>
            {loading ? "Analizando..." : "Analizar CSV"}
          </Button>
        </form>
      )}

      {step === "preview" && analyze && (
        <div className="space-y-4">
          <div className="rounded-xl border border-fresh bg-fresh/20 p-4">
            <p className="font-semibold text-fresh-foreground">CSV de WhatsApp analizado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Filas: <strong>{analyze.read}</strong> · Válidos: <strong>{analyze.valid}</strong> · A importar:{" "}
              <strong>{analyze.toImport}</strong> · Se actualizarán: <strong>{analyze.willUpdate}</strong>{" "}
              {analyze.invalid.length > 0 && <>· Descartados: <strong className="text-amber-600">{analyze.invalid.length}</strong></>}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              📷 = trae foto del catálogo (se guarda en el producto). Podés editar nombre, precio, categoría y
              descripción antes de importar.
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
                    <th className="p-2 w-8 font-medium">📷</th>
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
                        {it.description ? (
                          <input
                            className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs text-muted-foreground"
                            value={it.description}
                            onChange={(e) => updateItem(i, "description", e.target.value)}
                          />
                        ) : null}
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
                      <td className="p-1 text-center text-xs">{it.hasImage ? "📷" : <span className="text-muted-foreground/60">—</span>}</td>
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
              <p className="text-sm font-medium text-amber-600">Filas descartadas (logos, fotos sueltas, sin precio):</p>
              <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">
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
            <p className="font-semibold text-fresh-foreground">✅ Catálogo importado</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>
                {itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1)} importados: <strong>{result.imported}</strong>
              </li>
              <li>
                {itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1)} actualizados: <strong>{result.updated}</strong>
              </li>
              <li>
                Categorías creadas: <strong>{result.createdCategories.length}</strong>
              </li>
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
              setCategory("");
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
