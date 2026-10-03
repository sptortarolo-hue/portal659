"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveDraft, loadDraft, clearDraft } from "@/lib/draft";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ModifierPicker } from "@/components/offers/modifier-picker";
import { ProductImage } from "@/components/product-image";
import { ProductPickCard } from "@/components/vendor/product-pick-card";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";
import { getCatalogSnapshot, getTablesSnapshot, saveCatalogSnapshot, saveTablesSnapshot, outboxList } from "@/lib/offline-db";
import { enqueueOfflineAction, isNetworkError, newClientKey, nextProvisionalNumber } from "@/lib/offline-actions";
import { checkOfflineAllowed, offlineDeniedMsg } from "@/lib/offline-plan";
import { dispatchOfflinePrint, markPrintsDone } from "@/lib/local-print";

import { SYNC_COMPLETED_EVENT } from "@/lib/sync-engine";
import { useCashShift } from "@/lib/use-cash-shift";
import { FloorPlan, type FloorDecor, type FloorTable } from "@/components/vendor/floor-plan";
import {
  DEFAULT_DURATION_MIN,
  reservationTimeState,
  type ReservationConfig,
} from "@/lib/reservations";
type Table = {
  id: string;
  name: string;
  capacity: number;
  status: "libre" | "ocupada" | "reservada";
  x: number;
  y: number;
  width: number;
  height: number;
  shape: "square" | "round" | "rectangle";
  rotation: number;
};

type ModifierOption = { label: string; price_mod: number };
type ProductModifier = {
  id: string;
  product_id: string;
  group_name: string;
  options: ModifierOption[];
  required: boolean;
  max_selections: number;
  position: number;
  created_at: string;
};
type CartModifier = { group: string; label: string; price_mod: number };

type Product = {
  id: string;
  name: string;
  price: number;
  promo_price: number | null;
  available: boolean;
  image_url?: string | null;
  category?: string | null;
  requires_prep?: boolean;
  cash_discount_excluded?: boolean | null;
  /** Venta en packs (ej: 6). El precio es del paquete; la unidad se deriva. */
  pack_size?: number | null;
  modifiers?: ProductModifier[];
};

/** Items al formato del ticket de contingencia (modificadores como labels). */
function toContingencyItems(list: any[]): { qty: number; name: string; modifiers: string[] }[] {
  return (list || []).map((i) => ({
    qty: Number(i?.qty) || 1,
    name: String(i?.name || ""),
    modifiers: Array.isArray(i?.modifiers)
      ? i.modifiers.map((m: any) => (typeof m === "string" ? m : String(m?.label || ""))).filter(Boolean)
      : [],
  }));
}

/** Tamaño del pack (1 = venta por unidad). */
function packOf(p: Product): number {
  return Number.isInteger(Number(p.pack_size)) && Number(p.pack_size) >= 2 ? Math.floor(Number(p.pack_size)) : 1;
}
/** Precio por unidad a FULL PRECISION (nunca sumar unidades redondeadas:
 *  11500/6 = 1916.66… → ×6 = 11500 exacto tras redondear el total). */
function unitPriceOf(p: Product): number {
  const base = Number(p.promo_price ?? p.price);
  const pk = packOf(p);
  return pk > 1 ? base / pk : base;
}

type Order = {
  id: string;
  table_id: string | null;
  items: { name: string; price: number; qty: number; modifiers?: string[] }[];
  total: number;
  status: string;
  created_at: string;
  paid_at?: string | null;
  pickup_number?: number | null;
};

/** Consumición guardada offline (pendiente de sync). Items = formato carrito. */
type LocalAdd = {
  localId: string;
  clientKey: string;
  tableId: string;
  items: { product_id: string; name: string; price: number; qty: number; requires_prep: boolean; modifiers?: CartModifier[]; packSize?: number }[];
  total: number;
  payment: string;
  createdAt: number;
  provisional: number;
};

/** Cierre de mesa guardado offline (pendiente de sync). */
type LocalClose = {
  localId: string;
  clientKey: string;
  tableId: string;
  tableName: string;
  total: number;
  estimated: boolean;
  createdAt: number;
  provisional: number;
};

const PAYMENT_OPTIONS = [
  { key: "efectivo", label: "💵 Efectivo" },
  { key: "transferencia", label: "🏦 Transferencia" },
  { key: "tarjeta", label: "💳 Tarjeta" },
  { key: "mixto", label: "🪙 Mixto" },
];

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  mixto: "Mixto",
};

export function Mesas({ vendorId }: { vendorId?: string | null }) {
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [newTable, setNewTable] = useState("");
  // Vista de la pantalla de mesas: plano visual o grilla clásica.
  const [planView, setPlanView] = useState<"plano" | "grilla">("plano");
  useEffect(() => {
    if (!vendorId) return;
    try {
      const v = localStorage.getItem(`portal659-mesas-view-${vendorId}`);
      if (v === "plano" || v === "grilla") setPlanView(v);
    } catch { /* sin localStorage */ }
  }, [vendorId]);
  function changePlanView(v: "plano" | "grilla") {
    setPlanView(v);
    try {
      if (vendorId) localStorage.setItem(`portal659-mesas-view-${vendorId}`, v);
    } catch { /* sin localStorage */ }
  }
  function selectTable(t: Table) {
    selectedAtRef.current = Date.now();
    setSelected(t);
    setMobileView("catalog");
  }
  const tableSubtotal = (id: string) =>
    orders
      .filter((o) => o.table_id === id && o.status !== "cancelled" && o.status !== "completed")
      .reduce((s, o) => s + Number(o.total), 0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selected, setSelected] = useState<Table | null>(null);
  // Reservas (estilo Fudo): modal por mesa con datos del cliente + fecha/hora.
  // La mesa reservada queda bloqueada hasta sentar o cancelar.
  type Reservation = {
    id: string;
    table_id: string | null;
    customer_name: string;
    customer_phone: string;
    customer_email?: string | null;
    party_size: number;
    reserved_at: string;
    duration_min?: number | null;
    status: string;
    notes?: string | null;
    table_name?: string | null;
  };
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [resConfig, setResConfig] = useState<ReservationConfig>({});
  const [resLeadInput, setResLeadInput] = useState("15");
  const [resTolInput, setResTolInput] = useState("15");
  const [resCfgSaving, setResCfgSaving] = useState(false);
  async function saveResConfig() {
    if (resCfgSaving) return;
    setResCfgSaving(true);
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_lead_min: Number(resLeadInput),
          reservation_tolerance_min: Number(resTolInput),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.vendor) {
        setResConfig({
          lead_min: (data.vendor as any).reservation_lead_min ?? 15,
          tolerance_min: (data.vendor as any).reservation_tolerance_min ?? 15,
        });
        setMsg("⚙️ Ventana de reservas guardada");
      } else setMsg(data.error || "No se pudo guardar");
    } catch {
      setMsg("No se pudo guardar");
    } finally {
      setResCfgSaving(false);
      setTimeout(() => setMsg(""), 2500);
    }
  }
  const [resModal, setResModal] = useState<{
    name: string; phone: string; email: string; party: string; datetime: string; duration: string; notes: string;
    tableId: string | null; lockTable: boolean;
  } | null>(null);
  const [resSaving, setResSaving] = useState(false);
  const [resActing, setResActing] = useState(false);
  // Overlay de reservas por ventana (estilo Fudo): bloqueada solo dentro de
  // [reserved_at - lead, reserved_at + tolerancia]; futura fuera de eso.
  const resOverlays = useMemo(() => {
    const now = Date.now();
    const blocked: string[] = [];
    const upcoming: string[] = [];
    for (const r of reservations) {
      if (!r.table_id || r.status !== "pendiente") continue;
      const st = reservationTimeState(r, resConfig, now);
      if (st === "blocked") blocked.push(r.table_id);
      else if (st === "upcoming" && !blocked.includes(r.table_id)) upcoming.push(r.table_id);
    }
    return { blocked, upcoming };
  }, [reservations, resConfig]);
  // Reserva a mostrar en el detalle: la bloqueada primero, si no la próxima,
  // si no la última vencida.
  const selectedReservation = useMemo(() => {
    if (!selected) return null;
    const mine = reservations.filter((r) => r.table_id === selected.id && r.status === "pendiente");
    if (mine.length === 0) return null;
    const now = Date.now();
    const rank = (r: Reservation) => {
      const st = reservationTimeState(r, resConfig, now);
      return st === "blocked" ? 0 : st === "upcoming" ? 1 : 2;
    };
    return [...mine].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return new Date(a.reserved_at).getTime() - new Date(b.reserved_at).getTime();
    })[0] ?? null;
  }, [reservations, selected, resConfig]);
  const selectedResState = selectedReservation
    ? reservationTimeState(selectedReservation, resConfig)
    : null;
  const resBanner = selectedReservation
    ? {
        title:
          selectedResState === "blocked"
            ? `📅 Reservada · ${selectedReservation.customer_name}`
            : selectedResState === "upcoming"
              ? `🕒 Próxima reserva · ${selectedReservation.customer_name}`
              : `⏰ Reserva vencida · ${selectedReservation.customer_name}`,
        cls:
          selectedResState === "upcoming"
            ? "border-sky-300 bg-sky-50/70 dark:bg-sky-950/20"
            : "border-amber-300 bg-amber-50/70 dark:bg-amber-950/20",
      }
    : null;
  // Bloqueo operativo real: solo dentro de la ventana (no por estado guardado).
  const resBlocked = selected ? resOverlays.blocked.includes(selected.id) : false;
  function defaultResDatetime(): string {
    const d = new Date();
    d.setHours(21, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function openResModal(tableId?: string | null, lockTable = true) {
    const fallback = tables.find((t) => t.status === "libre") ?? tables[0];
    const id = tableId ?? selected?.id ?? fallback?.id ?? null;
    if (!id) {
      setMsg("Creá primero una mesa en el plano");
      setTimeout(() => setMsg(""), 2500);
      return;
    }
    const t = tables.find((x) => x.id === id);
    setResModal({
      name: "",
      phone: "",
      email: "",
      party: String(t?.capacity || 2),
      datetime: defaultResDatetime(),
      duration: String(DEFAULT_DURATION_MIN),
      notes: "",
      tableId: id,
      lockTable,
    });
  }
  async function createReservation() {
    if (!resModal || resSaving) return;
    const table = tables.find((t) => t.id === resModal.tableId);
    if (!table) {
      setMsg("Elegí una mesa válida");
      setTimeout(() => setMsg(""), 2500);
      return;
    }
    setResSaving(true);
    try {
      const res = await fetch("/api/vendor/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: table.id,
          customer_name: resModal.name,
          customer_phone: resModal.phone,
          customer_email: resModal.email || undefined,
          party_size: Number(resModal.party) || 2,
          reserved_at: new Date(resModal.datetime).toISOString(),
          duration_min: Math.max(15, Math.min(720, Math.round(Number(resModal.duration) || DEFAULT_DURATION_MIN))),
          notes: resModal.notes || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.reservation) {
        setReservations((prev) => [...prev, data.reservation]);
        setResModal(null);
        const when = new Date(data.reservation.reserved_at).toLocaleString("es-AR", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        });
        setMsg(`📅 ${table.name} reservada para ${data.reservation.customer_name} (${when})`);
      } else {
        setMsg(data.code === "migration_pending"
          ? "Falta aplicar la migración de reservas en el servidor"
          : data.error || "No se pudo crear la reserva");
      }
    } catch {
      setMsg("No se pudo crear la reserva");
    } finally {
      setResSaving(false);
      setTimeout(() => setMsg(""), 3000);
    }
  }
  // La mesa abierta sigue a la lista fresca (evita estado rancio tras
  // sentar/cancelar/recargar).
  useEffect(() => {
    setSelected((prev) => {
      if (!prev) return prev;
      const fresh = tables.find((t) => t.id === prev.id);
      return fresh ? { ...fresh } : null;
    });
  }, [tables]);

  async function reservationAction(id: string, action: "seat" | "cancel" | "absent", tableId?: string | null) {
    if (resActing) return;
    if (action === "cancel" && !confirm("¿Cancelar esta reserva?")) return;
    if (action === "absent" && !confirm("¿Marcar como ausente (no vino)? Se libera la mesa.")) return;
    setResActing(true);
    try {
      const res = await fetch(`/api/vendor/reservations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.reservation) {
        // Al sentar se abre la mesa en el detalle (el sync con la lista
        // fresca la deja con el estado correcto).
        if (action === "seat" && tableId) {
          const t = tables.find((x) => x.id === tableId);
          if (t) {
            selectedAtRef.current = Date.now();
            setSelected(t);
            setMobileView("catalog");
          }
        }
        await load();
        setMsg(
          action === "seat"
            ? "🪑 Comensales sentados: la mesa está ocupada"
            : action === "absent"
              ? "Reserva marcada como ausente"
              : "Reserva cancelada"
        );
      } else setMsg(data.error || "No se pudo actualizar la reserva");
    } catch {
      setMsg("No se pudo actualizar la reserva");
    } finally {
      setResActing(false);
      setTimeout(() => setMsg(""), 3000);
    }
  }
  // Switch "exigir caja abierta": sin turno no se cobra la mesa (cargar
  // consumiciones sigue permitido; el servidor lo valida igual: 409).
  const { shift: cashShift, requireOpenShift, loading: cashShiftLoading } = useCashShift(true);
  const shiftBlocked = requireOpenShift && !cashShiftLoading && !cashShift;
  const [cart, setCart] = useState<{ product_id: string; name: string; price: number; qty: number; requires_prep: boolean; modifiers?: CartModifier[]; packSize?: number; manual?: boolean }[]>([]);
  // Cargo manual ("Varios"): línea sin producto (igual que en Mostrador).
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  function addManualLine() {
    const name = manualName.trim() || "Varios";
    const price = Math.round(Number(manualPrice) * 100) / 100;
    if (!Number.isFinite(price) || price <= 0) {
      setMsg("Ingresá un monto mayor a $0");
      return;
    }
    const pid = `manual:${name}`;
    setCart((prev) => {
      const found = prev.find((i) => i.product_id === pid);
      if (found) return prev.map((i) => (i === found ? { ...i, qty: i.qty + 1 } : i));
      return [{ product_id: pid, name, price, qty: 1, requires_prep: false, manual: true }, ...prev];
    });
    setManualName("");
    setManualPrice("");
    setMsg("");
  }
  const manualChargeRow = (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={manualName}
        onChange={(e) => setManualName(e.target.value)}
        placeholder="Monto manual (ej: Varios)"
        className="flex-1 min-w-0 h-9 px-3 text-xs rounded-lg border border-input bg-background"
      />
      <input
        type="number"
        inputMode="decimal"
        min="0"
        value={manualPrice}
        onChange={(e) => setManualPrice(e.target.value)}
        placeholder="$"
        className="w-20 h-9 px-2 text-xs rounded-lg border border-input bg-background"
      />
      <Button type="button" size="sm" variant="outline" onClick={addManualLine}>
        ＋ Monto
      </Button>
    </div>
  );
  const [modifiersMap, setModifiersMap] = useState<Record<string, ProductModifier[]>>({});
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [payment, setPayment] = useState("efectivo");
  // Mobile: la mesa se divide en 2 pantallas — "catalog" (sticky buscador +
  // pastillas + grilla) y "detail" (cuenta: consumiciones, precuenta, cobro).
  const [mobileView, setMobileView] = useState<"catalog" | "detail">("catalog");
  // Borrador de mesa (24h): mesa + carrito no enviado + pago.
  const [mesaRestored, setMesaRestored] = useState(false);
  const mesaDraftReady = useRef(false);
  type MesaDraft = {
    selectedId: string | null;
    cart: { product_id: string; name: string; price: number; qty: number; requires_prep: boolean; modifiers?: CartModifier[]; packSize?: number; manual?: boolean }[];
    payment: string;
    mobileView: "catalog" | "detail";
  };
  useEffect(() => {
    if (mesaDraftReady.current || !vendorId || tables.length === 0) return;
    mesaDraftReady.current = true;
    try {
      const d = loadDraft<MesaDraft>(vendorId, "mesa");
      if (!d) return;
      if (d.payment) setPayment(d.payment);
      if (d.mobileView === "catalog" || d.mobileView === "detail") setMobileView(d.mobileView);
      if (Array.isArray(d.cart) && d.cart.length > 0) setCart(d.cart);
      if (d.selectedId) {
        const match = tables.find((t) => t.id === d.selectedId);
        if (match) setSelected(match);
      }
      if ((d.cart || []).length > 0 || d.selectedId) setMesaRestored(true);
    } catch { /* borrador corrupto: se ignora */ }
  }, [vendorId, tables]);
  useEffect(() => {
    if (!mesaDraftReady.current || !vendorId) return;
    const t = setTimeout(() => {
      if (cart.length === 0 && !selected) {
        clearDraft(vendorId, "mesa");
        return;
      }
      saveDraft(vendorId, "mesa", {
        selectedId: selected?.id || null,
        cart, payment, mobileView,
      } satisfies MesaDraft);
    }, 400);
    return () => clearTimeout(t);
  }, [cart, selected, payment, mobileView, vendorId]);
  const [printingTicket, setPrintingTicket] = useState(false);
  // % descuento en efectivo del comercio (0 = sin descuento).
  const [cashPct, setCashPct] = useState(0);
  // Ledger offline (F2): consumiciones y cierres guardados sin red,
  // pendientes de sync. Se rehidratan del outbox al montar.
  const [localAdds, setLocalAdds] = useState<LocalAdd[]>([]);
  const [localCloses, setLocalCloses] = useState<LocalClose[]>([]);

  const load = useCallback(async () => {
    // Snapshot local primero (stale-while-revalidate, Track Ventas F1):
    // pinta mesas y catálogo de inmediato; la red refresca después.
    if (vendorId) {
      try {
        const [cat, tab] = await Promise.all([
          getCatalogSnapshot(vendorId),
          getTablesSnapshot(vendorId),
        ]);
        if (cat) {
          setCashPct(cat.cashPct);
          setModifiersMap((cat.modifiersByProduct || {}) as any);
          setProducts(((cat.products || []) as any[])
            .filter((x: any) => x.available !== false)
            .map((x: any) => ({ ...x })));
        }
        if (tab) {
          if (Array.isArray(tab.tables)) setTables(applyLayoutFallback(tab.tables as any, vendorId));
          if (Array.isArray(tab.orders)) setOrders(tab.orders as any);
          if (typeof tab.cashPct === "number") setCashPct(tab.cashPct);
        }
      } catch { /* sin snapshot: espera a la red */ }
    }
    // Timeout: si la red queda colgada (p. ej. conexión móvil suspendida),
    // mostramos error con reintento en lugar de un spinner/"Cargando" eterno.
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 8000);
    try {
      const [tRes, oRes, pRes, mRes, rRes, dRes] = await Promise.all([
        fetch("/api/vendor/tables", { signal: ac.signal }),
        fetch("/api/vendor/orders", { signal: ac.signal }),
        fetch("/api/vendor/offers", { signal: ac.signal }),
        fetch("/api/vendor/me", { signal: ac.signal }),
        fetch("/api/vendor/reservations?status=pendiente", { signal: ac.signal }).catch(() => null),
        fetch("/api/vendor/floor-decor", { signal: ac.signal }).catch(() => null),
      ]);
      const t = await tRes.json();
      const o = await oRes.json();
      const p = await pRes.json();
      const me = await mRes.json().catch(() => null);
      const r = rRes ? await rRes.json().catch(() => null) : null;
      const d = dRes ? await dRes.json().catch(() => null) : null;
      if (r && Array.isArray(r.reservations)) setReservations(r.reservations);
      if (d && Array.isArray(d.decor)) setDecor(d.decor);
      if (me?.vendor && typeof (me.vendor as any).floor_bg_url !== "undefined") {
        setFloorBg((me.vendor as any).floor_bg_url ?? null);
      }
      if (r && r.config) {
        setResConfig(r.config);
        if (r.config.lead_min != null) setResLeadInput(String(r.config.lead_min));
        if (r.config.tolerance_min != null) setResTolInput(String(r.config.tolerance_min));
      }
      const pct = normalizeCashPct(me?.vendor?.cash_discount_pct);
      if (me?.vendor) setCashPct(pct);
      if (t.tables) setTables(applyLayoutFallback(t.tables, (me?.vendor?.id as string | undefined) ?? vendorId));
      if (o.orders) setOrders(o.orders);
      let modsMap: Record<string, ProductModifier[]> = {};
      let mapped: Product[] = [];
      if (p.offers) {
        modsMap = p.modifiersByProduct || {};
        setModifiersMap(modsMap);
        mapped = (p.offers || [])
          .filter((x: any) => x.available !== false)
          .map((x: any) => ({ ...x, modifiers: modsMap[x.id] || [] }));
        setProducts(mapped);
      }
      // Snapshots para operar offline (fire-and-forget).
      const vid = vendorId || (me?.vendor?.id as string | undefined) || null;
      if (vid) {
        saveCatalogSnapshot(vid, {
          products: mapped,
          categories: [],
          modifiersByProduct: modsMap,
          cashPct: pct,
          vertical: (me?.vendor?.vertical as string | undefined) ?? null,
        }).catch(() => {});
        if (t.tables || o.orders) {
          saveTablesSnapshot(vid, {
            tables: t.tables || [],
            orders: o.orders || [],
            cashPct: pct,
          }).catch(() => {});
        }
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || resSaving) return;
      if (resModal) setResModal(null);
      else if (selected) setSelected(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, resModal, resSaving]);

  // Al sincronizar (F3): se descartan las consumiciones/cierres ya enviados
  // y se refresca la cuenta real del servidor (con Nros. y totales finales).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail as { syncedLocalIds?: string[] } | undefined;
      const ids = detail?.syncedLocalIds;
      if (!ids || ids.length === 0) return;
      const set = new Set(ids);
      setLocalAdds((prev) => prev.filter((a) => !set.has(a.localId)));
      setLocalCloses((prev) => prev.filter((c) => !set.has(c.localId)));
      load().catch(() => {});
    };
    window.addEventListener(SYNC_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(SYNC_COMPLETED_EVENT, handler);
  }, [load]);

  // Rehidratar ledger offline desde el outbox (sobrevive reload sin red).
  useEffect(() => {
    if (!vendorId) return;
    outboxList(vendorId, "mesas")
      .then((actions) => {
        const adds: LocalAdd[] = [];
        const closes: LocalClose[] = [];
        for (const a of actions) {
          if (!a.localId) continue;
          if (a.type === "consumicion") {
            adds.push({
              localId: a.localId,
              clientKey: String(a.payload.client_key || ""),
              tableId: String(a.payload.tableId || ""),
              items: Array.isArray(a.payload.items) ? a.payload.items : [],
              total: Number(a.payload.total) || 0,
              payment: String(a.payload.paymentMethod || "efectivo"),
              createdAt: a.createdAt,
              provisional: Number((a.payload as any).__provisional) || 0,
            });
          } else if (a.type === "table_close") {
            closes.push({
              localId: a.localId,
              clientKey: String(a.payload.client_key || ""),
              tableId: String(a.payload.tableId || ""),
              tableName: String((a.payload as any).tableName || "Mesa"),
              total: Number((a.payload as any).__closeTotal) || 0,
              estimated: true,
              createdAt: a.createdAt,
              provisional: Number((a.payload as any).__provisional) || 0,
            });
          }
        }
        if (adds.length > 0) setLocalAdds(adds);
        if (closes.length > 0) setLocalCloses(closes);
      })
      .catch(() => {});
  }, [vendorId]);

  // Cuenta activa: solo consumiciones en curso (no liquidadas ni canceladas).
  // Al cerrar la mesa esas pasan a 'completed' (comprobante histórico) y dejan
  // de sumar al reabrir: reabrir siempre arranca en cero (modelo "cuenta abierta").
  const openOrders = useMemo(
    () =>
      selected
        ? orders.filter(
            (o) => o.table_id === selected.id && o.status !== "cancelled" && o.status !== "completed"
          )
        : [],
    [orders, selected]
  );
  const closedOrders = useMemo(
    () =>
      selected
        ? orders.filter((o) => o.table_id === selected.id && o.status === "completed")
        : [],
    [orders, selected]
  );
  const selectedTotal = openOrders.reduce((s, o) => s + Number(o.total), 0);

  // Ledger offline de la mesa seleccionada (F2).
  const tableAdds = useMemo(
    () => (selected ? localAdds.filter((a) => a.tableId === selected.id) : []),
    [localAdds, selected]
  );
  const tableCloses = useMemo(
    () => (selected ? localCloses.filter((c) => c.tableId === selected.id) : []),
    [localCloses, selected]
  );
  const localAddsTotal = tableAdds.reduce((s, a) => s + Number(a.total), 0);
  /** La mesa tiene cuenta (servidor o pendiente offline). */
  const hasAccount = openOrders.length > 0 || cart.length > 0 || tableAdds.length > 0;

  // Descuento en efectivo de la mesa (misma fórmula que el servidor):
  // ítems de las consumiciones abiertas + lo pendiente de cargar.
  const productCashFlags = useMemo(
    () =>
      new Map(
        products.map((p) => [
          p.id,
          { hasPromo: p.promo_price != null, excluded: p.cash_discount_excluded === true },
        ])
      ),
    [products]
  );
  const mesaCash = useMemo(() => {
    const lines = [
      ...openOrders.flatMap((o) => o.items || []),
      ...cart,
      // Consumiciones offline pendientes: entran al estimado de efectivo.
      ...tableAdds.flatMap((a) => a.items || []),
    ];
    return cashDiscountForItems(
      lines.map((i: any) => {
        const info = i.product_id ? productCashFlags.get(i.product_id) : undefined;
        // Pack-aware: carrito (packSize, price por unidad full-precision) y
        // órdenes persistidas (pack_size, price = precio del paquete).
        const pack = Math.floor(Number(i.pack_size ?? i.packSize ?? 0));
        if (pack >= 2) {
          const isDbItem = i.pack_size != null;
          return {
            unitPrice: isDbItem ? Number(i.price) : Number(i.price) * pack,
            qty: Number(i.qty) / pack,
            hasPromo: info?.hasPromo ?? false,
            excluded: info?.excluded ?? null,
          };
        }
        return { unitPrice: Number(i.price), qty: Number(i.qty), hasPromo: info?.hasPromo ?? false, excluded: info?.excluded ?? null };
      }),
      cashPct
    );
  }, [openOrders, cart, tableAdds, cashPct, productCashFlags]);

  // Chips de categoría agrupados por clave normalizada (trim+lowercase):
  // "Pizzas", "pizzas" o " Pizzas" forman un solo chip (igual que el micrositio).
  const normCat = (s: string | null | undefined) => (s || "").trim().toLowerCase();

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) &&
        (!activeCat || normCat(p.category) === activeCat)
    );
  }, [products, query, activeCat]);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => {
      if (p.category && p.category.trim()) {
        const key = normCat(p.category);
        if (!map.has(key)) map.set(key, p.category.trim());
      }
    });
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "es"))
      .map(([key, label]) => ({ key, label }));
  }, [products]);

  async function addTable() {
    if (!newTable.trim()) return;
    const res = await fetch("/api/vendor/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTable.trim() }),
    });
    const data = await res.json();
    if (data.table) {
      setTables((prev) => [...prev, data.table]);
      setNewTable("");
      setMsg(`Mesa ${data.table.name} creada`);
    } else setMsg(data.error || "No se pudo crear la mesa");
    setTimeout(() => setMsg(""), 2500);
  }

  async function renameTable(t: Table) {
    const name = renameValue.trim();
    if (!name) return;
    const res = await fetch(`/api/vendor/tables/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.table) setTables((prev) => prev.map((x) => (x.id === t.id ? data.table : x)));
    setRenaming(null);
  }

  async function deleteTable(t: Table) {
    if (!confirm(`¿Eliminar la mesa ${t.name}?`)) return;
    const res = await fetch(`/api/vendor/tables/${t.id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      setTables((prev) => prev.filter((x) => x.id !== t.id));
      setMsg(`Mesa ${t.name} eliminada`);
    } else setMsg(data.error || "No se pudo eliminar");
    setTimeout(() => setMsg(""), 2500);
  }

  function saveLayoutFallback(id: string, patch: Record<string, number | string>) {
    try {
      const key = `portal659-floorplan-${vendorId}`;
      const raw = localStorage.getItem(key);
      const all = raw ? JSON.parse(raw) : {};
      all[id] = { ...all[id], ...patch };
      localStorage.setItem(key, JSON.stringify(all));
    } catch { /* localStorage no disponible */ }
  }

  function loadLayoutFallback(vid?: string | null): Record<string, { x?: number; y?: number; width?: number; height?: number; shape?: string; capacity?: number }> {
    try {
      const key = `portal659-floorplan-${vid || vendorId}`;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  // Si la migración del plano aún no está aplicada, el servidor devuelve las
  // mesas sin x/y/width/height/shape: se completa con el fallback local para
  // no perder la disposición editada.
  function applyLayoutFallback(list: Table[], vid?: string | null): Table[] {
    const fb = loadLayoutFallback(vid);
    if (Object.keys(fb).length === 0) return list;
    return list.map((t) => {
      const f = fb[t.id];
      if (!f) return t;
      return {
        ...t,
        x: (t as any).x ?? f.x ?? 0,
        y: (t as any).y ?? f.y ?? 0,
        width: (t as any).width ?? f.width ?? 60,
        height: (t as any).height ?? f.height ?? 60,
        shape: (t as any).shape ?? (f.shape as any) ?? "square",
        capacity: f.capacity ?? t.capacity,
      };
    });
  }

  async function moveTable(id: string, x: number, y: number) {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, x, y } : t)));
    const res = await fetch(`/api/vendor/tables/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    }).catch(() => null);
    if (!res || !res.ok) saveLayoutFallback(id, { x, y });
  }

  async function resizeTable(id: string, width: number, height: number) {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, width, height } : t)));
    const res = await fetch(`/api/vendor/tables/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ width, height }),
    }).catch(() => null);
    if (!res || !res.ok) saveLayoutFallback(id, { width, height });
  }

  async function changeTableShape(id: string, shape: "square" | "round" | "rectangle") {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, shape } : t)));
    const res = await fetch(`/api/vendor/tables/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shape }),
    }).catch(() => null);
    if (!res || !res.ok) saveLayoutFallback(id, { shape });
  }

  // Decoración del salón (paredes, etiquetas, zonas): dibujan el local
  // debajo de las mesas. El fondo es una foto/croquis opcional.
  const [decor, setDecor] = useState<FloorDecor[]>([]);
  const [floorBg, setFloorBg] = useState<string | null>(null);
  const [bgUploading, setBgUploading] = useState(false);
  async function decorAdd(kind: FloorDecor["kind"], partial: Partial<FloorDecor>) {
    const tempId = `tmp-${Date.now()}`;
    const optimistic: FloorDecor = {
      id: tempId,
      kind,
      x: partial.x ?? 0,
      y: partial.y ?? 0,
      w: partial.w ?? 60,
      h: partial.h ?? 60,
      rotation: partial.rotation ?? 0,
      text: partial.text ?? null,
    };
    setDecor((prev) => [...prev, optimistic]);
    try {
      const res = await fetch("/api/vendor/floor-decor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...partial }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.decor?.id) {
        setDecor((prev) => prev.map((d) => (d.id === tempId ? data.decor : d)));
      } else {
        setDecor((prev) => prev.filter((d) => d.id !== tempId));
        setMsg(data.code === "migration_pending"
          ? "Falta aplicar la migración de decoración en el servidor"
          : data.error || "No se pudo agregar");
        setTimeout(() => setMsg(""), 2500);
      }
    } catch {
      setDecor((prev) => prev.filter((d) => d.id !== tempId));
    }
  }
  async function decorPatch(id: string, patch: Record<string, number | string | null>) {
    setDecor((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } as FloorDecor : d)));
    try {
      await fetch(`/api/vendor/floor-decor/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => null);
    } catch { /* best-effort: el estado local ya se movió */ }
  }
  const decorMove = (id: string, x: number, y: number) => decorPatch(id, { x, y });
  const decorResize = (id: string, w: number, h: number) => decorPatch(id, { w, h });
  const decorText = (id: string, text: string) => decorPatch(id, { text });
  async function decorDelete(id: string) {
    if (!id.startsWith("tmp-") && !confirm("¿Eliminar este elemento del plano?")) return;
    setDecor((prev) => prev.filter((d) => d.id !== id));
    try {
      await fetch(`/api/vendor/floor-decor/${id}`, { method: "DELETE" }).catch(() => null);
    } catch { /* best-effort */ }
  }
  async function uploadFloorBg(file: File) {
    if (bgUploading) return;
    setBgUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "floor");
      const up = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!upData.url) {
        setMsg(upData.error || "No se pudo subir la imagen");
        return;
      }
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floor_bg_url: upData.url }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.vendor) {
        setFloorBg((data.vendor as any).floor_bg_url ?? null);
        setMsg("🖼 Fondo del plano guardado");
      } else setMsg(data.error || "No se pudo guardar el fondo");
    } catch {
      setMsg("No se pudo subir la imagen");
    } finally {
      setBgUploading(false);
      setTimeout(() => setMsg(""), 2500);
    }
  }
  async function clearFloorBg() {
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floor_bg_url: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.vendor) {
        setFloorBg(null);
        setMsg("Fondo del plano quitado");
      } else setMsg(data.error || "No se pudo quitar el fondo");
    } catch {
      setMsg("No se pudo quitar el fondo");
    } finally {
      setTimeout(() => setMsg(""), 2500);
    }
  }

  async function changeTableCapacity(id: string, capacity: number) {
    const cap = Math.max(1, Math.min(30, Math.round(capacity) || 4));
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, capacity: cap } : t)));
    const res = await fetch(`/api/vendor/tables/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: cap }),
    }).catch(() => null);
    if (!res || !res.ok) saveLayoutFallback(id, { capacity: cap });
  }

  // Guardia anti tap-through (mobile): al abrir la mesa con un tap, el
  // click sintético al soltar el dedo puede caer sobre un producto del modal
  // recién abierto. Se ignoran agregados en los primeros 400ms tras abrir.
  const selectedAtRef = useRef(0);
  function addProduct(p: Product) {
    if (Date.now() - selectedAtRef.current < 400) return;
    const mods = modifiersMap[p.id] || [];
    if (mods.length > 0) {
      setPickerProduct(p);
      return;
    }
    addLine(p, unitPriceOf(p), []);
  }

  function addLine(p: Product, unitPrice: number, modifiers?: CartModifier[]) {
    const pk = packOf(p);
    setCart((prev) => {
      const key = `${p.id}|${(modifiers || []).map((m) => m.label).sort().join(",")}`;
      const found = prev.find((i) => `${i.product_id}|${(i.modifiers || []).map((m) => m.label).sort().join(",")}` === key);
      if (found) return prev.map((i) => (i === found ? { ...i, qty: i.qty + pk } : i));
      return [{ product_id: p.id, name: p.name, price: unitPrice, qty: pk, requires_prep: p.requires_prep !== false, modifiers, packSize: pk > 1 ? pk : undefined }, ...prev];
    });
  }

  function handleModConfirm(selected: CartModifier[], finalPrice: number) {
    if (pickerProduct) addLine(pickerProduct, finalPrice, selected);
    setPickerProduct(null);
  }

  // +/- en la lista del pedido de la mesa; llegar a 0 elimina la línea.
  // Con pack, el paso es de a N (i.packSize).
  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => (i.product_id === productId ? { ...i, qty: i.qty + delta * (i.packSize || 1) } : i))
        .filter((i) => i.qty > 0)
    );
  }

  const cartLine = (i: (typeof cart)[number]) => {
    // Pack-aware: i.price es unidad full-precision → la línea cierra en el
    // precio del paquete (round2 final; nunca suma de unidades redondeadas).
    const pk = i.packSize && i.packSize >= 2 ? i.packSize : 1;
    const lineTotal = Math.round(i.price * i.qty * 100) / 100;
    const modLabels = (i.modifiers || []).map((m) => m.label).filter(Boolean);
    return (
      <div key={`${i.product_id}|${modLabels.join(",")}`} className="flex items-center gap-2 text-xs">
        <span className="flex-1 min-w-0">
          <span className="line-clamp-2 break-words">
            {i.name}
            {pk > 1 && <span className="ml-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0 text-[9px] font-semibold text-emerald-700 whitespace-nowrap">pack x{pk}</span>}
          </span>
          {modLabels.length > 0 && (
            <span className="block text-[10px] text-muted-foreground truncate">({modLabels.join(", ")})</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => changeQty(i.product_id, -1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">−</button>
          <span className="w-5 text-center tabular-nums">{i.qty}</span>
          <button type="button" onClick={() => changeQty(i.product_id, 1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">+</button>
        </div>
        <span className="w-14 text-right tabular-nums">${lineTotal.toLocaleString("es-AR")}</span>
      </div>
    );
  };

  async function addConsumicion() {
    if (!selected || cart.length === 0) return;
    // El client_key viaja SIEMPRE (Fase 0): un timeout con reintento no
    // duplica gracias a la idempotencia del servidor.
    const payload = {
      tableId: selected.id,
      items: cart.map((i) => ({ ...i, modifiers: (i.modifiers || []).map((m) => m.label) })),
      total: cart.reduce((s, i) => s + i.price * i.qty, 0),
      paymentMethod: payment,
      client_key: newClientKey(),
      occurred_at: new Date().toISOString(),
    };

    const goOfflineAdd = async () => {
      if (!vendorId || !selected) {
        setMsg("Sin conexión y sin contexto del comercio: no se puede guardar");
        return;
      }
      // Gate F4: operar offline exige plan verificado dentro del grace period.
      const gateAdd = await checkOfflineAllowed(vendorId);
      if (!gateAdd.allowed) {
        setMsg(offlineDeniedMsg(gateAdd));
        return;
      }
      const tableId = selected.id;
      const tableName = selected.name;
      const needsKitchen = cart.some((i) => i.requires_prep !== false);
      const prov = nextProvisionalNumber(vendorId);
      (payload as any).__provisional = prov;
      const localId = await enqueueOfflineAction({
        vendorId,
        scope: "mesas",
        type: "consumicion",
        payload,
        print: needsKitchen
          ? {
              doc: "comanda",
              payload: { items: payload.items, tableName },
            }
          : undefined,
      });
      // Comanda local inmediata (F1 impresión): si hay listener en este
      // equipo sale ya; si no, queda en cola para reimpresión manual.
      if (needsKitchen) {
        const r = await dispatchOfflinePrint(vendorId, {
          kind: "COMANDA",
          provisional: prov,
          tableName,
          items: toContingencyItems(payload.items as any[]),
          total: Number(payload.total) || 0,
          createdAt: Date.now(),
        }).catch(() => ({ printed: false as const }));
        if (r.printed) await markPrintsDone(vendorId, localId).catch(() => {});
      }
      setLocalAdds((prev) => [
        ...prev,
        {
          localId,
          clientKey: payload.client_key,
          tableId,
          items: cart.map((i) => ({ ...i })),
          total: payload.total,
          payment,
          createdAt: Date.now(),
          provisional: prov,
        },
      ]);
      setTables((prev) => prev.map((x) => (x.id === tableId ? { ...x, status: "ocupada" } : x)));
      setCart([]);
      setMsg(`📡 Consumición P-${prov} guardada en ${tableName}, se envía al reconectar`);
      setTimeout(() => setMsg(""), 2500);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await goOfflineAdd();
      return;
    }
    let res: Response;
    try {
      res = await fetch("/api/vendor/pos/consumicion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      if (isNetworkError(e)) {
        await goOfflineAdd();
        return;
      }
      setMsg("No se pudo cargar");
      setTimeout(() => setMsg(""), 2500);
      return;
    }
    const data = await res.json();
    if (data.ok) {
      if (data.table?.status === "ocupada") {
        setTables((prev) => prev.map((x) => (x.id === selected.id ? { ...x, status: "ocupada" } : x)));
      }
      setCart([]);
      await load();
      setMsg(`Consumición cargada en ${selected.name}`);
    } else setMsg(data.error || "No se pudo cargar");
    setTimeout(() => setMsg(""), 2500);
  }

  async function closeTable() {
    if (!selected) return;
    const tableId = selected.id;
    const tableName = selected.name;
    const adds = localAdds.filter((a) => a.tableId === tableId);
    // Si hay carrito sin cargar, primero se encola como consumición (el sync
    // FIFO la aplica antes del cierre). Online el carrito no entra al cierre
    // (comportamiento actual, no se toca).
    const cartPayload =
      cart.length > 0
        ? {
            tableId,
            items: cart.map((i) => ({ ...i, modifiers: (i.modifiers || []).map((m) => m.label) })),
            total: cart.reduce((s, i) => s + i.price * i.qty, 0),
            paymentMethod: payment,
            client_key: newClientKey(),
            occurred_at: new Date().toISOString(),
          }
        : null;
    const expected_keys = [
      ...adds.map((a) => a.clientKey),
      ...(cartPayload ? [cartPayload.client_key as string] : []),
    ];
    const payload = {
      paymentMethod: payment,
      client_key: newClientKey(),
      occurred_at: new Date().toISOString(),
      expected_keys,
      // Meta solo-cliente (el servidor la ignora): permite rehidratar el
      // ledger tras un reload sin red.
      tableId,
      tableName,
    };

    const goOfflineClose = async () => {
      if (!vendorId) {
        setMsg("Sin conexión y sin contexto del comercio: no se puede guardar");
        return;
      }
      // Gate F4: operar offline exige plan verificado dentro del grace period.
      const gateClose = await checkOfflineAllowed(vendorId);
      if (!gateClose.allowed) {
        setMsg(offlineDeniedMsg(gateClose));
        return;
      }
      const prov = nextProvisionalNumber(vendorId);
      (payload as any).__provisional = prov;
      (payload as any).__closeTotal = Math.max(
        0,
        Math.round((selectedTotal + cartTotal + localAddsTotal - (payment === "efectivo" ? mesaCash.cashDiscount : 0)) * 100) / 100
      );
      if (cartPayload) {
        const cartProv = nextProvisionalNumber(vendorId);
        (cartPayload as any).__provisional = cartProv;
        const cartLocalId = await enqueueOfflineAction({
          vendorId,
          scope: "mesas",
          type: "consumicion",
          payload: cartPayload,
        });
        setLocalAdds((prev) => [
          ...prev,
          {
            localId: cartLocalId,
            clientKey: cartPayload.client_key as string,
            tableId,
            items: cart.map((i) => ({ ...i })),
            total: cartPayload.total as number,
            payment,
            createdAt: Date.now(),
            provisional: cartProv,
          },
        ]);
      }
      const localId = await enqueueOfflineAction({
        vendorId,
        scope: "mesas",
        type: "table_close",
        payload,
      });
      const closeTotal = (payload as any).__closeTotal as number;
      // Efecto local: la mesa queda libre y su cuenta como cerrada pendiente.
      // Al sincronizar, el servidor valida expected_keys (Fase 0) y cierra.
      setTables((prev) => prev.map((x) => (x.id === tableId ? { ...x, status: "libre" } : x)));
      setLocalAdds((prev) => prev.filter((a) => a.tableId !== tableId));
      setLocalCloses((prev) => [
        ...prev,
        {
          localId,
          clientKey: payload.client_key as string,
          tableId,
          tableName,
          total: closeTotal,
          estimated: true,
          createdAt: Date.now(),
          provisional: prov,
        },
      ]);
      setSelected(null);
      setCart([]);
      setMsg(`📡 ${tableName} cobrada ($${closeTotal.toLocaleString("es-AR")}, estimado) — se sincroniza al reconectar`);
      setTimeout(() => setMsg(""), 3000);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await goOfflineClose();
      return;
    }
    // Con consumiciones pendientes offline, el cierre online directo las
    // dejaría afuera (el servidor solo ve lo suyo) y al sincronizar
    // reabrirían la mesa como cuenta fantasma. Se encola el cierre con
    // expected_keys: online se sincroniza al instante por el trigger.
    if (adds.length > 0) {
      await goOfflineClose();
      return;
    }
    let res: Response;
    try {
      res = await fetch(`/api/vendor/tables/${tableId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: payment }),
      });
    } catch (e) {
      if (isNetworkError(e)) {
        await goOfflineClose();
        return;
      }
      setMsg("No se pudo cerrar la mesa");
      setTimeout(() => setMsg(""), 3000);
      return;
    }
    const data = await res.json();
    if (data.ok) {
      setTables((prev) => prev.map((x) => (x.id === tableId ? { ...x, status: "libre" } : x)));
      setSelected(null);
      setCart([]);
      await load();
      setMsg(
        `Mesa cobrada: $${Number(data.total).toLocaleString("es-AR")}` +
        (Number(data.cashDiscount) > 0
          ? ` (desc. efectivo −$${Number(data.cashDiscount).toLocaleString("es-AR")})`
          : "")
      );
    } else setMsg(data.error || "No se pudo cerrar la mesa");
    setTimeout(() => setMsg(""), 3000);
  }

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  // El total en vivo incluye consumiciones offline pendientes (estimado).
  const mesaTotalNotDiscounted = selectedTotal + cartTotal + localAddsTotal;
  // Con efectivo se cobra el total con descuento; con otros medios, el pleno.
  const mesaPayTotal = Math.max(0, Math.round((mesaTotalNotDiscounted - (payment === "efectivo" ? mesaCash.cashDiscount : 0)) * 100) / 100);

  // Precuenta de la mesa (ticket térmico, sin cerrar): incluye lo ya cargado
  // más el carrito pendiente. No cierra ni cobra.
  async function printPrecuenta() {
    if (!selected || !hasAccount) return;
    // Offline (F1 impresión): precuenta de contingencia por listener local
    // (agente PC / app Android en este equipo). No se encola: es reimprimible.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (!vendorId) {
        setMsg("Sin contexto del comercio para imprimir");
        return;
      }
      const tableName = selected.name;
      setPrintingTicket(true);
      try {
        const contItems = [
          ...toContingencyItems(openOrders.flatMap((o) => (o.items || []))),
          ...toContingencyItems(tableAdds.flatMap((a) => (a.items || []))),
          ...toContingencyItems(cart),
        ];
        const r = await dispatchOfflinePrint(vendorId, {
          kind: "PRECUENTA",
          tableName,
          items: contItems,
          total: mesaTotalNotDiscounted,
          paymentLabel: PAYMENT_LABELS[payment] ?? payment,
          cashPct: mesaCash.cashDiscount > 0 ? mesaCash.cashPct : 0,
          cashTotal:
            mesaCash.cashDiscount > 0 ? Math.max(0, mesaTotalNotDiscounted - mesaCash.cashDiscount) : 0,
          createdAt: Date.now(),
        });
        setMsg(
          r.printed
            ? "🖨️ Precuenta provisoria impresa local"
            : `No se pudo imprimir local (${r.error || "sin listener"}): la cuenta sigue en pantalla`
        );
      } catch {
        setMsg("No se pudo imprimir la precuenta sin conexión");
      } finally {
        setPrintingTicket(false);
        setTimeout(() => setMsg(""), 3000);
      }
      return;
    }
    const items = [
      ...openOrders.flatMap((o) => (o.items || [])),
      // Consumiciones offline: normalizar modificadores a labels (vienen
      // como objetos del carrito; el motor térmico espera strings).
      ...tableAdds.flatMap((a) =>
        (a.items || []).map((i: any) => ({
          name: i.name,
          price: i.price,
          qty: i.qty,
          modifiers: Array.isArray(i.modifiers)
            ? i.modifiers.map((m: any) => (typeof m === "string" ? m : String(m?.label || ""))).filter(Boolean)
            : [],
        }))
      ),
      ...cart.map((i) => ({
        name: i.name,
        price: i.price,
        qty: i.qty,
        modifiers: (i.modifiers || []).map((m) => m.label),
      })),
    ];
    setPrintingTicket(true);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "precuenta",
          tableName: selected.name,
          items,
          total: mesaTotalNotDiscounted,
          // Info de efectivo para el ticket: "Efectivo (-X%): $Y".
          cashPct: mesaCash.cashDiscount > 0 ? mesaCash.cashPct : 0,
          cashTotal: mesaCash.cashDiscount > 0 ? Math.max(0, mesaTotalNotDiscounted - mesaCash.cashDiscount) : 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) setMsg("🖨️ Precuenta enviada a la impresora");
      else setMsg(data.reason || data.error || "No se pudo imprimir la precuenta");
    } catch {
      setMsg("Error de conexión al imprimir");
    } finally {
      setPrintingTicket(false);
      setTimeout(() => setMsg(""), 3000);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando mesas...</p>;

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">No se pudieron cargar las mesas. Revisá tu conexión.</p>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }}>
          Reintentar
        </Button>
      </div>
    );
  }

  // Catálogo compartido: buscador + pastillas + grilla de productos.
  // Desktop: mismo patrón que Mostrador (grilla en flujo de página, scrollea la página).
  const catalogBlock = (gridClass: string) => (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar y agregar producto..."
          className="flex-1 h-10 px-3 text-sm rounded-xl border border-input bg-background"
        />
        {cartCount > 0 && (
          <Badge className="h-10 px-3 text-xs tabular-nums">🛒 {cartCount}</Badge>
        )}
      </div>
      {categories.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setActiveCat(null)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeCat === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            Todos
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              onClick={() => setActiveCat(activeCat === c.key ? null : c.key)}
              className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                activeCat === c.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${gridClass}`}>
        {filtered.map((p) => (
          <ProductPickCard
            key={p.id}
            product={p}
            hasModifiers={(modifiersMap[p.id] || []).length > 0}
            onAdd={() => addProduct(p)}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-[11px] text-muted-foreground col-span-full text-center py-4">Sin productos</p>
        )}
      </div>
    </div>
  );

  const consumicionesBlock = (compact: boolean) => (
    <div className={`space-y-2 ${compact ? "" : ""}`}>
      {openOrders.map((o) => (
        <div key={o.id} className="rounded-xl bg-muted/50 p-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              {new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {o.pickup_number != null ? `Nro. ${o.pickup_number}` : `#${o.id.slice(0, 6)}`}
            </span>
            <span className="font-semibold tabular-nums">${Number(o.total).toLocaleString("es-AR")}</span>
          </div>
          <div className="text-xs space-y-0.5">
            {(o.items || []).map((i, idx) => (
              <p key={idx} className="text-muted-foreground">
                {i.qty}x {i.name}
                {i.modifiers && i.modifiers.length > 0 && <span className="text-red-500"> ({i.modifiers.join(", ")})</span>}
              </p>
            ))}
          </div>
        </div>
      ))}
      {openOrders.length === 0 && selected?.status === "ocupada" && tableAdds.length === 0 && (
        <p className="text-xs text-muted-foreground">Mesa ocupada sin consumiciones registradas.</p>
      )}
      {/* Consumiciones offline pendientes de sync (F2). */}
      {tableAdds.map((a) => (
        <div key={a.localId} className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/20">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              {new Date(a.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · P-{a.provisional} · 📡 pendiente
            </span>
            <span className="font-semibold tabular-nums">${Number(a.total).toLocaleString("es-AR")}</span>
          </div>
          <div className="text-xs space-y-0.5">
            {(a.items || []).map((i, idx) => (
              <p key={idx} className="text-muted-foreground">
                {i.qty}x {i.name}
                {(i.modifiers || []).length > 0 && (
                  <span className="text-red-500"> ({(i.modifiers || []).map((m) => m.label).join(", ")})</span>
                )}
              </p>
            ))}
          </div>
        </div>
      ))}
      {/* Cierres offline pendientes de sync (F2). */}
      {tableCloses.map((c) => (
        <div key={c.localId} className="flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs dark:bg-amber-950/20">
          <span className="text-muted-foreground">📡 Cierre P-{c.provisional} de {c.tableName} · pendiente de sync</span>
          <span className="font-semibold tabular-nums shrink-0">${Number(c.total).toLocaleString("es-AR")} (est.)</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {mesaRestored && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-xs font-medium text-primary">Recuperamos la mesa en curso</p>
          <button
            type="button"
            onClick={() => {
              clearDraft(vendorId, "mesa");
              setCart([]);
              setSelected(null);
              setMesaRestored(false);
            }}
            className="text-xs font-medium text-muted-foreground hover:text-foreground underline flex-shrink-0"
          >
            Descartar
          </button>
        </div>
      )}
      {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}

      {!selected ? (
        <>
          {/* ============ Pantalla plano / grilla ============ */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTable}
              onChange={(e) => setNewTable(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTable()}
              placeholder="Nombre de mesa nueva (ej: Mesa 1)..."
              className="flex-1 h-10 px-3 text-sm rounded-xl border border-input bg-background"
            />
            <Button onClick={addTable}>Agregar</Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex rounded-full bg-muted p-0.5 text-xs font-medium">
              {(["plano", "grilla"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => changePlanView(v)}
                  className={`rounded-full px-3 py-1.5 transition-colors ${
                    planView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {v === "plano" ? "🗺️ Plano" : "🔲 Grilla"}
                </button>
              ))}
            </div>
            {planView === "grilla" && (
              <Button size="sm" variant="outline" onClick={() => openResModal(null, false)}>
                📅 Reservar
              </Button>
            )}
          </div>

          {planView === "plano" ? (
          <FloorPlan
            tables={tables as FloorTable[]}
            selectedId={null}
            onSelect={(t) => { selectedAtRef.current = Date.now(); setSelected(t as Table); setMobileView("catalog"); }}
        onMove={moveTable}
        onResize={resizeTable}
        onShapeChange={changeTableShape}
        onCapacityChange={changeTableCapacity}
        blockedIds={resOverlays.blocked}
        upcomingIds={resOverlays.upcoming}
        decor={decor}
        bgUrl={floorBg}
        onDecorAdd={decorAdd}
        onDecorMove={decorMove}
        onDecorResize={decorResize}
        onDecorText={decorText}
        onDecorDelete={decorDelete}
        onReserve={() => openResModal(null, false)}
        onDeleteTable={(id) => {
          const t = tables.find((x) => x.id === id);
          if (t) deleteTable(t);
        }}
      />
          ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {tables.map((t) => {
              const blocked = resOverlays.blocked.includes(t.id);
              const upcoming = !blocked && resOverlays.upcoming.includes(t.id);
              const occupied = t.status === "ocupada";
              return (
                <div
                  key={t.id}
                  onClick={() => selectTable(t)}
                  className={`rounded-2xl border-2 p-3 cursor-pointer transition-all active:scale-[0.98] ${
                    occupied || blocked ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <p className="font-display font-semibold text-sm truncate">{t.name}</p>
                    <Badge className={`text-[9px] shrink-0 ${occupied || blocked ? "bg-status-new/15 text-status-new" : "bg-muted text-muted-foreground"}`}>
                      {blocked ? "Reservada" : occupied ? "Ocupada" : "Libre"}{upcoming ? " 🕒" : ""}
                    </Badge>
                  </div>
                  {occupied ? (
                    <p className="text-xs font-semibold tabular-nums">${tableSubtotal(t.id).toLocaleString("es-AR")}</p>
                  ) : blocked ? (
                    <p className="text-[11px] text-muted-foreground">Reservada en este turno</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">hasta {t.capacity} personas{upcoming ? " · 🕒" : ""}</p>
                  )}
                </div>
              );
            })}
            {tables.length === 0 && (
              <p className="text-xs text-muted-foreground col-span-full text-center py-6">
                Todavía no creaste mesas. Agregá la primera arriba.
              </p>
            )}
          </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-3 space-y-2">
            <h3 className="font-display font-semibold text-sm">
              📅 Reservas {reservations.length > 0 && <span className="text-muted-foreground">({reservations.length})</span>}
            </h3>
            {reservations.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin reservas pendientes.</p>
            ) : (
              <div className="space-y-1.5">
                {[...reservations]
                  .sort((a, b) => new Date(a.reserved_at).getTime() - new Date(b.reserved_at).getTime())
                  .map((r) => {
                    const st = reservationTimeState(r, resConfig);
                    const t = r.table_id ? tables.find((x) => x.id === r.table_id) : undefined;
                    return (
                      <div
                        key={r.id}
                        onClick={() => {
                          if (!t) return;
                          selectedAtRef.current = Date.now();
                          setSelected(t);
                          setMobileView("catalog");
                        }}
                        className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-background px-3 py-2 ${t ? "cursor-pointer" : ""}`}
                      >
                        <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                          st === "blocked"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                            : st === "upcoming"
                              ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                              : "bg-muted text-muted-foreground"
                        }`}>
                          {st === "blocked" ? "En turno" : st === "upcoming" ? "Próxima" : "Vencida"}
                        </span>
                        <div className="text-xs min-w-0 flex-1">
                          <p className="font-semibold truncate">
                            {new Date(r.reserved_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {" · "}{r.table_name || t?.name || "mesa eliminada"}
                          </p>
                          <p className="text-muted-foreground truncate">
                            {r.customer_name} · {r.party_size} pers. · 📞 {r.customer_phone}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {t && (
                            <Button size="sm" variant="outline" disabled={resActing} onClick={() => reservationAction(r.id, "seat", r.table_id)}>
                              🪑
                            </Button>
                          )}
                          <Button size="sm" variant="outline" disabled={resActing} onClick={() => reservationAction(r.id, "absent", r.table_id)}>
                            No vino
                          </Button>
                          <Button size="sm" variant="ghost" disabled={resActing} onClick={() => reservationAction(r.id, "cancel", r.table_id)}>
                            ✕
                          </Button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <CollapsibleSection icon="🖼️" title="Fondo del plano" defaultOpen={false}>
            <div className="flex flex-wrap items-center gap-2">
              {floorBg ? (
                <>
                  <ProductImage src={floorBg} name="fondo" alt="Fondo del salón" className="h-16 w-24 rounded-lg border border-border" />
                  <Button size="sm" variant="outline" onClick={clearFloorBg}>Quitar fondo</Button>
                </>
              ) : (
                <label className="text-xs">
                  <span className="inline-block rounded-lg border border-input bg-background px-3 py-2 cursor-pointer hover:bg-accent">
                    {bgUploading ? "Subiendo…" : "📤 Subir foto/croquis del salón"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={bgUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFloorBg(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <p className="w-full text-[11px] text-muted-foreground">
                Opcional, estilo Lightspeed: la foto queda de fondo y las mesas se ubican encima.
              </p>
            </div>
          </CollapsibleSection>

          <CollapsibleSection icon="⚙️" title="Ventana de bloqueo de reservas" defaultOpen={false}>
            <div className="flex flex-wrap items-end gap-2.5">
              <div>
                <label className="text-xs font-medium">Bloquear desde (min antes)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={180}
                  value={resLeadInput}
                  onChange={(e) => setResLeadInput(e.target.value)}
                  className="mt-1 w-24 h-9 px-3 text-sm rounded-xl border border-input bg-background"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Tolerancia llegada (min)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={180}
                  value={resTolInput}
                  onChange={(e) => setResTolInput(e.target.value)}
                  className="mt-1 w-24 h-9 px-3 text-sm rounded-xl border border-input bg-background"
                />
              </div>
              <Button size="sm" disabled={resCfgSaving} onClick={saveResConfig}>
                {resCfgSaving ? "Guardando…" : "Guardar"}
              </Button>
              <p className="w-full text-[11px] text-muted-foreground">
                La mesa se bloquea desde esos minutos antes del turno hasta que pasa la tolerancia. Fuera de ese turno opera normal.
              </p>
            </div>
          </CollapsibleSection>
        </>
      ) : (
        <>
          {/* ============ Pantalla detalle de la mesa ============ */}
          {/* Desktop (sm+): catálogo en flujo + cuenta sticky (igual que Mostrador) */}
          <div className="hidden sm:block">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>← Plano</Button>
                <h3 className="font-display font-semibold truncate">{selected.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                {renaming === selected.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && renameTable(selected)}
                    onBlur={() => setRenaming(null)}
                    className="h-8 px-2 text-xs rounded-lg border border-input bg-background w-32"
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setRenaming(selected.id); setRenameValue(selected.name); }}
                  >
                    Renombrar
                  </Button>
                )}
                {selected.status === "libre" && (
                  <Button variant="outline" size="sm" onClick={() => openResModal(selected.id)}>📅 Reservar</Button>
                )}
              </div>
            </div>

            {resBanner && selectedReservation && (
              <div className={`rounded-xl border ${resBanner.cls} px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2`}>
                <div className="text-xs min-w-0">
                  <p className="font-semibold">{resBanner.title}</p>
                  <p className="text-muted-foreground">
                    {new Date(selectedReservation.reserved_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    {" · "}{selectedReservation.party_size} pers.
                    {" · 📞 "}{selectedReservation.customer_phone}
                    {selectedReservation.notes ? ` · ${selectedReservation.notes}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Button size="sm" disabled={resActing} onClick={() => reservationAction(selectedReservation.id, "seat", selectedReservation.table_id)}>
                    🪑 Sentar
                  </Button>
                  <Button size="sm" variant="outline" disabled={resActing} onClick={() => reservationAction(selectedReservation.id, "absent", selectedReservation.table_id)}>
                    No vino
                  </Button>
                  <Button size="sm" variant="outline" disabled={resActing} onClick={() => reservationAction(selectedReservation.id, "cancel", selectedReservation.table_id)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
              <div className="min-w-0">
                {catalogBlock("xl:grid-cols-4")}
              </div>
              {/* Cuenta sticky con scroll interno */}
              <div className="flex rounded-2xl border border-border bg-card p-4 flex-col gap-2 max-h-[70vh] lg:sticky lg:top-24 lg:h-[calc(100vh-12rem)] lg:max-h-none">
                <h3 className="font-display font-semibold text-sm mb-2 flex-shrink-0">Cuenta · {selected.name}</h3>
                <div className="flex-1 space-y-3 min-h-0 overflow-y-auto">
                  {consumicionesBlock(false)}
                  {cart.length > 0 && (
                    <div className="space-y-1">
                      {cart.map(cartLine)}
                    </div>
                  )}

                  {closedOrders.length > 0 && (
                    <div>
                      <CollapsibleSection icon="🧾" title={`Cuentas cerradas (${closedOrders.length})`} defaultOpen={false}>
                        <div className="space-y-1.5 opacity-70">
                          {closedOrders.map((o) => (
                            <div key={o.id} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                {o.paid_at ? new Date(o.paid_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {o.pickup_number != null ? `Nro. ${o.pickup_number}` : `#${o.id.slice(0, 6)}`}
                              </span>
                              <span className="font-semibold tabular-nums">${Number(o.total).toLocaleString("es-AR")}</span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleSection>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 pt-2 flex-shrink-0">
                  {PAYMENT_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => setPayment(o.key)}
                      className={`rounded-full px-2 py-1 text-[10px] font-medium ${payment === o.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm flex-shrink-0">
                  <span>Total mesa</span>
                  <b className="tabular-nums">${mesaPayTotal.toLocaleString("es-AR")}</b>
                </div>
                {mesaCash.cashDiscount > 0 && (
                  <p className="text-[11px] leading-snug text-green-600 dark:text-green-400 flex-shrink-0">
                    {payment === "efectivo"
                      ? `💵 Desc. efectivo (${mesaCash.cashPct}%) aplicado: −$${mesaCash.cashDiscount.toLocaleString("es-AR")}`
                      : `💵 Pagando en efectivo: $${(mesaTotalNotDiscounted - mesaCash.cashDiscount).toLocaleString("es-AR")} (−${mesaCash.cashPct}%)`}
                  </p>
                )}
                <div className="flex-shrink-0">{manualChargeRow}</div>
                <Button size="sm" className="flex-shrink-0" disabled={cart.length === 0 || resBlocked} onClick={addConsumicion}>Agregar consumición</Button>
                {resBlocked && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 flex-shrink-0">
                    🔒 Mesa reservada en este turno: sentá o cancelá la reserva para operar.
                  </p>
                )}
                {shiftBlocked && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 flex-shrink-0">
                    🔒 Abrí la caja para cobrar.{" "}
                    <button type="button" className="underline font-semibold" onClick={() => window.dispatchEvent(new Event("portal:go-caja"))}>
                      Ir a la caja →
                    </button>
                  </p>
                )}
                <div className="grid grid-cols-2 gap-1.5 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={printingTicket || !hasAccount}
                    onClick={printPrecuenta}
                  >
                    {printingTicket ? "Imprimiendo..." : "🖨️ Precuenta"}
                  </Button>
                  <Button size="sm" variant="default" disabled={!hasAccount || shiftBlocked || resBlocked} onClick={closeTable}>
                    Cobrar y cerrar
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile: modal pantalla completa, 2 vistas */}
          <div className="sm:hidden fixed inset-0 z-[60] bg-background flex flex-col">
            <header className="flex items-center gap-2 border-b border-border px-3 py-3">
              <button
                onClick={() => (mobileView === "detail" ? setMobileView("catalog") : setSelected(null))}
                className="shrink-0 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
                aria-label="Volver"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-semibold leading-tight truncate">
                  {mobileView === "catalog" ? selected.name : `Cuenta · ${selected.name}`}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {selected.status === "ocupada" ? "Ocupada" : selected.status === "reservada" ? "Reservada" : "Libre"} · ${mesaTotalNotDiscounted.toLocaleString("es-AR")}
                </p>
              </div>
              {selected.status === "libre" && (
                <Button variant="outline" size="sm" className="h-8 text-xs shrink-0" onClick={() => openResModal(selected.id)}>📅 Reservar</Button>
              )}
            </header>

            {mobileView === "catalog" ? (
              <>
                {/* Vista A — catálogo: buscador + pastelas STICKY, grilla con espacio */}
                <div className="sticky top-0 z-10 bg-background border-b border-border/50 px-3 pt-2 pb-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Buscar y agregar producto..."
                      className="flex-1 h-10 px-3 text-sm rounded-xl border border-input bg-background"
                    />
                    {cartCount > 0 && (
                      <Badge className="h-10 px-3 text-xs tabular-nums">🛒 {cartCount}</Badge>
                    )}
                  </div>
                  {categories.length > 1 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                      <button
                        onClick={() => setActiveCat(null)}
                        className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          activeCat === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        Todos
                      </button>
                      {categories.map((c) => (
                        <button
                          key={c.key}
                          onClick={() => setActiveCat(activeCat === c.key ? null : c.key)}
                          className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                            activeCat === c.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-3 pt-2pb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {filtered.map((p) => (
                      <ProductPickCard
                        key={p.id}
                        product={p}
                        hasModifiers={(modifiersMap[p.id] || []).length > 0}
                        onAdd={() => addProduct(p)}
                      />
                    ))}
                    {filtered.length === 0 && (
                      <p className="text-[11px] text-muted-foreground col-span-full text-center py-6">Sin productos</p>
                    )}
                  </div>
                </div>

                {/* Barra a la vista "cuenta": resume lo que lleva la mesa */}
                <footer className="border-t border-border px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] bg-card">
                  <button
                    onClick={() => setMobileView("detail")}
                    className="w-full flex items-center justify-between rounded-xl bg-primary text-primary-foreground px-4 py-3 shadow-lg active:scale-[0.98] transition-transform"
                  >
                    <span className="text-sm font-semibold">
                      🧾 Detalle de la mesa
                      {cartCount > 0 && (
                        <span className="ml-1 text-[11px] opacity-90">
                          · {cartCount} sin cargar
                        </span>
                      )}
                    </span>
                    <span className="text-base font-bold tabular-nums">
                      ${mesaTotalNotDiscounted.toLocaleString("es-AR")}
                    </span>
                  </button>
                </footer>
              </>
            ) : (
              <>
                {/* Vista B — cuenta: consumiciones abiertas + pedido nuevo + cobro */}
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                  {resBanner && selectedReservation && (
                    <div className={`rounded-xl border ${resBanner.cls} px-3 py-2.5 space-y-2`}>
                      <p className="text-xs font-semibold">{resBanner.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(selectedReservation.reserved_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {" · "}{selectedReservation.party_size} pers.{" · 📞 "}{selectedReservation.customer_phone}
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        <Button size="sm" disabled={resActing} onClick={() => reservationAction(selectedReservation.id, "seat", selectedReservation.table_id)}>
                          🪑 Sentar
                        </Button>
                        <Button size="sm" variant="outline" disabled={resActing} onClick={() => reservationAction(selectedReservation.id, "absent", selectedReservation.table_id)}>
                          No vino
                        </Button>
                        <Button size="sm" variant="outline" disabled={resActing} onClick={() => reservationAction(selectedReservation.id, "cancel", selectedReservation.table_id)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                      Consumiciones de la mesa ({openOrders.length})
                    </p>
                    {openOrders.length > 0 ? consumicionesBlock(false) : (
                      <p className="text-xs text-muted-foreground">Todavía no se cargaron consumiciones.</p>
                    )}
                  </div>

                  {cart.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                        Por cargar ({cartCount})
                      </p>
                      <div className="space-y-1.5">{cart.map(cartLine)}</div>
                    </div>
                  )}
                  {manualChargeRow}

                  {closedOrders.length > 0 && (
                    <CollapsibleSection icon="🧾" title={`Cuentas cerradas (${closedOrders.length})`} defaultOpen={false}>
                      <div className="space-y-1.5 opacity-70">
                        {closedOrders.map((o) => (
                          <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground min-w-0 truncate">
                          {o.paid_at ? new Date(o.paid_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {o.pickup_number != null ? `Nro. ${o.pickup_number}` : `#${o.id.slice(0, 6)}`}
                            </span>
                            <span className="font-semibold tabular-nums shrink-0">${Number(o.total).toLocaleString("es-AR")}</span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}
                </div>

                <footer className="border-t border-border px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] space-y-2 bg-card">
                  <div className="flex flex-wrap gap-1">
                    {PAYMENT_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        onClick={() => setPayment(o.key)}
                        className={`rounded-full px-2 py-1 text-[10px] font-medium ${payment === o.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>Total a cobrar</span>
                    <b className="tabular-nums">${mesaPayTotal.toLocaleString("es-AR")}</b>
                  </div>
                  {mesaCash.cashDiscount > 0 && (
                    <p className="text-[11px] leading-snug text-green-600 dark:text-green-400">
                      {payment === "efectivo"
                        ? `💵 Desc. efectivo (${mesaCash.cashPct}%) aplicado: −$${mesaCash.cashDiscount.toLocaleString("es-AR")}`
                        : `💵 Pagando en efectivo: $${(mesaTotalNotDiscounted - mesaCash.cashDiscount).toLocaleString("es-AR")} (−${mesaCash.cashPct}%)`}
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-1.5">
                    {resBlocked && (
                      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                        🔒 Mesa reservada en este turno: sentá o cancelá la reserva para operar.
                      </p>
                    )}
                    {cart.length > 0 && (
                      <Button size="sm" variant="secondary" disabled={resBlocked} onClick={addConsumicion}>
                        ➕ Cargar a la mesa ({cartCount} ítem{cartCount === 1 ? "" : "s"})
                      </Button>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={printingTicket || !hasAccount}
                        onClick={printPrecuenta}
                      >
                        {printingTicket ? "Imprimiendo..." : "🖨️ Precuenta"}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!hasAccount || shiftBlocked || resBlocked}
                        onClick={closeTable}
                      >
                        Cobrado y cerrar
                      </Button>
                    </div>
                    {shiftBlocked && (
                      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1.5">
                        🔒 Abrí la caja para cobrar.{" "}
                        <button type="button" className="underline font-semibold" onClick={() => window.dispatchEvent(new Event("portal:go-caja"))}>
                          Ir a la caja →
                        </button>
                      </p>
                    )}
                  </div>
                </footer>
              </>
            )}
          </div>
        </>
      )}

      {resModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={() => !resSaving && setResModal(null)}>
          <div
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border bg-background p-4 space-y-3 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold">
                📅 Reservar {tables.find((t) => t.id === resModal.tableId)?.name ?? "mesa"}
              </h3>
              <button
                type="button"
                onClick={() => !resSaving && setResModal(null)}
                className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2.5">
              {!resModal.lockTable && (
                <div>
                  <label className="text-xs font-medium">Mesa *</label>
                  <select
                    value={resModal.tableId ?? ""}
                    onChange={(e) => {
                      const t = tables.find((x) => x.id === e.target.value);
                      setResModal({ ...resModal, tableId: e.target.value, party: String(t?.capacity || 2) });
                    }}
                    className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                  >
                    <option value="" disabled>Elegí una mesa…</option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.status === "ocupada" ? "ocupada" : t.status === "reservada" ? "reservada" : `libre · ${t.capacity} pers.`})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium">Nombre del cliente *</label>
                <input
                  type="text"
                  value={resModal.name}
                  onChange={(e) => setResModal({ ...resModal, name: e.target.value })}
                  placeholder="Ej: Juan Pérez"
                  className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Teléfono / WhatsApp *</label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={resModal.phone}
                  onChange={(e) => setResModal({ ...resModal, phone: e.target.value })}
                  placeholder="Ej: 221 555-1234"
                  className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-medium">Comensales</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={30}
                    value={resModal.party}
                    onChange={(e) => setResModal({ ...resModal, party: e.target.value })}
                    className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">Duración (min)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={15}
                    max={720}
                    step={15}
                    value={resModal.duration}
                    onChange={(e) => setResModal({ ...resModal, duration: e.target.value })}
                    className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium">Fecha y hora *</label>
                <input
                  type="datetime-local"
                  value={resModal.datetime}
                  onChange={(e) => setResModal({ ...resModal, datetime: e.target.value })}
                  className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  La mesa se bloquea desde {resConfig.lead_min ?? 15} min antes hasta {resConfig.tolerance_min ?? 15} min después. Fuera de ese turno opera normal.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium">Email (opcional)</label>
                <input
                  type="email"
                  value={resModal.email}
                  onChange={(e) => setResModal({ ...resModal, email: e.target.value })}
                  placeholder="cliente@mail.com"
                  className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Nota (opcional)</label>
                <input
                  type="text"
                  value={resModal.notes}
                  onChange={(e) => setResModal({ ...resModal, notes: e.target.value })}
                  placeholder="Ej: cumpleaños, mesa del jardín…"
                  className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={resSaving} onClick={() => setResModal(null)}>
                Cancelar
              </Button>
              <Button
                disabled={resSaving || !resModal.tableId || !resModal.name.trim() || !resModal.phone.trim() || !resModal.datetime}
                onClick={createReservation}
              >
                {resSaving ? "Guardando…" : "Guardar reserva"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pickerProduct && (
        <ModifierPicker
          modifiers={modifiersMap[pickerProduct.id] || []}
          productName={pickerProduct.name}
            basePrice={unitPriceOf(pickerProduct)}
          onConfirm={handleModConfirm}
          onCancel={() => setPickerProduct(null)}
        />
      )}
    </div>
  );
}
