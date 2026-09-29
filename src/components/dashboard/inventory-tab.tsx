"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PurchasesManager } from "@/components/dashboard/purchases-manager";
import { getJson, apiJson } from "@/components/dashboard/shared";

type SubView = "compras" | "conteos" | "kardex" | "reposicion";

type CountRow = {
  id: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  lines_count: number;
};

type CountLine = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  system_qty: number;
  counted_qty: number | null;
  note: string | null;
  product_name?: string | null;
  variant_color?: string | null;
  variant_talle?: string | null;
};

type Movement = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  qty_delta: number;
  reason: string;
  created_at: string;
  product_name?: string | null;
  variant_color?: string | null;
  variant_talle?: string | null;
};

type Suggestion = {
  kind: "product" | "variant";
  id: string;
  product_id: string;
  name: string;
  stock: number;
  threshold: number;
  avgDaily: number;
  coverDays: number | null;
  suggestedQty: number;
    costLast: number | null;
    costAvg: number | null;
  bestPrice: number | null;
  bestSupplier: string | null;
};

const REASONS: Record<string, string> = {
  compra: "Compra",
  venta: "Venta",
  conteo: "Conteo",
  merma: "Merma",
  devolucion: "Devolución",
  manual: "Ajuste",
  apartado: "Apartado",
};

/**
 * Pestaña Inventario (comercio + gastro con gestión): compras de mercadería,
 * conteos físicos, kardex y reposición sugerida. Montada con
 * `can("inventory")`; sin el flag ni las rutas responden.
 */
export function InventoryTab({ reloadKey = 0 }: { reloadKey?: number }) {
  const [view, setView] = useState<SubView>("compras");
  const [msg, setMsg] = useState("");
  // Catálogo para pickers (compras) y conteos.
  const [products, setProducts] = useState<{ id: string; name: string; cost_last?: number | null; stock?: number | null }[]>([]);
  const [variants, setVariants] = useState<{ id: string; product_id: string; color: string; talle: string; price: number; stock: number; cost_last?: number | null }[]>([]);
  // Conteos.
  const [counts, setCounts] = useState<CountRow[]>([]);
  const [openCount, setOpenCount] = useState<{ id: string; lines: CountLine[]; status: string } | null>(null);
  const [countSearch, setCountSearch] = useState("");
  const [countSaving, setCountSaving] = useState(false);
  // Kardex.
  const [moves, setMoves] = useState<Movement[]>([]);
  const [moveFilter, setMoveFilter] = useState("");
  const [moveReason, setMoveReason] = useState("all");
  // Reposición.
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const loadCatalog = useCallback(async () => {
    const [o, v] = await Promise.all([
      getJson<{ offers: any[] }>("/api/vendor/offers"),
      getJson<{ variants: any[] }>("/api/vendor/variants").catch(() => null),
    ]);
    if (o?.offers) {
      setProducts(
        (o.offers as any[]).map((p) => ({
          id: String(p.id),
          name: String(p.name || ""),
          cost_last: p.cost_last != null ? Number(p.cost_last) : null,
          stock: p.stock != null ? Number(p.stock) : null,
        }))
      );
    }
    const vlist = (v as any)?.variants;
    if (Array.isArray(vlist)) {
      setVariants(
        vlist.map((x: any) => ({
          id: String(x.id),
          product_id: String(x.product_id || ""),
          color: String(x.color || ""),
          talle: String(x.talle || ""),
          price: Number(x.price) || 0,
          stock: Number(x.stock) || 0,
          cost_last: x.cost_last != null ? Number(x.cost_last) : null,
        }))
      );
    }
  }, []);

  const loadCounts = useCallback(async () => {
    const d = await getJson<{ counts: CountRow[] }>("/api/vendor/stock-counts").catch(() => null);
    if (d?.counts) setCounts(d.counts);
  }, []);

  const loadMoves = useCallback(async () => {
    const d = await getJson<{ movements: Movement[] }>("/api/vendor/stock-movements?limit=100").catch(() => null);
    if (d?.movements) setMoves(d.movements);
  }, []);

  const loadRepo = useCallback(async () => {
    const d = await getJson<{ suggestions: Suggestion[] }>("/api/vendor/replenishment").catch(() => null);
    if (d?.suggestions) setSuggestions(d.suggestions);
  }, []);

  useEffect(() => {
    loadCatalog();
    loadCounts();
    loadMoves();
    loadRepo();
  }, [loadCatalog, loadCounts, loadMoves, loadRepo, reloadKey]);

  async function openCountDetail(id: string) {
    const d = await getJson<{ count: any; lines: CountLine[] }>(`/api/vendor/stock-counts/${id}`).catch(() => null);
    if (d?.count) setOpenCount({ id, lines: d.lines || [], status: String(d.count.status || "abierto") });
  }

  async function newCount() {
    setMsg("");
    const items = [
      ...products.map((p) => ({ product_id: p.id })),
      ...variants.map((v) => ({ variant_id: v.id })),
    ];
    if (items.length === 0) {
      setMsg("No hay productos para contar");
      return;
    }
    const r = await apiJson("/api/vendor/stock-counts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!r.ok) {
      setMsg(r.error || "No se pudo abrir el conteo");
      return;
    }
    await loadCounts();
    const newId = (r as any)?.count_id;
    if (newId) await openCountDetail(String(newId));
  }

  async function saveCountLines(): Promise<boolean> {
    if (!openCount) return false;
    setCountSaving(true);
    const r = await apiJson(`/api/vendor/stock-counts/${openCount.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: openCount.lines.map((l) => ({ id: l.id, counted_qty: l.counted_qty, note: l.note })),
      }),
    });
    setCountSaving(false);
    if (!r.ok) setMsg(r.error || "No se pudo guardar");
    return !!r.ok;
  }

  async function closeCount() {
    if (!openCount) return;
    if (!window.confirm("¿Cerrar el conteo y aplicar las diferencias al stock?")) return;
    // Auto-guardar pendientes: sin esto el cierre aplicaría 0 diferencias.
    const saved = await saveCountLines();
    if (!saved) return;
    const uncounted = openCount.lines.filter((l) => l.counted_qty == null).length;
    const r = await apiJson(`/api/vendor/stock-counts/${openCount.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close" }),
    });
    if (!r.ok) {
      setMsg(r.error || "No se pudo cerrar");
      return;
    }
    setMsg(
      `Conteo cerrado: ${(r as any)?.applied ?? 0} diferencia(s) aplicada(s)` +
      (uncounted > 0 ? ` · ${uncounted} línea(s) sin contar (sin cambios)` : "") +
      ((r as any)?.activated > 0 ? ` · ${(r as any).activated} producto(s) con control de stock activado` : "")
    );
    setOpenCount(null);
    await loadCounts();
    await loadMoves();
    // Refrescar catálogo (stock visible) y reposición tras aplicar.
    await loadCatalog();
    await loadRepo();
  }

  function setLineCounted(id: string, value: string) {
    const v = value === "" ? null : Math.max(0, Math.floor(Number(value)));
    setOpenCount((prev) =>
      prev ? { ...prev, lines: prev.lines.map((l) => (l.id === id ? { ...l, counted_qty: Number.isFinite(v) ? v : null } : l)) } : prev
    );
  }

  const countFiltered = useMemo(() => {
    const q = countSearch.trim().toLowerCase();
    if (!openCount) return [];
    if (!q) return openCount.lines;
    return openCount.lines.filter((l) => {
      const name = `${l.product_name || ""} ${l.variant_color || ""} ${l.variant_talle || ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [openCount, countSearch]);

  const movesFiltered = useMemo(() => {
    const q = moveFilter.trim().toLowerCase();
    return moves.filter((m) => {
      if (moveReason !== "all" && m.reason !== moveReason) return false;
      if (!q) return true;
      const name = `${m.product_name || ""} ${m.variant_color || ""} ${m.variant_talle || ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [moves, moveFilter, moveReason]);

  const money = (n: number | null | undefined) =>
    n == null ? "—" : `$${Number(n).toLocaleString("es-AR")}`;

  const VIEWS: { id: SubView; label: string }[] = [
    { id: "compras", label: "🧾 Compras" },
    { id: "conteos", label: "📋 Conteos" },
    { id: "kardex", label: "📒 Kardex" },
    { id: "reposicion", label: "📦 Reposición" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex rounded-xl border border-border overflow-x-auto max-w-full text-sm font-medium">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`px-3 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm transition-colors ${
              view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {msg && <p className="text-sm text-green-700">{msg}</p>}

      {view === "compras" && (
        <PurchasesManager
          ingredients={[]}
          search=""
          onChanged={() => {
            loadMoves();
            loadRepo();
          }}
          products={products}
          variants={variants}
          allowMerchandise
        />
      )}

      {view === "conteos" && (
        <div className="space-y-3">
          {!openCount ? (
            <>
              <Button size="sm" onClick={newCount}>
                + Nuevo conteo (todo el catálogo)
              </Button>
              {counts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Sin conteos. Abrí uno para comparar sistema vs físico.
                </p>
              ) : (
                <div className="space-y-2">
                  {counts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => openCountDetail(c.id)}
                      className="w-full flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-sm hover:border-primary/50 text-left"
                    >
                      <span>
                        {new Date(c.created_at).toLocaleDateString("es-AR")}{" "}
                        <span className="text-muted-foreground">· {c.lines_count} líneas</span>
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          c.status === "abierto" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                        }`}
                      >
                        {c.status === "abierto" ? "Abierto" : "Cerrado"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpenCount(null)}>
                  ← Volver
                </Button>
                <Input
                  value={countSearch}
                  onChange={(e) => setCountSearch(e.target.value)}
                  placeholder="🔍 Buscar en el conteo…"
                  className="flex-1"
                />
              </div>
              <div className="space-y-1.5">
                {countFiltered.map((l) => {
                  const name =
                    l.product_id != null
                      ? l.product_name || "Producto"
                      : `${l.product_name || ""} (${l.variant_color || ""} · ${l.variant_talle || ""})`;
                  const diff = l.counted_qty != null ? l.counted_qty - (Number(l.system_qty) || 0) : null;
                  return (
                    <div key={l.id} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                      <span className="flex-1 min-w-0 text-sm truncate">{name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                        sist: {Number(l.system_qty) || 0}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={l.counted_qty ?? ""}
                        onChange={(e) => setLineCounted(l.id, e.target.value)}
                        placeholder="Físico"
                        disabled={openCount.status !== "abierto"}
                        className="w-20 h-9 text-sm text-center tabular-nums"
                      />
                      {diff !== null && diff !== 0 && (
                        <span className={`text-xs font-bold tabular-nums flex-shrink-0 ${diff > 0 ? "text-green-600" : "text-red-600"}`}>
                          {diff > 0 ? `+${diff}` : diff}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {openCount.status === "abierto" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" disabled={countSaving} onClick={saveCountLines}>
                    {countSaving ? "Guardando…" : "Guardar avance"}
                  </Button>
                  <Button size="sm" className="flex-1" onClick={closeCount}>
                    Cerrar y aplicar
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {view === "kardex" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={moveFilter}
              onChange={(e) => setMoveFilter(e.target.value)}
              placeholder="🔍 Buscar producto…"
              className="flex-1"
            />
            <select
              value={moveReason}
              onChange={(e) => setMoveReason(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="Filtrar por motivo"
            >
              <option value="all">Todos</option>
              {Object.entries(REASONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {movesFiltered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin movimientos todavía. Las ventas, compras y conteos quedan registrados acá.
            </p>
          ) : (
            <Card className="divide-y divide-border">
              {movesFiltered.map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      Number(m.qty_delta) >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {Number(m.qty_delta) >= 0 ? `+${m.qty_delta}` : m.qty_delta}
                  </span>
                  <span className="flex-1 min-w-0 truncate">
                    {m.product_name || ""}
                    {m.variant_id ? ` (${m.variant_color || ""} · ${m.variant_talle || ""})` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {REASONS[m.reason] || m.reason}
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                    {new Date(m.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {view === "reposicion" && (
        <div className="space-y-2">
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nada por reponer: todo el stock cubre el umbral y la venta promedio. 🎉
            </p>
          ) : (
            suggestions.map((s) => (
              <div key={`${s.kind}:${s.id}`} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate flex-1 min-w-0">{s.name}</p>
                  <span className="text-sm font-bold tabular-nums flex-shrink-0 text-primary">
                    comprar {s.suggestedQty}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                  stock {s.stock} · umbral {s.threshold}
                  {s.coverDays !== null ? ` · ~${s.coverDays} días` : " · sin ventas recientes"}
                    {s.costLast != null ? ` · costo ${money(s.costLast)}` : ""}
                    {s.costAvg != null ? ` (prom ${money(s.costAvg)})` : ""}
                </p>
                {s.bestSupplier && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    💡 {s.bestSupplier}
                    {s.bestPrice != null ? ` · ${money(s.bestPrice)}` : ""}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
