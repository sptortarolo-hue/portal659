"use client";

import { useMemo, useState } from "react";
import { ModifierPicker } from "@/components/offers/modifier-picker";
import { ProductImage } from "@/components/product-image";
import { useCart, type CartVendor } from "@/lib/cart";
import { useToast } from "@/lib/toast";
import type { ProductModifier } from "@/types/database";
import type { ComboMemberRow } from "@/lib/combo";
import { variantMatches, dimEq, dimSuffix } from "@/lib/variant-utils";

/**
 * Armado de combo por unidad (moda/retail): cada pieza del combo que se vende
 * por variante se elige color × talle acá, antes de agregar. Lo usan:
 *  - el micrositio (mode "cart": agrega al carrito del local, con el paso de
 *    modificadores propio del combo si los tiene), y
 *  - el mostrador (mode "line": devuelva las piezas por onConfirm, el POS
 *    agrega la línea y si el combo tiene opciones encadena su picker).
 */
type Pick = { color: string; talle: string };

type VariantLike = {
  id: string;
  color?: string | null;
  talle?: string | null;
  stock?: number | null;
  price?: number | null;
  promo?: number | null;
};

export type ComboBuilderProps = {
  combo: { id: string; name: string; description?: string | null; image_url?: string | null; price: number; promo_price: number | null; category?: string | null };
  members: { product_id: string; name: string; qty: number }[];
  variantsBy: Record<string, VariantLike[]>;
  mode: "cart" | "line";
  vendor?: CartVendor | null;
  /** Opciones propias del combo producto (solo cart mode: se encadenan). */
  mods?: ProductModifier[] | null;
  onConfirm?: (result: { members: ComboMemberRow[]; mods: { group: string; label: string }[]; productId: string }) => void;
  onClose: () => void;
};

export function ComboBuilderSheet({
  combo,
  members,
  variantsBy,
  mode,
  vendor,
  mods,
  onConfirm,
  onClose,
}: ComboBuilderProps) {
  const { addItem } = useCart();
  const { addToast } = useToast();
  const [picks, setPicks] = useState<Record<string, Pick[]>>(() => {
    const init: Record<string, Pick[]> = {};
    for (const m of members || []) {
      const vs = (variantsBy?.[m.product_id] || []) as VariantLike[];
      if (vs.length === 0) continue;
      // Variante de una sola dimensión (única con stock): el slot nace resuelto.
      const cols = [...new Set(vs.filter((v) => Number(v.stock ?? 0) > 0 && String(v.color ?? "").trim() !== "").map((v) => String(v.color).trim()))];
      const talls = [...new Set(vs.filter((v) => Number(v.stock ?? 0) > 0 && String(v.talle ?? "").trim() !== "").map((v) => String(v.talle).trim()))];
      let prefill: Pick = { color: "", talle: "" };
      if (cols.length === 1 && talls.length === 0) prefill = { color: cols[0], talle: "" };
      else if (talls.length === 1 && cols.length === 0) prefill = { color: "", talle: talls[0] };
      init[m.product_id] = Array.from({ length: Math.max(1, Math.floor(Number(m.qty) || 1)) }, () => ({ ...prefill }));
    }
    return init;
  });
  const [showMods, setShowMods] = useState(false);
  const [added, setAdded] = useState(false);

  const paidPrice =
    combo.promo_price != null && Number(combo.promo_price) > 0 ? Number(combo.promo_price) : Number(combo.price || 0);

  const chooseable = (members || []).filter((m) => (variantsBy?.[m.product_id] || []).length > 0);
  const pickOk = (pid: string, p: Pick | undefined) => {
    if (!p) return false;
    const vs = (variantsBy?.[pid] || []) as VariantLike[];
    return vs.some((v) => variantMatches(v, p.color, p.talle));
  };
  const complete =
    chooseable.length === 0 ||
    chooseable.every((m) => (picks[m.product_id] || []).every((p) => pickOk(m.product_id, p)));

  const setPick = (pid: string, i: number, next: { color?: string; talle?: string }) =>
    setPicks((prev) => {
      const arr = [...(prev[pid] || [])];
      arr[i] = { ...(arr[i] || { color: "", talle: "" }), ...next };
      return { ...prev, [pid]: arr };
    });

  const colorsOf = (pid: string) => {
    const seen = new Map<string, number>();
    for (const v of (variantsBy?.[pid] || []) as VariantLike[]) {
      const c = String(v.color ?? "").trim();
      if (c === "") continue;
      const stock = Number.isFinite(Number(v.stock)) ? Number(v.stock) : 1;
      if (stock <= 0) continue;
      seen.set(c, (seen.get(c) || 0) + stock);
    }
    return [...seen.keys()];
  };
  const tallsOf = (pid: string, color: string) => {
    const seen = new Map<string, number>();
    for (const v of (variantsBy?.[pid] || []) as VariantLike[]) {
      if (!dimEq(v.color, color)) continue;
      const t = String(v.talle ?? "").trim();
      if (t === "") continue;
      const stock = Number.isFinite(Number(v.stock)) ? Number(v.stock) : 1;
      if (stock <= 0) continue;
      seen.set(t, (seen.get(t) || 0) + stock);
    }
    return [...seen.keys()];
  };
  const stockFor = (pid: string, pick: Pick | undefined): number | null => {
    const hit = ((variantsBy?.[pid] || []) as VariantLike[]).find((v) => pickOk(pid, pick) && variantMatches(v, pick!.color, pick!.talle));
    if (!hit) return null;
    return Number.isFinite(Number(hit.stock)) ? Math.max(0, Math.floor(Number(hit.stock))) : null;
  };

  const rows: ComboMemberRow[] = useMemo(() => {
    const out: ComboMemberRow[] = [];
    for (const m of members || []) {
      const vs = (variantsBy?.[m.product_id] || []) as VariantLike[];
      if (vs.length === 0) {
        out.push({ product_id: m.product_id, name: m.name, qty: Math.max(1, Math.floor(Number(m.qty) || 1)) });
        continue;
      }
      for (const p of picks[m.product_id] || []) {
        const v = vs.find((vv) => variantMatches(vv, p.color, p.talle));
        if (!v) continue;
        out.push({
          product_id: m.product_id,
          variant_id: v.id,
          color: v.color || null,
          talle: v.talle || null,
          name: `${m.name}${dimSuffix(v.color, v.talle)}`,
          qty: 1,
        });
      }
    }
    return out;
  }, [members, picks, variantsBy]);

  function finish(modsSelected: { group: string; label: string }[]) {
    if (mode === "line") {
      onConfirm?.({ members: rows, mods: modsSelected, productId: combo.id });
      onClose();
      return;
    }
    if (!vendor) return;
    const switched = addItem(vendor, {
      offerId: combo.id,
      name: combo.name,
      price: paidPrice,
      qty: 1,
      comboMembers: rows,
      image: combo.image_url || null,
    });
    setAdded(true);
    if (switched) addToast("Se limpió el carrito anterior (solo podés pedir de un local a la vez)");
    else addToast(`${combo.name} agregado al carrito`);
    window.setTimeout(() => onClose(), 700);
  }

  const withMods = (mods || []).length > 0;

  function handleConfirm() {
    if (!complete || added) return;
    if (withMods) {
      setShowMods(true);
      return;
    }
    finish([]);
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-3 sm:p-4" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl max-h-[86vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Ficha del combo */}
          <div className="flex gap-3 p-4 pb-2 border-b border-border/60 sticky top-0 bg-card z-10">
            <div className="h-14 w-14 rounded-xl overflow-hidden flex-shrink-0 bg-muted">
              <ProductImage
                src={combo.image_url || null}
                name={combo.name}
                category={combo.category}
                vertical={vendor?.vertical || null}
                alt={combo.name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold leading-snug flex-1">{combo.name}</p>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Cerrar">✕</button>
              </div>
              {paidPrice > 0 && (
                <p className="text-sm font-bold text-primary tabular-nums">${paidPrice.toLocaleString("es-AR")}</p>
              )}
            </div>
          </div>
          <div className="p-4 pt-3">
            <p className="text-xs font-semibold text-muted-foreground mb-3">Elegí los componentes</p>
            <div className="space-y-4">
              {(members || []).map((m) => {
                const vs = (variantsBy?.[m.product_id] || []) as VariantLike[];
                return (
                  <div key={m.product_id}>
                    <p className="text-sm">
                      <span className="font-semibold">{m.name}</span>
                      {m.qty > 1 && <span className="text-muted-foreground"> · {m.qty} piezas</span>}
                    </p>
                    {vs.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground mt-0.5">Va tal cual, sin elección</p>
                    ) : (
                      <div className="mt-1.5 space-y-2">
                        {(picks[m.product_id] || []).map((p, i) => (
                          <div key={i} className="rounded-xl border border-border p-2.5 bg-background/60">
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] font-medium text-muted-foreground">
                                Pieza {i + 1}{m.qty > 1 ? ` de ${m.qty}` : ""}
                              </p>
                              {(() => {
                                const st = stockFor(m.product_id, p);
                                return st != null && st <= 5 ? (
                                  <span className={`text-[10px] ${st <= 0 ? "text-red-500 font-semibold" : "text-amber-600 font-semibold"}`}>
                                    {st <= 0 ? "sin stock" : `¡quedan ${st}!`}
                                  </span>
                                ) : null;
                              })()}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {colorsOf(m.product_id).length > 0 && (
                                <Chips
                                  items={colorsOf(m.product_id)}
                                  value={p?.color || ""}
                                  onValue={(c) => setPick(m.product_id, i, { color: c, talle: tallsOf(m.product_id, c).length === 1 ? tallsOf(m.product_id, c)[0] : "" })}
                                  emptyLabel="Color"
                                />
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {tallsOf(m.product_id, p?.color || "").length > 0 ? (
                                <Chips
                                  items={tallsOf(m.product_id, p?.color || "")}
                                  value={p?.talle || ""}
                                  onValue={(t) => setPick(m.product_id, i, { talle: t })}
                                  emptyLabel="Talle"
                                />
                              ) : (
                                colorsOf(m.product_id).length === 0 && (
                                  <Chips items={["Único"]} value="Único" onValue={() => {}} emptyLabel="" />
                                )
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {withMods && (
              <p className="text-[11px] text-muted-foreground mt-3">
                Después de elegir, te preguntamos las opciones del combo (envoltorio/cantidades).
              </p>
            )}
            <button
              type="button"
              disabled={!complete || added}
              onClick={handleConfirm}
              className={`mt-4 w-full rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                complete && !added
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.99]"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              {added ? "✓ Agregado" : complete ? "Agregar combo" : "Elegí la variante de cada pieza"}
            </button>
          </div>
        </div>
      </div>

      {showMods && (
        <ModifierPicker
          modifiers={mods || []}
          productName={combo.name}
          basePrice={paidPrice}
          onCancel={() => setShowMods(false)}
          onConfirm={(selected, _finalPrice) => {
            setShowMods(false);
            finish(selected);
          }}
        />
      )}
    </>
  );
}

function Chips({
  items,
  value,
  onValue,
  emptyLabel,
}: {
  items: string[];
  value: string;
  onValue: (v: string) => void;
  emptyLabel: string;
}) {
  if (items.length === 0) return <span className="text-[10px] text-muted-foreground">{emptyLabel} sin stock</span>;
  return (
    <>
      {items.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onValue(s)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            value === s
              ? "border-violet-500 bg-violet-500 text-white"
              : "border-border text-foreground hover:border-violet-400"
          }`}
        >
          {s}
        </button>
      ))}
    </>
  );
}
