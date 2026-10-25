"use client";

import { useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apartadoInfo } from "@/lib/apartado";
import {
  ORDER_STATUS_COLORS,
  buildContextualWhatsApp,
  orderCondition,
  orderReadyLabel,
  orderCompleteActionLabel,
  orderNeedsKitchen,
  statusLabel,
  flowSteps,
  nextStatusFor,
  CONDITION_META,
} from "@/lib/order-utils";
import { buildModifiedOrderMessage, buildTransferInstructionsMessage } from "@/lib/whatsapp-message";
import { isGiftProductRow, fmtVence } from "@/lib/gift-card-share";
import { GiftcardSendModal, type SendModalCard } from "@/components/dashboard/giftcard-send-modal";
import { formatDeliveryWindow } from "@/lib/delivery-schedule";
import { CourierAssignBox } from "@/components/dashboard/courier-assign-box";
import { ShipmentBox } from "@/components/dashboard/shipment-box";
import { FiscalBillButton } from "@/components/dashboard/fiscal-bill-button";
import { orderLineTotal, derivedUnitPrice } from "@/lib/order-line";
import type { Order, OrderStatus, OrderItem, Product as DBProduct } from "@/types/database";

function getActionButtonLabel(next: OrderStatus, order: Order, isRetail: boolean): string {
  // Mostrador/mesa SIN cocina (solo bebidas/packs): del estado nuevo pasan
  // directo a "Listo p/ entregar" (flow de 2 pasos).
  if (
    order.status === "new" &&
    (order.channel === "mostrador" || order.channel === "mesa") &&
    !orderNeedsKitchen(order)
  ) {
    return `✅ ${orderReadyLabel(order)}`;
  }
  // Retail (moda/comercio): el primer paso es aceptar/rechazar (control de stock); después se empaqueta.
  if (order.status === "new") return isRetail ? "✓ Aceptar pedido" : "Aceptar y empezar a preparar";
  if (order.status === "confirmed") return isRetail ? "📦 Empezar a empaquetar" : "Empezar a preparar";
  if (next === "ready") return orderReadyLabel(order);
  if (next === "sent" || (next === "completed" && order.status === "ready")) return orderCompleteActionLabel(order);
  const labels: Partial<Record<OrderStatus, string>> = {
    preparing: "Empezar a preparar",
    ready: "Marcar como listo",
    sent: "Enviar",
    completed: "Marcar como entregado",
    new: "Aceptar",
    cancelled: "Cancelar",
  };
  return labels[next] || next;
}

/**
 * Estado del bot de WhatsApp del comercio ("linked" = app Portal Wa Link
 * conectada + bot habilitado): define si el envío de datos de pago va por bot
 * o por WhatsApp manual. Cache a nivel módulo: una consulta por sesión.
 */
type BotState = "unknown" | "linked" | "unlinked";
let waBotStateCache: BotState | undefined;

function setWaBotState(next: Exclude<BotState, "unknown">) {
  waBotStateCache = next;
  return next;
}

type Props = {
  order: Order;
  vendorName: string;
  vendorLogoUrl?: string | null;
  onClose: () => void;
  onAction: (order: Order, status: OrderStatus, reason?: string) => void;
  onModify?: (orderId: string, items: OrderItem[], modificationNotes: string) => Promise<{ ok: boolean; error?: string }>;
  /** Pesables (modo confirmar): guarda los kg reales y sella la confirmación de peso. */
  onConfirmWeight?: (orderId: string, items: OrderItem[]) => Promise<{ ok: boolean; error?: string }>;
  offers?: DBProduct[];
  canPrint?: boolean;
  transfer?: { alias: string | null; cbu: string | null; holder: string | null };
  blockUnpaid?: boolean;
  onMarkPaid?: (orderId: string) => void;
  isRetail?: boolean;
  /** El padre refresca lista + orden seleccionada tras una acción de apartado. */
  onApartadoChanged?: (order: Order) => void;
  /** El padre refresca lista + orden seleccionada tras tildar empaque. */
  onPacked?: (order: Order) => void;
  /** El padre refresca lista + orden seleccionada tras asignar/soltar repartidor. */
  onAssigned?: (order: Order) => void;
};

export default function OrderDetailModal({ order, vendorName, vendorLogoUrl, onClose, onAction, onModify, onConfirmWeight, offers = [], canPrint = true, transfer, blockUnpaid = false, onMarkPaid, isRetail = false, onApartadoChanged, onPacked, onAssigned }: Props) {
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<OrderItem[]>([]);
  // Pesables (modo confirmar): edición de kg reales + confirmación.
  const [weightEditing, setWeightEditing] = useState(false);
  const [weightItems, setWeightItems] = useState<OrderItem[]>([]);
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);
  // Link de pago MP del pedido post-peso (mercadopago pendiente).
  const [payLink, setPayLink] = useState<string | null>(null);
  const [payLinkBusy, setPayLinkBusy] = useState(false);
  const [payLinkError, setPayLinkError] = useState("");
  const [modNotes, setModNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<"ok" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Apartado/seña.
  const [mpLink, setMpLink] = useState<string | null>(null);
  const [mpBusy, setMpBusy] = useState(false);
  const [apBusy, setApBusy] = useState<"deposit" | "remainder" | null>(null);
  const [apError, setApError] = useState("");
  // "💳 Enviar datos de pago por WA": el comercio manda el alias/CBU/monto al
  // cliente por el bot manualmente; el comprobante vuelve por el chat del bot.
  // Un solo botón: con el bot vinculado sale por bot; sin bot (o si el bot se
  // cae al apretar) se abre el WhatsApp del comercio con los datos listos.
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState("");
  const [botFailed, setBotFailed] = useState(false);
  // Cancelación con motivo (M4.1): primer toque muestra opciones rápidas;
  // el motivo viaja al pedido y le llega al cliente en el push/WhatsApp.
  const CANCEL_REASONS = ["No hay stock", "A pedido del cliente", "Se agotó el producto", "Cerramos por hoy"];
  const [cancelStep, setCancelStep] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [botState, setBotState] = useState<BotState>(() => waBotStateCache ?? "unknown");

  // Tarjetas de regalo de esta venta (F2/F3): emitidas + envío por WhatsApp.
  const [issued, setIssued] = useState<any[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [issueMsg, setIssueMsg] = useState("");
  const hasGiftItems = (order.items || []).some((i) => {
    const p = (offers || []).find((o) => o.id === (i as OrderItem).product_id);
    return isGiftProductRow(p ? { sku: (p as any).sku, category: (p as any).category } : null);
  });
  useEffect(() => {
    if (!hasGiftItems) {
      setIssued([]);
      return;
    }
    fetch(`/api/vendor/giftcards?orderId=${encodeURIComponent(order.id)}`)
      .then((r) => r.json())
      .then((d) => setIssued(Array.isArray(d.giftcards) ? d.giftcards : []))
      .catch(() => {});
  }, [order.id, hasGiftItems]);
  async function emitOrderGiftcards() {
    setIssuing(true);
    setIssueMsg("");
    try {
      const res = await fetch("/api/vendor/giftcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue_order", order_id: order.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setIssueMsg(data.error);
        return;
      }
      const list = Array.isArray(data.issued) ? data.issued : [];
      if (list.length === 0) setIssueMsg("No había tarjetas pendientes de emitir en esta venta.");
      const r = await fetch(`/api/vendor/giftcards?orderId=${encodeURIComponent(order.id)}`)
        .then((x) => x.json())
        .catch(() => ({}));
      const full = Array.isArray((r as any).giftcards) ? (r as any).giftcards : list;
      setIssued(full);
      // Con una sola tarjeta nueva se abre directo el modal de envío.
      if (list.length === 1) {
        const c = list[0] as any;
        setSendModal({
          id: String(c.id || ""),
          code: String(c.code || ""),
          amount: Math.round(Number(c.amount) || 0),
          expires_at: typeof c.expires_at === "string" ? c.expires_at : null,
        });
      }
    } catch {
      setIssueMsg("Error de conexión");
    } finally {
      setIssuing(false);
    }
  }
  const [sendModal, setSendModal] = useState<SendModalCard | null>(null);

  // Tildado de empaque (retail, estado Empaquetando): mismo array kitchen_done
  // que la comanda gastro. Solo lectura + tildado (la edición sigue en Nuevo).
  const canPack = isRetail && order.status === "preparing" && !editing;
  const [packDone, setPackDone] = useState<boolean[]>([]);
  const [packBusy, setPackBusy] = useState(false);
  const [strictPack, setStrictPack] = useState(false);
  useEffect(() => {
    const base = Array.isArray(order.kitchen_done) ? [...order.kitchen_done] : [];
    while (base.length < (order.items || []).length) base.push(false);
    setPackDone(base.slice(0, (order.items || []).length));
  }, [order.id, order.kitchen_done, (order.items || []).length]);
  useEffect(() => {
    if (!isRetail) return;
    fetch("/api/vendor/me")
      .then((r) => r.json())
      .then((d) => setStrictPack(d?.vendor?.kitchen_strict_close === true))
      .catch(() => {});
  }, [isRetail]);
  const packTotal = (order.items || []).length;
  const packCount = packDone.filter(Boolean).length;
  const packAllDone = packTotal > 0 && packCount >= packTotal;
  async function togglePack(index: number) {
    if (!canPack || packBusy) return;
    setPackBusy(true);
    const prev = [...packDone];
    const next = [...packDone];
    next[index] = !next[index];
    setPackDone(next);
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggle_item: index }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || "No se pudo tildar");
      const server = Array.isArray(data?.order?.kitchen_done) ? [...data.order.kitchen_done] : next;
      while (server.length < packTotal) server.push(false);
      setPackDone(server.slice(0, packTotal));
      if (data?.order) onPacked?.(data.order as Order);
    } catch {
      setPackDone(prev);
    } finally {
      setPackBusy(false);
    }
  }
  async function markAllPack() {
    if (!canPack || packBusy) return;
    setPackBusy(true);
    try {
      const full = Array(packTotal).fill(true);
      const res = await fetch(`/api/vendor/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kitchen_done: full }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || "No se pudo tildar");
      setPackDone(full);
      if (data?.order) onPacked?.(data.order as Order);
    } catch { /* conserva estado local */ } finally {
      setPackBusy(false);
    }
  }
  useEffect(() => {
    setMpLink(null);
    setApError("");
    setPayMsg("");
    setBotFailed(false);
  }, [order.id]);

  const ap = apartadoInfo(order);
  // Apartado con saldo pendiente en el paso de aceptar: el camino correcto
  // es cobrar el saldo (no aceptar directo). Se reemplaza el botón primario.
  const apartadoUnpaidAccept = ap.isApartado && !ap.fullyPaid && ap.active && nextStatusFor(order.status as OrderStatus, order.method, isRetail, order.channel, orderNeedsKitchen(order)) === "confirmed";

  async function handleSendPaymentData() {
    if (payBusy) return;
    setPayBusy(true);
    setPayMsg("");
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}/send-payment-data`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPayMsg(data?.error || "No se pudo enviar.");
        return;
      }
      if (data.sent === true) setPayMsg("✅ Datos de pago enviados por WhatsApp.");
      else if (data.reason === "sin_relay") {
        // Bot caído a mitad de sesión: el bloque conmuta al WA manual.
        setBotFailed(true);
        setPayMsg("El bot no pudo enviarlo — mandalo con tu WhatsApp (botón de abajo).");
      }
      else if (data.reason === "ya_enviado") setPayMsg("Ya se enviaron los datos de pago de este pedido (esa ventana ya está esperando el comprobante).");
      else setPayMsg(`No se envió${data.reason ? ` (${data.reason})` : ""}.`);
    } catch {
      setPayMsg("Error de red. Probá de nuevo.");
    } finally {
      setPayBusy(false);
    }
  }

  async function handleApartadoMark(kind: "deposit" | "remainder") {
    setApError("");
    setApBusy(kind);
    try {
      const res = await fetch(`/api/vendor/apartados/${order.id}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.order) {
        setApError(data.error || "No se pudo registrar el pago.");
        return;
      }
      onApartadoChanged?.(data.order as Order);
    } catch {
      setApError("Error de red. Probá de nuevo.");
    } finally {
      setApBusy(null);
    }
  }

  async function handleApartadoLink() {
    setApError("");
    setMpBusy(true);
    try {
      const res = await fetch(`/api/vendor/apartados/${order.id}/deposit-link`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.initPoint) {
        setApError(data.error || "No se pudo generar el link.");
        return;
      }
      setMpLink(data.initPoint as string);
    } catch {
      setApError("Error de red. Probá de nuevo.");
    } finally {
      setMpBusy(false);
    }
  }

  const isCancelled = order.status === "cancelled";
  const isCompleted = order.status === "completed";
  const isTerminal = isCancelled || isCompleted;
  const canModify = order.status === "new" && !isTerminal;
  const STEP_ORDER = flowSteps(isRetail);
  const statusIdx = STEP_ORDER.indexOf(order.status as OrderStatus);
  // Pedido solo-tarjetas: de aceptado va directo a listo (nada que empaquetar).
  const giftOnly = order.is_gift_only === true;
  const nextStatus = nextStatusFor(order.status as OrderStatus, order.method, isRetail, order.channel, orderNeedsKitchen(order), giftOnly);
  // Envío por logística partner (zona extendida): los pasos "enviado/entregado"
  // los maneja el operador desde su panel — el comercio solo prepara y avisa
  // (bloque violeta). Se decide por `shipping_zone_id` (el pedido ES de
  // logística), no por la existencia del encargo: así los botones de reparto
  // propio no aparecen ni antes de apretar "Avisar a la logística".
  const isLogisticsOrder = !!(order as any).shipping_zone_id;
  const logisticsOwnsNext =
    isLogisticsOrder && (nextStatus === "sent" || nextStatus === "completed");

  const customerPhone = order.customer_phone?.replace(/\D/g, "");
  // Mostrador y mesa son ventas presenciales: sin WhatsApp del cliente.
  const isCounterChannel = order.channel === "mostrador" || order.channel === "mesa";
  const contactWhatsApp = customerPhone && !isCounterChannel ? `https://wa.me/${customerPhone}` : null;

  const isTransferAppPending =
    order.payment_method === "transferencia" &&
    order.channel === "app" &&
    order.payment_status === "pending";

  const transferInstructions = isTransferAppPending
    ? buildTransferInstructionsMessage({
        vendorName,
        customerName: order.customer_name,
        orderId: order.id,
        total: Number(order.total),
        alias: transfer?.alias || "",
        cbu: transfer?.cbu || undefined,
        holder: transfer?.holder || "",
        blocked: blockUnpaid,
      })
    : null;

  const contextualWaRaw = isCounterChannel ? null : buildContextualWhatsApp(order, vendorName, transfer, () => transferInstructions, isRetail);
  // La variante "transfer" (💸 Datos de pago) vive en el bloque ámbar de pago
  // (bot o manual): acá abajo duplicaría. Las demás variantes sí se muestran.
  const contextualWa = contextualWaRaw?.variant === "transfer" ? null : contextualWaRaw;
  const isBlockedByPayment = blockUnpaid && isTransferAppPending;

  // Pesables (modo confirmar): pedido nacido "pendiente de peso".
  const weightEstimated = Number((order as any).weight_estimated_total) || 0;
  const weightConfirmed = !!(order as any).weight_confirmed_at;
  const weightPending = weightEstimated > 0 && !weightConfirmed && !isTerminal;
  const mpWeightPending =
    order.payment_method === "mercadopago" && weightConfirmed &&
    order.payment_status === "pending" && !isTerminal;

  const startWeightEdit = useCallback(() => {
    setWeightItems(JSON.parse(JSON.stringify(order.items || [])));
    setWeightError(null);
    setWeightEditing(true);
  }, [order.items]);

  const setWeightKg = (index: number, kg: number) => {
    const safe = Number.isFinite(kg) ? Math.max(0, Math.round(kg * 1000) / 1000) : 0;
    setWeightItems((prev) => prev.map((item, i) => (i === index ? { ...item, qty: safe } : item)));
  };

  const weightTotal = weightItems.reduce((sum, item) => sum + orderLineTotal(item), 0);

  const confirmWeight = async () => {
    if (!onConfirmWeight) return;
    const badKg = weightItems.find((it) => (it as any).unit === "kg" && !(Number(it.qty) > 0));
    if (badKg) {
      setWeightError(`Poné el peso real de "${badKg.name}" (mayor a 0) o cancelá`);
      return;
    }
    setWeightSaving(true);
    setWeightError(null);
    const result = await onConfirmWeight(order.id, weightItems).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : "Error de red",
    }));
    setWeightSaving(false);
    if (!result.ok) {
      setWeightError(result.error || "No se pudo confirmar el peso");
    } else {
      setWeightEditing(false);
    }
  };

  const genPayLink = async () => {
    setPayLinkBusy(true);
    setPayLinkError("");
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: order.vendor_id, orderId: order.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.initPoint) {
        setPayLinkError(data.error || "No se pudo generar el link.");
        return;
      }
      setPayLink(data.initPoint as string);
    } catch {
      setPayLinkError("Error de red. Probá de nuevo.");
    } finally {
      setPayLinkBusy(false);
    }
  };

  // Estado del bot (una sola vez por sesión): decide botón de bot vs WA manual.
  // "unknown" (fetch falla) = modo manual: el link wa.me funciona siempre.
  useEffect(() => {
    if (!isTransferAppPending || waBotStateCache) return;
    let cancelled = false;
    fetch("/api/vendor/wa-status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        setBotState(setWaBotState(d?.linked ? "linked" : "unlinked"));
      })
      .catch(() => {
        if (!cancelled) setBotState("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [isTransferAppPending]);

  // El bloque de pago muestra UNA sola vía: bot vinculado → bot; sin bot (o
  // bot que se cayera al apretar) → WhatsApp manual del comercio.
  const useBotSend = botState === "linked" && !botFailed;
  const transferHasData = !!(transfer?.alias || transfer?.cbu);
  const manualPayUrl =
    isTransferAppPending && isCounterChannel === false && customerPhone && transferHasData && transferInstructions
      ? `https://wa.me/${customerPhone}?text=${encodeURIComponent(transferInstructions)}`
      : null;

  const startEditing = useCallback(() => {
    setEditItems(JSON.parse(JSON.stringify(order.items || [])));
    setModNotes("");
    setProductSearch("");
    setShowProductPicker(false);
    setSaveError(null);
    setEditing(true);
  }, [order.items]);

  const updateItemQty = (index: number, qty: number) => {
    if (qty < 1) return removeItem(index);
    setEditItems((prev) => prev.map((item, i) => (i === index ? { ...item, qty } : item)));
  };

  /** Paso de cantidad por ítem (pack-aware: con pack_size va de a N). */
  const stepQty = (index: number, delta: 1 | -1) => {
    const item = editItems[index];
    const pack = Number((item as any).pack_size) && Number((item as any).pack_size) >= 2
      ? Math.floor(Number((item as any).pack_size))
      : 1;
    updateItemQty(index, item.qty + delta * pack);
  };

  const removeItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addProduct = (product: DBProduct) => {
    const pack = Number((product as any).pack_size) >= 2 ? Math.floor(Number((product as any).pack_size)) : 0;
    setEditItems((prev) => [
      ...prev,
      {
        product_id: product.id,
        name: product.name,
        price: product.promo_price ?? product.price,
        qty: pack || 1,
        modifiers: [],
        ...(pack ? { pack_size: pack } : {}),
      },
    ]);
  };

  const availableProducts = offers.filter(
    (p) =>
      p.available &&
      !editItems.some((i) => i.product_id === p.id) &&
      p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const newTotal = editItems.reduce(
    (sum, item) => sum + orderLineTotal(item),
    0
  );

  const handleSaveModification = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!onModify || editItems.length === 0) {
      return { ok: false, error: !onModify ? "No hay función para guardar" : "No hay productos" };
    }
    setSaving(true);
    setSaveError(null);
    const result = await onModify(order.id, editItems, modNotes).catch((err) => {
      return { ok: false, error: err instanceof Error ? err.message : "Error de red" };
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error || "No se pudo guardar la modificación");
    } else {
      setEditing(false);
    }
    return result;
  };

  const sendModifiedWhatsApp = () => {
    const msg = buildModifiedOrderMessage({
      vendorName,
      items: editItems.map((it: any) => ({ ...it, lineTotal: orderLineTotal(it) })),
      total: newTotal,
      customerName: order.customer_name,
      orderId: order.id,
      modificationNotes: modNotes || undefined,
      address: order.customer_address || undefined,
    });
    const phone = customerPhone;
    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
    }
  };

  async function handlePrint(type: "comanda" | "ticket" | "despacho" = isRetail ? "ticket" : "comanda") {
    setPrinting(true);
    setPrintStatus(null);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, type }),
      });
      const data = await res.json();
      if (data.ok || data.skipped) {
        setPrintStatus("ok");
      } else {
        setPrintStatus("error");
        openSystemPrint();
      }
    } catch {
      setPrintStatus("error");
      openSystemPrint();
    }
    setPrinting(false);
    setTimeout(() => setPrintStatus(null), 3000);
  }

  function openSystemPrint() {
    window.open(`/vendor/imprimir/${order.id}`, "_blank", "noopener");
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && !editing) onClose();
  }, [onClose, editing]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const created = new Date(order.created_at);
  const isFinal = order.status === "completed" || order.status === "cancelled";
  const endMs = isFinal && order.closed_at ? new Date(order.closed_at).getTime() : Date.now();
  const elapsed = Math.floor((endMs - created.getTime()) / 60000);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-card w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-sm font-bold text-foreground">{order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`}</span>
            <Badge className={ORDER_STATUS_COLORS[order.status as OrderStatus]}>
              {order.status === "ready" ? orderReadyLabel(order) : statusLabel(order.status as OrderStatus, isRetail)}
            </Badge>
            {order.modification_notes && !editing && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">Editado</Badge>
            )}
            {isTransferAppPending && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700">🕐 Pago pendiente</Badge>
            )}
            {order.is_preview && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-violet-100 text-violet-700 font-bold">🧪 PRUEBA</Badge>
            )}
            {ap.isApartado && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-800 font-bold">🏷️ APARTADO</Badge>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors text-lg">
            ✕
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Customer info */}
          <div className="space-y-1">
            <p className="font-semibold text-sm">{order.customer_name}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <a
                href={`https://wa.me/${customerPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {order.customer_phone}
              </a>
              <span>·</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CONDITION_META[orderCondition(order)].pillClass}`}>
                {CONDITION_META[orderCondition(order)].emoji} {CONDITION_META[orderCondition(order)].label}
              </span>
            </div>
            {order.method === "delivery" && order.customer_address && (
              <p className="text-xs text-muted-foreground">📍 {order.customer_address}</p>
            )}
            {order.method === "delivery" && ((order as any).delivery_zone_name || (order as any).delivery_out_of_area) && (
              <p className="text-xs font-semibold">
                {(order as any).delivery_out_of_area ? (
                  <span className="text-amber-700">⚠️ Otra zona — envío a convenir</span>
                ) : (
                  <span className="text-muted-foreground">
                    🗺️ Zona: {(order as any).delivery_zone_name}
                    {(order as any).delivery_fee != null && Number((order as any).delivery_fee) > 0 && (
                      <> · Envío ${Number((order as any).delivery_fee).toLocaleString("es-AR")}</>
                    )}
                  </span>
                )}
              </p>
            )}
            {order.method === "delivery" && (order as any).delivery_window && (
              <p className="text-xs font-semibold text-violet-700">
                📦 Turno de entrega: {formatDeliveryWindow((order as any).delivery_window)}
              </p>
            )}
            {/* Zona extendida = entrega por logística partner: canales
                excluyentes. Sin box de repartidor propio; ShipmentBox (abajo)
                muestra el bloque violeta de Portal 659 Envíos. */}
            {order.method === "delivery" && !(order as any).shipping_zone_id && (
              <CourierAssignBox order={order} vendorName={vendorName} onAssigned={onAssigned} />
            )}
            <ShipmentBox order={order} onChanged={onAssigned} />
          </div>

          {/* Apartado / seña */}
          {ap.isApartado && ap.active && !editing && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
              <p className="text-xs font-bold text-amber-800 tabular-nums">
                🏷️ Seña ${ap.deposit.toLocaleString("es-AR")}{ap.pct > 0 ? ` (${ap.pct}%)` : ""} · Saldo ${ap.remainder.toLocaleString("es-AR")}
              </p>
              <p className="text-xs text-amber-700">
                {ap.fullyPaid
                  ? "✅ Cobrado total"
                  : `Seña: ${ap.depositPaid ? "cobrada ✅" : "pendiente"}`}
                {ap.dueLabel && !ap.fullyPaid ? ` · ${ap.overdue ? "venció" : "vence"} ${ap.dueLabel}` : ""}
                {ap.overdue && <span className="font-bold text-red-600"> · vencido</span>}
              </p>
              {apError && (
                <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ❌ {apError}
                </p>
              )}
              {!ap.depositPaid && (
                <div className="flex gap-2">
                  {order.payment_method === "mercadopago" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={mpBusy}
                      onClick={handleApartadoLink}
                    >
                      {mpBusy ? "Generando…" : "🔗 Link de seña (MP)"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                    disabled={apBusy === "deposit"}
                    onClick={() => handleApartadoMark("deposit")}
                  >
                    {apBusy === "deposit" ? "Guardando…" : "Marcar seña cobrada"}
                  </Button>
                </div>
              )}
              {mpLink && !ap.depositPaid && (
                <div className="space-y-1.5">
                  <Input value={mpLink} readOnly onFocus={(e) => e.target.select()} className="h-8 text-[11px]" />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { void navigator.clipboard?.writeText(mpLink).catch(() => {}); }}
                    >
                      Copiar link
                    </Button>
                    <a
                      href={`https://wa.me/${customerPhone}?text=${encodeURIComponent(`Hola, te paso el link para la seña de tu apartado: ${mpLink}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-green-500 text-white text-xs font-medium py-2 text-center hover:bg-green-600"
                    >
                      Enviar por WA
                    </a>
                  </div>
                </div>
              )}
              {ap.depositPaid && !ap.fullyPaid && (
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={apBusy === "remainder"}
                  onClick={() => handleApartadoMark("remainder")}
                >
                  {apBusy === "remainder" ? "Guardando…" : `✅ Marcar saldo cobrado ($${ap.remainder.toLocaleString("es-AR")})`}
                </Button>
              )}
            </div>
          )}

          {/* Pesables (modo confirmar): pendiente de peso */}
          {!editing && (weightPending || weightEditing) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
              {weightEditing ? (
                <>
                  <p className="text-xs font-bold text-amber-800">⚖️ Pesá y cargá los kilos reales</p>
                  <div className="space-y-1.5">
                    {weightItems.map((item, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 bg-white/70 rounded-lg px-2 py-1.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{item.name}</p>
                          {(item as any).unit === "kg" && (
                            <p className="text-[10px] text-muted-foreground">${Number(item.price).toLocaleString("es-AR")}/kg</p>
                          )}
                        </div>
                        {(item as any).unit === "kg" ? (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.001"
                              min="0"
                              value={Number(item.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}
                              onChange={(e) => setWeightKg(i, Number(e.target.value.replace(",", ".")))}
                              className="h-7 w-20 text-sm text-right"
                              aria-label={`Peso real de ${item.name} en kilos`}
                            />
                            <span className="text-xs text-muted-foreground">kg</span>
                          </div>
                        ) : (
                          <span className="text-xs font-medium flex-shrink-0 tabular-nums">{item.qty}×</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-700">Estimado: ${weightEstimated.toLocaleString("es-AR")}</span>
                    <span className="font-bold text-amber-900 tabular-nums">Total real: ${weightTotal.toLocaleString("es-AR")}</span>
                  </div>
                  {weightError && <p className="text-xs font-semibold text-red-600">{weightError}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={weightSaving} onClick={confirmWeight}>
                      {weightSaving ? "Guardando…" : "✅ Confirmar peso"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setWeightEditing(false)}>
                      Cancelar
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs font-bold text-amber-800">⚖️ Pendiente de peso</p>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    Total estimado ${weightEstimated.toLocaleString("es-AR")}. Pesá, ajustá los kilos y confirmá
                    el total real para que el cliente pueda pagar.
                  </p>
                  <Button size="sm" className="w-full" onClick={startWeightEdit}>
                    ⚖️ Confirmar peso
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Pesables: pago MP del total real (peso ya confirmado) */}
          {!editing && mpWeightPending && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 space-y-2">
              <p className="text-xs font-bold text-blue-800">
                💳 Pago pendiente — total real ${Number(order.total).toLocaleString("es-AR")}
              </p>
              {payLinkError && <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">{payLinkError}</p>}
              {!payLink ? (
                <>
                  <Button size="sm" className="w-full" disabled={payLinkBusy} onClick={genPayLink}>
                    {payLinkBusy ? "Generando…" : "🔗 Generar link de pago (MP)"}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    El cliente también puede pagar desde su link de seguimiento.
                  </p>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Input value={payLink} readOnly onFocus={(e) => e.target.select()} className="h-8 text-[11px]" />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { void navigator.clipboard?.writeText(payLink).catch(() => {}); }}
                    >
                      Copiar link
                    </Button>
                    {customerPhone ? (
                      <a
                        href={`https://wa.me/${customerPhone}?text=${encodeURIComponent(`Hola, tu pedido ya está pesado: total $${Number(order.total).toLocaleString("es-AR")}. Podés pagarlo con este link: ${payLink}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md bg-green-500 text-white text-xs font-medium py-2 text-center hover:bg-green-600"
                      >
                        Enviar por WA
                      </a>
                    ) : (
                      <Button type="button" variant="outline" size="sm" disabled>
                        Sin teléfono
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Progress steps */}
          {!isCancelled && !editing && (
            <div className="space-y-2">
              <div className="flex items-center gap-0">
                {STEP_ORDER.map((step, idx) => {
                  const done = idx <= statusIdx;
                  const isCurrent = idx === statusIdx;
                  return (
                    <div key={step} className="flex items-center flex-1">
                      <div className="flex flex-col items-center flex-1">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                            done
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          } ${isCurrent ? "ring-2 ring-primary/30 ring-offset-2 ring-offset-card" : ""}`}
                        >
                          {done ? "✓" : idx + 1}
                        </div>
                        <p className={`text-[9px] mt-1 text-center leading-tight ${done ? "text-primary font-medium" : "text-muted-foreground/50"}`}>
                          {step === "ready" ? orderReadyLabel(order) : statusLabel(step, isRetail)}
                        </p>
                      </div>
                      {idx < STEP_ORDER.length - 1 && (
                        <div className={`h-0.5 w-full -mt-3 ${idx < statusIdx ? "bg-primary" : "bg-muted"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                {isTerminal
                  ? (order.status === "completed" ? `Tardó ${elapsed} min` : `${elapsed} min`)
                  : `${elapsed} min · ${order.estimated_minutes ? `~${Math.max(0, order.estimated_minutes - elapsed)} min restantes` : "Sin estimado"}`}
              </p>
            </div>
          )}

          {isCancelled && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
              <p className="text-xs text-red-600 font-medium">Pedido cancelado</p>
              {((order as any).cancel_reason || (order as any).cancelled_by) && (
                <p className="text-[11px] text-red-500 mt-0.5">
                  {((order as any).cancel_reason ? `Motivo: ${(order as any).cancel_reason}` : "")}
                  {((order as any).cancel_reason && (order as any).cancelled_by) ? " · " : ""}
                  {((order as any).cancelled_by ? `por ${(order as any).cancelled_by}` : "")}
                </p>
              )}
            </div>
          )}

          {/* Items - View mode */}
          {!editing && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {canPack ? `Empaque ${packCount}/${packTotal}` : "Productos"}
                </h3>
                {canPack && !packAllDone && (
                  <button
                    type="button"
                    onClick={markAllPack}
                    disabled={packBusy}
                    className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
                  >
                    Tildar todos
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {(order.items || []).map((item, i) => (
                  <div key={i} className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-start gap-2">
                      {canPack && (
                        <button
                          type="button"
                          onClick={() => togglePack(i)}
                          disabled={packBusy}
                          aria-label={packDone[i] ? `Destildar ${item.name}` : `Tildar ${item.name} como empaquetado`}
                          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 text-[12px] font-bold transition-colors disabled:opacity-40 ${
                            packDone[i] ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 text-transparent"
                          }`}
                        >
                          ✓
                        </button>
                      )}
                      <div className="min-w-0">
                        <p className={`text-sm break-words ${packDone[i] && canPack ? "line-through text-muted-foreground" : ""}`}>
                          <span className="font-bold">{(item as any).unit === "kg" ? `${Number(item.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}kg` : `${item.qty}x`}</span> {item.name}
                        </p>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/70 pl-5">
                          ({item.modifiers.join(", ")})
                        </p>
                      )}
                      {Array.isArray((item as any).combo_members) && (item as any).combo_members.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/70 pl-5">
                          🧩 {(item as any).combo_members.map((m: any) => (Number(m.qty) || 1) > 1 ? `${m.qty}× ${m.name}` : m.name).join(" + ")}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-medium whitespace-nowrap shrink-0">
                      ${orderLineTotal(item).toLocaleString("es-AR")}
                    </span>
                  </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Items - Edit mode */}
          {editing && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Editar productos</h3>
                <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancelar edicion
                </button>
              </div>
              <div className="space-y-2">
                {editItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-background">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/70">
                          ({item.modifiers.join(", ")})
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        {(item as any).pack_size >= 2
                          ? `$${derivedUnitPrice(item).toLocaleString("es-AR")} c/u · pack x${(item as any).pack_size}`
                          : `$${item.price.toLocaleString("es-AR")} c/u`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => stepQty(i, -1)}
                        className="w-7 h-7 rounded-lg border border-border bg-muted flex items-center justify-center text-sm font-bold"
                      >
                        -
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{item.qty}</span>
                      <button
                        onClick={() => stepQty(i, 1)}
                        className="w-7 h-7 rounded-lg border border-border bg-muted flex items-center justify-center text-sm font-bold"
                      >
                        +
                      </button>
                      <button
                        onClick={() => removeItem(i)}
                        className="w-7 h-7 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-sm text-red-600"
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Product picker */}
              <div className="mt-3 border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowProductPicker((p) => !p)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-primary hover:bg-muted transition-colors"
                >
                  <span>{showProductPicker ? "Ocultar menu" : "+ Agregar producto del menu"}</span>
                  <span className="text-muted-foreground">{showProductPicker ? "▲" : "▼"}</span>
                </button>
                {showProductPicker && (
                  <div className="border-t border-border">
                    <div className="px-3 py-2">
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Buscar producto..."
                        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-input bg-background"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {availableProducts.length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">No se encontraron productos</p>
                      )}
                      {availableProducts.map((product) => (
                        <button
                          key={product.id}
                          onClick={() => addProduct(product)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                        >
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-9 h-9 rounded-md object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center text-sm flex-shrink-0">
                              📷
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{product.name}</p>
                            {product.category && (
                              <p className="text-[10px] text-muted-foreground">{product.category}</p>
                            )}
                          </div>
                          <span className="text-xs font-semibold whitespace-nowrap">
                            ${(product.promo_price ?? product.price).toLocaleString("es-AR")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Observaciones de modificacion
                </label>
                <textarea
                  value={modNotes}
                  onChange={(e) => setModNotes(e.target.value)}
                  placeholder={isRetail ? "Ej: Talle M sin stock, se reemplaza por L..." : "Ej: Pizza no disponible, se reemplazo por empanadas..."}
                  className="mt-1 w-full h-16 px-3 text-xs rounded-lg border border-input bg-background resize-none"
                />
              </div>

              <div className="flex items-center justify-between mt-3 p-2 rounded-lg bg-muted">
                <span className="text-sm font-semibold">Nuevo total</span>
                <span className="text-lg font-bold text-primary">${newTotal.toLocaleString("es-AR")}</span>
              </div>
            </div>
          )}

          {/* Modification notes (view) */}
          {!editing && order.modification_notes && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-blue-700 mb-0.5">Modificado:</p>
              <p className="text-xs text-blue-600">{order.modification_notes}</p>
            </div>
          )}

          {/* Notes */}
          {order.notes && !editing && (
            <div className="bg-warm/30 rounded-lg px-3 py-2">
              <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">Notas del cliente:</p>
              <p className="text-xs text-muted-foreground/70">{order.notes}</p>
            </div>
          )}

          {/* Payment + total */}
          {!editing && (
            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {order.payment_method === "efectivo" && "💵 Efectivo"}
                  {order.payment_method === "transferencia" && "🏦 Transferencia"}
                  {order.payment_method === "whatsapp" && "📱 Coordinar"}
                </span>
                <span>{created.toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-lg font-bold text-primary">${Number(order.total).toLocaleString("es-AR")}</span>
              </div>
              {order.payment_method === "efectivo" && Number((order as any)?.cash_amount) > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-green-50 border border-green-200 px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-green-800">
                    💵 Abona ${Number((order as any).cash_amount).toLocaleString("es-AR")}
                  </span>
                  <span className="text-xs font-bold text-green-700">
                    Vuelto: ${Math.max(0, Math.round((Number((order as any).cash_amount) - Number(order.total)) * 100) / 100).toLocaleString("es-AR")}
                  </span>
                </div>
              )}
              {Number((order as any)?.giftcard_discount) > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>🎁 Giftcard{((order as any)?.giftcard_code) ? ` (${(order as any).giftcard_code})` : ""}</span>
                  <span>−${Number((order as any).giftcard_discount).toLocaleString("es-AR")}</span>
                </div>
              )}
            </div>
          )}

          {/* Tarjetas de regalo de esta venta (emisión + envío WhatsApp) */}
          {!editing && hasGiftItems && (order as any)?.is_preview !== true && order.status !== "cancelled" && (
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs font-medium">🎁 Tarjetas de regalo de esta venta</p>
              {issued.length > 0 ? (
                <div className="space-y-1.5">
                  {issued.map((c: any) => (
                    <div key={String(c.id || c.code)} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono font-bold text-xs truncate">{String(c.code)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          ${Math.round(Number(c.amount) || 0).toLocaleString("es-AR")}
                          {" · "}
                          {String(c.status) === "active" ? "Activa" : String(c.status) === "redeemed" ? "Agotada" : "Anulada"}
                          {c.expires_at ? ` · Vence ${fmtVence(String(c.expires_at))}` : ""}
                        </p>
                      </div>
                      {String(c.status) === "active" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setSendModal({
                              id: String(c.id || ""),
                              code: String(c.code || ""),
                              amount: Math.round(Number(c.amount) || 0),
                              expires_at: typeof c.expires_at === "string" ? c.expires_at : null,
                              customer_phone: typeof c.customer_phone === "string" ? c.customer_phone : null,
                            })
                          }
                        >
                          Ver
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Todavía no se emitieron códigos para esta venta.
                </p>
              )}
              <Button type="button" size="sm" variant="outline" className="w-full" onClick={emitOrderGiftcards} disabled={issuing}>
                {issuing ? "Emitiendo..." : "🎁 Generar giftcard"}
              </Button>
              {issueMsg && <p className="text-xs text-muted-foreground">{issueMsg}</p>}
            </div>
          )}
          {sendModal && (
            <GiftcardSendModal
              card={sendModal}
              storeName={vendorName || "el local"}
              logoUrl={vendorLogoUrl ?? null}
              fallbackPhone={String(order.customer_phone || "")}
              onClose={() => setSendModal(null)}
            />
          )}

          {/* Actions */}
          {!isTerminal && !editing && (
            <div className="space-y-2 pt-2">
              {canModify && (
                <Button variant="outline" className="w-full" onClick={startEditing}>
                  ✏️ Modificar pedido
                </Button>
              )}
              {isTransferAppPending && (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-semibold">🕐 Pago pendiente ({order.payment_status})</p>
                  <p className="text-amber-700">
                    Transferí los datos al cliente y confirmá el depósito antes de avanzar.
                  </p>
                  {order.transfer_proof_url && (
                    <div className="space-y-1.5 rounded-md border border-amber-200 bg-white/70 p-2">
                      <p className="font-semibold">🧾 Comprobante recibido (por WhatsApp)</p>
                      {/\.pdf(\?|$)/i.test(order.transfer_proof_url) ? (
                        <a
                          href={order.transfer_proof_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block text-xs text-primary underline"
                        >
                          Abrir PDF del comprobante
                        </a>
                      ) : (
                        <a href={order.transfer_proof_url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={order.transfer_proof_url}
                            alt="Comprobante de transferencia"
                            className="max-h-56 w-auto rounded border border-border object-contain"
                          />
                        </a>
                      )}
                    </div>
                  )}
                  {useBotSend ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-primary/40 text-primary hover:bg-primary/10"
                      disabled={payBusy}
                      onClick={handleSendPaymentData}
                    >
                      {payBusy ? "Enviando..." : "💳 Enviar datos de pago por WhatsApp"}
                    </Button>
                  ) : manualPayUrl && !isCounterChannel ? (
                    <>
                      <a href={manualPayUrl} target="_blank" rel="noopener noreferrer" className="block">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full border-primary/40 text-primary hover:bg-primary/10"
                        >
                          💳 Enviar datos de pago por WhatsApp
                        </Button>
                      </a>
                      <p className="text-center text-[10px] text-muted-foreground">
                        {botFailed
                          ? "El bot no pudo enviarlo — se abre tu WhatsApp con los datos listos."
                          : "El bot no está conectado — se abre tu WhatsApp con los datos listos."}
                      </p>
                    </>
                  ) : !customerPhone || isCounterChannel ? (
                    <p className="text-center text-[10px] text-muted-foreground">
                      El pedido no tiene teléfono del cliente — coordinale el pago por la vía que uses de siempre.
                    </p>
                  ) : (
                    <p className="text-center text-[10px] text-muted-foreground">
                      Cargá tu alias o CBU en Configuración → Cobros para mandarle los datos de pago al cliente.
                    </p>
                  )}
                  {payMsg && <p className="text-center text-[10px] text-muted-foreground">{payMsg}</p>}
                  {onMarkPaid && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                      onClick={() => onMarkPaid(order.id)}
                    >
                      ✓ Marcar como pagado
                    </Button>
                  )}
                </div>
              )}
              {nextStatus && (
                apartadoUnpaidAccept ? (
                  <Button
                    className="w-full"
                    disabled={!ap.depositPaid || apBusy === "remainder"}
                    title={!ap.depositPaid ? "Primero hay que cobrar la seña" : undefined}
                    onClick={() => handleApartadoMark("remainder")}
                  >
                    {apBusy === "remainder" ? "Guardando…" : `✅ Marcar saldo cobrado ($${ap.remainder.toLocaleString("es-AR")})`}
                  </Button>
                ) : isBlockedByPayment ? (
                  <div className="w-full">
                    <button
                      type="button"
                      onClick={() => { window.location.href = "/planes"; }}
                      disabled
                      className="w-full h-10 rounded-xl font-bold text-sm border border-border text-muted-foreground bg-muted/50 flex items-center justify-center gap-2 cursor-not-allowed opacity-70"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 1a5 5 0 00-5 5v3H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V11a2 2 0 00-2-2h-1V6a5 5 0 00-5-5zm-3 8V6a3 3 0 116 0v3H9z" />
                      </svg>
                      {getActionButtonLabel(nextStatus, order, isRetail)} — esperando pago
                    </button>
                  </div>
                ) : logisticsOwnsNext ? (
                  // La logística maneja enviado/entregado: sin botones propios.
                  <div className="w-full h-10 rounded-xl font-bold text-sm border border-border text-muted-foreground bg-muted/50 flex items-center justify-center gap-2">
                    🚚 {order.status === "ready" ? "Esperando colecta" : "En manos de la logística"}
                  </div>
                ) : nextStatus === "sent" && order.method === "delivery" ? (
                  // Delivery: dos acciones (marcar enviado o marcar + imprimir comprobante del repartidor).
                  <div className="space-y-2">
                    <Button
                      className="w-full"
                      onClick={() => { onAction(order, "sent"); onClose(); }}
                    >
                      {getActionButtonLabel(nextStatus, order, isRetail)}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={printing}
                      onClick={async () => {
                        onAction(order, "sent");
                        await handlePrint("despacho");
                        onClose();
                      }}
                    >
                      {printing ? "🖨️ Imprimiendo..." : "🖨️ Marcar como enviado + imprimir comprobante"}
                    </Button>
                  </div>
                ) : isRetail && strictPack && nextStatus === "ready" && !packAllDone ? (
                  <div
                    className="w-full h-10 rounded-xl font-bold text-sm border border-border text-muted-foreground bg-muted/50 flex items-center justify-center gap-2"
                    title="Tildá todos los productos del empaque para marcar Listo"
                  >
                    ☐ Tildá todo ({packCount}/{packTotal})
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => { onAction(order, nextStatus); onClose(); }}
                  >
                    {getActionButtonLabel(nextStatus, order, isRetail)}
                  </Button>
                )
              )}
              {order.status !== "new" && (orderNeedsKitchen(order) || isRetail) && (
                <>
                  {canPrint ? (
                    <button
                      onClick={() => handlePrint()}
                      disabled={printing}
                      className={`w-full h-10 rounded-xl font-bold text-sm border active:scale-[0.98] transition-all ${
                        printStatus === "ok"
                          ? "bg-green-50 text-green-700 border-green-300"
                          : printStatus === "error"
                          ? "bg-red-50 text-red-600 border-red-300"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {printing ? "🖨️ Imprimiendo..." : printStatus === "ok" ? "✅ Impreso" : printStatus === "error" ? "❌ Error al imprimir" : isRetail ? "🖨️ Imprimir comprobante" : "🖨️ Imprimir comanda"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { window.location.href = "/planes"; }}
                      className="w-full h-10 rounded-xl font-bold text-sm border border-border text-muted-foreground bg-muted/50 flex items-center justify-center gap-2 cursor-pointer opacity-70"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 1a5 5 0 00-5 5v3H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V11a2 2 0 00-2-2h-1V6a5 5 0 00-5-5zm-3 8V6a3 3 0 116 0v3H9z" />
                      </svg>
                      {isRetail ? "Imprimir comprobante — Exclusivo plan Gestión" : "Imprimir comanda — Exclusivo plan Gestión"}
                    </button>
                  )}
                  {!canPrint && (
                    <p className="text-[11px] text-center text-muted-foreground">
                      Actualizá a <a href="/planes" className="text-primary font-medium underline">Gestión integral</a> para imprimir {isRetail ? "comprobantes" : "comandas"}
                    </p>
                  )}
                </>
              )}
              <FiscalBillButton orderId={order.id} />
              {contextualWa && (
                <a href={contextualWa.url} target="_blank" rel="noopener noreferrer" className="block">
                  <Button variant="outline" className="w-full border-green-200 bg-green-50 text-green-700 hover:bg-green-100">
                    {contextualWa.label}
                  </Button>
                </a>
              )}
              {contactWhatsApp && (
                <a href={contactWhatsApp} target="_blank" rel="noopener noreferrer" className="block">
                  <Button variant="outline" className="w-full border-green-200 bg-green-50 text-green-700 hover:bg-green-100">
                    Contactar por WhatsApp
                  </Button>
                </a>
              )}
              {!cancelStep ? (
                <Button
                  variant="outline"
                  className="w-full text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => { setCancelStep(true); setCancelReason(""); }}
                >
                  {/* En moda, cancelar antes de empaquetar = rechazar (sin stock, etc.) */}
                  {isRetail && (order.status === "new" || order.status === "confirmed") ? "Rechazar pedido" : "Cancelar pedido"}
                </Button>
              ) : (
                <div className="w-full border border-red-200 bg-red-50 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-red-700">
                    {isRetail && (order.status === "new" || order.status === "confirmed") ? "¿Por qué lo rechazás?" : "¿Por qué lo cancelás?"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {CANCEL_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setCancelReason(r)}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${cancelReason === r ? "bg-red-600 text-white border-red-600" : "bg-white text-red-700 border-red-200 hover:bg-red-100"}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <input
                    className="w-full text-xs border border-red-200 rounded-lg px-2 py-1.5 bg-white"
                    placeholder="Otros cambios (opcional)"
                    maxLength={200}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                      disabled={cancelReason.trim().length === 0}
                      onClick={() => { onAction(order, "cancelled", cancelReason.trim()); onClose(); }}
                    >
                      {isRetail && (order.status === "new" || order.status === "confirmed") ? "Rechazar" : "Confirmar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCancelStep(false)}>
                      Volver
                    </Button>
                  </div>
                  <p className="text-[10px] text-red-500/80">El motivo le llega al cliente con la notificación.</p>
                </div>
              )}
            </div>
          )}

          {/* Completed: reimprimir ticket (recibo) + facturar */}
          {isCompleted && !editing && (
            <div className="space-y-2 pt-2 border-t border-border">
              <FiscalBillButton orderId={order.id} />
              {canPrint ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={printing}
                  onClick={() => handlePrint("ticket")}
                >
                  {printing ? "🖨️ Imprimiendo..." : printStatus === "ok" ? "✅ Impreso" : printStatus === "error" ? "❌ Error al imprimir" : "🖨️ Reimprimir ticket"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full opacity-70"
                  onClick={() => { window.location.href = "/planes"; }}
                >
                  🖨️ Reimprimir ticket — Exclusivo plan Gestión
                </Button>
              )}
            </div>
          )}

          {/* Edit mode actions */}
          {editing && (
            <div className="space-y-2 pt-2">
              {saveError && (
                <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ❌ {saveError}
                </p>
              )}
              <Button
                className="w-full"
                disabled={saving || editItems.length === 0}
                onClick={() => handleSaveModification()}
              >
                {saving ? "Guardando..." : "Guardar cambios"}
              </Button>
              {!isCounterChannel && (
                <Button
                  variant="outline"
                  className="w-full border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                  disabled={saving || editItems.length === 0 || !customerPhone}
                  title={!customerPhone ? "El pedido no tiene teléfono del cliente" : undefined}
                  onClick={async () => {
                    const result = await handleSaveModification();
                    if (result.ok) sendModifiedWhatsApp();
                  }}
                >
                  Guardar y enviar WhatsApp al cliente
                </Button>
              )}
              <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
