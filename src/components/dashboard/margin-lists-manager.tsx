"use client";

/**
 * Listas de margen: un nombre + regla (Recargo % sobre costo | Margen % sobre
 * precio) + %, compartidos por los productos/variantes asignados. El recálculo
 * siempre pasa por un preview antes de escribir (dryRun).
 * Las APIs responden 503 nombrando migrate-margin-lists.sql sin la migración.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  ROUND_MODE_OPTIONS,
  ROUND_STEPS,
  describeRounding,
  isDefaultRounding,
  resolveRounding,
  roundingExample,
  tailOptionsFor,
  type Rounding,
  type RoundMode,
} from "@/lib/price-rounding";
import {
  equivalentsFromMargin,
  equivalentsFromMarkup,
  gainFromPriceCost,
} from "@/lib/price-rounding";
import { priceFromCost } from "@/lib/cost-reprice";

export type OfferLike = {
  id: string;
  name: string;
  price?: number | string | null;
  promo_price?: number | string | null;
  cost_last?: number | string | null;
  is_combo?: boolean | null;
  margin_list_id?: string | null;
  sku?: string | null;
};

export type MarginList = {
  id: string;
  name: string;
  rule: "markup" | "margin";
  pct: number;
  productCount: number;
  /** Redondeo de la lista (migrate-price-rounding.sql). undefined sin migrar = default neutro. */
  price_round_step?: number;
  price_round_mode?: "nearest" | "up" | "down";
  price_round_tail?: number;
};

const money = (n: number) => `$${Number(n).toLocaleString("es-AR")}`;

/** Regla de redondeo de una lista (saneada; undefined → default neutro). */
export function listRounding(l: Pick<MarginList, "price_round_step" | "price_round_mode" | "price_round_tail"> | null | undefined): Rounding {
  return resolveRounding({ step: l?.price_round_step, mode: l?.price_round_mode, tail: l?.price_round_tail });
}

export function marginListRuleLabel(l: Pick<MarginList, "rule" | "pct">): string {
  const pct = Number(l.pct);
  const t = Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 100) / 100);
  return l.rule === "markup" ? `Recargo +${t}%` : `Margen ${t}%`;
}

/** Línea de equivalencia (Fase B: un solo vocabulario de ganancia). */
export function gainEquivalenceLine(
  rule: "markup" | "margin",
  pct: number,
  rounding?: Rounding
): string | null {
  if (!Number.isFinite(pct) || pct < 0) return null;
  const eq = rule === "markup" ? equivalentsFromMarkup(pct) : equivalentsFromMargin(pct);
  const precio = priceFromCost(1000, rule, pct, rounding);
  if (precio == null) return null;
  return `Recargo ${eq.markup}% · margen ${eq.margin}% · food cost ${eq.foodCost}% · costo $1.000 → ${money(precio)}`;
}

/** Selector de redondeo: múltiplo + criterio + terminación. */
function RoundingPicker({ value, onChange }: { value: Rounding; onChange: (r: Rounding) => void }) {
  const tails = tailOptionsFor(value.step);
  const example = roundingExample(1234, value);
  const cls = "h-10 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={cls}
        aria-label="Múltiplo de redondeo"
        value={String(value.step)}
        onChange={(e) => {
          const step = Number(e.target.value);
          onChange({ ...value, step, tail: value.tail < step ? value.tail : 0 });
        }}
      >
        {ROUND_STEPS.map((s) => (
          <option key={s} value={s}>
            {s === 1 ? "Sin múltiplo (precio exacto)" : `Múltiplo de $${s.toLocaleString("es-AR")}`}
          </option>
        ))}
      </select>
      <select
        className={cls}
        aria-label="Criterio de redondeo"
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as RoundMode })}
      >
        {ROUND_MODE_OPTIONS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <select
        className={cls}
        aria-label="Terminación del precio"
        value={String(value.tail)}
        onChange={(e) => onChange({ ...value, tail: Number(e.target.value) })}
      >
        {tails.map((t) => (
          <option key={t.id} value={t.tail}>
            {t.label}
          </option>
        ))}
      </select>
      {example && (
        <span className="text-xs text-muted-foreground tabular-nums">
          Ej.: {example}
        </span>
      )}
    </div>
  );
}

/**
 * Regla GLOBAL del comercio (vendors.price_round_*). Es el fallback para
 * productos sin lista y la que aplican por defecto los precios masivos y el
 * sugerido del recetario. Vive acá (Catálogo → Listas) porque es la
 * superficie de precios; cada lista puede tener su propio redondeo.
 */
function VendorRoundingCard() {
  const [rule, setRule] = useState<Rounding | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/vendor/me")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setRule(
          resolveRounding({
            step: d?.vendor?.price_round_step,
            mode: d?.vendor?.price_round_mode,
            tail: d?.vendor?.price_round_tail,
          })
        );
      })
      .catch(() => {
        if (alive) setRule(resolveRounding(null));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!rule) return null;

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price_round_step: rule!.step,
          price_round_mode: rule!.mode,
          price_round_tail: rule!.tail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? "✓ Guardado" : data.error || "No se pudo guardar");
    } catch {
      setMsg("No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  const dirty = !isDefaultRounding(rule);
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <p className="font-medium text-sm">🎯 Redondeo de precios del comercio</p>
      <p className="text-xs text-muted-foreground">
        Aplica a los <strong>precios masivos</strong> y al <strong>sugerido del recetario</strong>. Cada lista de margen
        puede tener su propio redondeo (lo pisa). Default: precio exacto sin decimales (como siempre).
      </p>
      <RoundingPicker value={rule} onChange={(r) => { setRule(r); setMsg(""); }} />
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" type="button" onClick={save} disabled={busy}>
          {busy ? "Guardando…" : "Guardar regla"}
        </Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
      {dirty && (
        <p className="text-xs text-muted-foreground">
          {describeRounding(rule)}
        </p>
      )}
    </div>
  );
}

type PreviewItem = {
  id: string;
  kind: "product" | "variant";
  name: string;
  cost: number | null;
  oldPrice: number;
  newPrice: number | null;
  oldPromo: number | null;
  newPromo: number | null;
  skip: "no_cost" | "combo" | null;
};

export function MarginListsManager({
  offers,
  lists,
  error,
  onRefresh,
  onChanged,
}: {
  offers: OfferLike[];
  lists: MarginList[] | null;
  error: string | null;
  onRefresh: () => void;
  onChanged?: () => void;
}) {
  const [createName, setCreateName] = useState("");
  const [createRule, setCreateRule] = useState<"markup" | "margin">("markup");
  const [createPct, setCreatePct] = useState("");
  const [createRound, setCreateRound] = useState<Rounding>(() => resolveRounding(null));
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRule, setEditRule] = useState<"markup" | "margin">("markup");
  const [editPct, setEditPct] = useState("");
  const [editRound, setEditRound] = useState<Rounding>(() => resolveRounding(null));
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  const [assignSearch, setAssignSearch] = useState<Record<string, string>>({});
  const [openAssign, setOpenAssign] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState<string | null>(null);

  const [previewList, setPreviewList] = useState<MarginList | null>(null);
  const [preview, setPreview] = useState<{
    loading?: boolean;
    error?: string;
    items?: PreviewItem[];
    skippedNoCost?: number;
    skippedCombo?: number;
    applied?: { updated: number; variantsUpdated: number; promosUpdated: number } | null;
    roundingLabel?: string | null;
  } | null>(null);
  const [includePromos, setIncludePromos] = useState(false);

  const savingList = createBusy || editBusy;

  function resetPreview() {
    setPreviewList(null);
    setPreview(null);
    setIncludePromos(false);
  }

  async function fetchPreview(list: MarginList, withPromos: boolean) {
    setPreview({ loading: true });
    try {
      const res = await fetch(`/api/vendor/margin-lists/${list.id}/reprice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true, includePromos: withPromos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPreview({ error: data.error || "No se pudo calcular la vista previa" });
        return;
      }
      setPreview({
        items: data.items as PreviewItem[],
        skippedNoCost: data.skippedNoCost,
        skippedCombo: data.skippedCombo,
        applied: null,
        roundingLabel: data.roundingLabel ?? null,
      });
    } catch {
      setPreview({ error: "No se pudo calcular la vista previa" });
    }
  }

  function openPreview(list: MarginList) {
    setPreviewList(list);
    setPreview(null);
    setIncludePromos(false);
    fetchPreview(list, false);
  }

  async function applyPreview() {
    if (!previewList) return;
    setPreview((p) => ({ ...p, loading: true, error: undefined }));
    try {
      const res = await fetch(`/api/vendor/margin-lists/${previewList.id}/reprice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includePromos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPreview((p) => ({ ...p, loading: false, error: data.error || "No se pudo aplicar" }));
        return;
      }
      setPreview((p) => ({
        ...p,
        loading: false,
        applied: { updated: data.updated ?? 0, variantsUpdated: data.variantsUpdated ?? 0, promosUpdated: data.promosUpdated ?? 0 },
      }));
      onChanged?.();
    } catch {
      setPreview((p) => ({ ...p, loading: false, error: "No se pudo aplicar" }));
    }
  }

  async function createList() {
    setCreateError("");
    const pct = Number(createPct);
    if (!createName.trim()) return setCreateError("Ponele un nombre a la lista");
    if (!Number.isFinite(pct) || pct < 0) return setCreateError("El % debe ser un número ≥ 0");
    if (createRule === "markup" && pct > 1000) return setCreateError("El recargo no puede superar el 1000%");
    if (createRule === "margin" && pct >= 100) return setCreateError("El margen debe ser menor al 100%");
    setCreateBusy(true);
    try {
      const res = await fetch("/api/vendor/margin-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          rule: createRule,
          pct,
          price_round_step: createRound.step,
          price_round_mode: createRound.mode,
          price_round_tail: createRound.tail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setCreateError(data.error || "No se pudo crear la lista");
        return;
      }
      setCreateName("");
      setCreatePct("");
      setCreateRule("markup");
      setCreateRound(resolveRounding(null));
      onRefresh();
    } finally {
      setCreateBusy(false);
    }
  }

  function startEdit(list: MarginList) {
    setEditId(list.id);
    setEditName(list.name);
    setEditRule(list.rule);
    setEditPct(String(Number(list.pct)));
    setEditRound(listRounding(list));
    setEditError("");
  }

  async function saveEdit() {
    if (!editId) return;
    setEditError("");
    const pct = Number(editPct);
    if (!editName.trim()) return setEditError("El nombre es obligatorio");
    if (!Number.isFinite(pct) || pct < 0) return setEditError("El % debe ser un número ≥ 0");
    if (editRule === "markup" && pct > 1000) return setEditError("El recargo no puede superar el 1000%");
    if (editRule === "margin" && pct >= 100) return setEditError("El margen debe ser menor al 100%");
    setEditBusy(true);
    try {
      const res = await fetch(`/api/vendor/margin-lists/${editId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          rule: editRule,
          pct,
          price_round_step: editRound.step,
          price_round_mode: editRound.mode,
          price_round_tail: editRound.tail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setEditError(data.error || "No se pudo guardar");
        return;
      }
      setEditId(null);
      onRefresh();
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteList(list: MarginList) {
    if (!window.confirm(`Borrar la lista "${list.name}". Sus productos quedan sin lista (no se toca el precio). ¿Continuar?`)) return;
    const res = await fetch(`/api/vendor/margin-lists/${list.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      window.alert(data.error || "No se pudo borrar la lista");
      return;
    }
    onRefresh();
    onChanged?.();
  }

  async function toggleAssign(list: MarginList, offer: OfferLike, checked: boolean) {
    setAssignBusy(offer.id);
    try {
      const res = await fetch(`/api/vendor/margin-lists/${list.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [offer.id], mode: checked ? "assign" : "unassign" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        window.alert(data.error || "No se pudo asignar el producto");
        return;
      }
      onRefresh();
      onChanged?.();
    } finally {
      setAssignBusy(null);
    }
  }

  const previewItems = preview?.items ?? [];
  const previewApplyCount = previewItems.filter((i) => !i.skip).length;

  if (error) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Regla global del comercio */}
      <VendorRoundingCard />

      {/* Alta de lista */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="font-medium text-sm">Nueva lista de margen</p>
        <p className="text-xs text-muted-foreground">
          Una lista = un recargo o margen sobre el <strong>costo</strong>, compartido por los productos que le asignes.
          El recálculo siempre te muestra el antes/después antes de escribir.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Nombre (ej. Almacén)"
            className="flex-1 min-w-[160px]"
            maxLength={60}
          />
          <select
            value={createRule}
            onChange={(e) => setCreateRule(e.target.value as "markup" | "margin")}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Regla"
          >
            <option value="markup">Recargo % sobre costo</option>
            <option value="margin">Margen % sobre precio</option>
          </select>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={createPct}
            onChange={(e) => setCreatePct(e.target.value)}
            placeholder={createRule === "markup" ? "100 = costo +100%" : "50 = margen del 50%"}
            className="w-36"
          />
          <Button type="button" onClick={createList} disabled={savingList}>
            {createBusy ? "Creando…" : "Crear"}
          </Button>
        </div>
        {(() => {
          const line = gainEquivalenceLine(createRule, Number(createPct), createRound);
          return line ? <p className="text-xs text-muted-foreground tabular-nums">{line}</p> : null;
        })()}
        <RoundingPicker value={createRound} onChange={setCreateRound} />
        {createError && <p className="text-xs text-destructive">{createError}</p>}
      </div>

      {/* Lista de listas */}
      {lists == null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : lists.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Todavía no creaste ninguna lista. Ejemplo: “Almacén — Recargo +30%” con todos los productos de almacén.
          </p>
        </div>
      ) : (
        lists.map((list) => (
          <div key={list.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">🏷️ {list.name}</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                {marginListRuleLabel(list)}
              </span>
              {!isDefaultRounding(listRounding(list)) && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                  🎯 {describeRounding(listRounding(list))}
                </span>
              )}
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                {list.productCount} {list.productCount === 1 ? "producto" : "productos"}
              </span>
              <span className="flex-1" />
              <Button size="sm" type="button" onClick={() => openPreview(list)}>
                Recalcular
              </Button>
              <Button size="sm" variant="outline" type="button" onClick={() => startEdit(list)}>
                Editar
              </Button>
              <Button size="sm" variant="outline" type="button" onClick={() => deleteList(list)}>
                Borrar
              </Button>
            </div>

            {editId === list.id && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 min-w-[140px]" maxLength={60} />
                  <select
                    value={editRule}
                    onChange={(e) => setEditRule(e.target.value as "markup" | "margin")}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="markup">Recargo % sobre costo</option>
                    <option value="margin">Margen % sobre precio</option>
                  </select>
                  <Input type="number" min={0} step="any" value={editPct} onChange={(e) => setEditPct(e.target.value)} className="w-28" />
                  <Button size="sm" type="button" onClick={saveEdit} disabled={editBusy}>
                    {editBusy ? "Guardando…" : "Guardar"}
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setEditId(null)}>
                    Cancelar
                  </Button>
                </div>
                {(() => {
                  const line = gainEquivalenceLine(editRule, Number(editPct), editRound);
                  return line ? <p className="text-xs text-muted-foreground tabular-nums">{line}</p> : null;
                })()}
                <RoundingPicker value={editRound} onChange={setEditRound} />
                {editError && <p className="text-xs text-destructive">{editError}</p>}
              </div>
            )}

            {/* Asignador */}
            <div>
              <button
                type="button"
                onClick={() => setOpenAssign(openAssign === list.id ? null : list.id)}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {openAssign === list.id ? "▾ Ocultar productos" : "▸ Asignar productos…"}
              </button>
              {openAssign === list.id && (
                <AssignPanel
                  offers={offers}
                  list={list}
                  search={assignSearch[list.id] ?? ""}
                  onSearch={(v) => setAssignSearch((s) => ({ ...s, [list.id]: v }))}
                  onToggle={toggleAssign}
                  busyId={assignBusy}
                />
              )}
            </div>
          </div>
        ))
      )}

      {/* Modal de recálculo */}
      <Modal
        open={!!previewList}
        onClose={resetPreview}
        title={previewList ? `Recalcular “${previewList.name}”` : "Recalcular"}
        footer={
          <>
            <Button type="button" variant="outline" onClick={resetPreview}>
              Cerrar
            </Button>
            <Button
              type="button"
              disabled={!preview || !!preview.loading || !!preview.applied || !!preview.error || previewApplyCount === 0}
              onClick={applyPreview}
            >
              {preview?.applied
                ? `✓ Recalculada (${preview.applied.updated} prod.${preview.applied.variantsUpdated > 0 ? ` + ${preview.applied.variantsUpdated} var.` : ""})`
                : preview?.loading
                  ? "Aplicando…"
                  : `Aplicar (${previewApplyCount})`}
            </Button>
          </>
        }
      >
        {previewList && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {marginListRuleLabel(previewList)} sobre el último costo. Los combos y las tarjetas se omiten; los
              productos/variantes sin costo se listan abajo y no se tocan.
              {preview?.roundingLabel ? ` Redondeo: ${preview.roundingLabel}.` : ""}
            </p>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none rounded-lg border border-border px-3 py-2">
              <input
                type="checkbox"
                checked={includePromos}
                onChange={(e) => {
                  setIncludePromos(e.target.checked);
                  if (previewList) fetchPreview(previewList, e.target.checked);
                }}
                className="h-4 w-4 accent-lime-500"
              />
              Incluir promos (manteniendo el descuento)
            </label>
            {preview?.loading && !preview.items && <p className="text-sm text-muted-foreground">Calculando…</p>}
            {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}
            {preview?.items && preview.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay productos con esta lista todavía — asignalos abajo con “Asignar productos…”.
              </p>
            )}
            {preview?.items && preview.items.length > 0 && (
              <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <th className="text-left p-2">Producto</th>
                      <th className="text-right p-2">Costo</th>
                      <th className="text-right p-2">Precio actual</th>
                      <th className="text-right p-2">Precio nuevo</th>
                      {includePromos && <th className="text-right p-2">Promo nueva</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, 200).map((i) => (
                      <tr key={`${i.kind}-${i.id}`} className={i.skip ? "opacity-50" : ""}>
                        <td className="p-2">
                          {i.name}
                          {i.kind === "variant" && <span className="text-muted-foreground"> · variante</span>}
                          {i.skip === "combo" && <span className="ml-1">🧩</span>}
                          {i.skip === "no_cost" && <span className="ml-1">⚠️</span>}
                        </td>
                        <td className="p-2 text-right tabular-nums">{i.cost != null ? money(i.cost) : "—"}</td>
                        <td className="p-2 text-right tabular-nums">{money(i.oldPrice)}</td>
                        <td className="p-2 text-right tabular-nums font-medium">
                          {i.newPrice != null ? (
                            <>
                              {money(i.newPrice)}
                              {(() => {
                                const g = gainFromPriceCost(i.newPrice, i.cost);
                                return g ? (
                                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                    {g.margin.toFixed(1)}% margen
                                  </span>
                                ) : null;
                              })()}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        {includePromos && (
                          <td className="p-2 text-right tabular-nums">{i.newPromo != null ? money(i.newPromo) : "—"}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.items.length > 200 && (
                  <p className="p-2 text-xs text-muted-foreground border-t border-border">
                    …y {preview.items.length - 200} más.
                  </p>
                )}
              </div>
            )}
            {preview && (preview.skippedNoCost ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                ⚠️ {preview.skippedNoCost} sin costo (se omiten) · {preview.skippedCombo ?? 0} combos omitidos.
              </p>
            )}
            {preview?.applied && (
              <p className="text-sm text-green-700 dark:text-green-400">
                ✓ Lista recalculada: {preview.applied.updated} productos
                {preview.applied.variantsUpdated > 0 ? ` + ${preview.applied.variantsUpdated} variantes` : ""}
                {preview.applied.promosUpdated > 0 ? ` · ${preview.applied.promosUpdated} promos` : ""}.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function AssignPanel({
  offers,
  list,
  search,
  onSearch,
  onToggle,
  busyId,
}: {
  offers: OfferLike[];
  list: MarginList;
  search: string;
  onSearch: (v: string) => void;
  onToggle: (list: MarginList, offer: OfferLike, checked: boolean) => void;
  busyId: string | null;
}) {
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const base = !q
      ? offers
      : offers.filter(
          (o) => o.name.toLowerCase().includes(q) || (o.sku || "").toLowerCase().includes(q)
        );
    return base.slice(0, 200);
  }, [offers, q]);

  return (
    <div className="mt-2 rounded-lg border border-border">
      <div className="p-2 border-b border-border">
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Buscar producto…"
          className="h-9"
        />
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">Nada por acá con esa búsqueda.</p>
        ) : (
          filtered.map((o) => {
            const checked = o.margin_list_id === list.id;
            return (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busyId === o.id}
                  onChange={(e) => onToggle(list, o, e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate">
                  {o.name}
                  {o.is_combo && <span title="Combo: no se recalcula"> 🧩</span>}
                </span>
                {o.margin_list_id && o.margin_list_id !== list.id && (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">en otra lista</span>
                )}
              </label>
            );
          })
        )}
      </div>
      {q === "" && offers.length > 200 && (
        <p className="p-2 text-[11px] text-muted-foreground border-t border-border">
          Mostrando los primeros 200. Usá el buscador para el resto.
        </p>
      )}
    </div>
  );
}
