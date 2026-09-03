"use client";

import { useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { Order, OrderStatus, OrderItem, Product as DBProduct } from "@/types/database";

function getActionButtonLabel(next: OrderStatus, order: Order, isModa: boolean): string {
  // Mostrador/mesa saltean "preparar": del estado nuevo pasan a "Listo p/ entregar".
  if (order.status === "new" && (order.channel === "mostrador" || order.channel === "mesa")) {
    return `✅ ${orderReadyLabel(order)}`;
  }
  // Moda: el primer paso es aceptar/rechazar (control de stock); después se empaqueta.
  if (order.status === "new") return isModa ? "✓ Aceptar pedido" : "Aceptar y empezar a preparar";
  if (order.status === "confirmed") return isModa ? "📦 Empezar a empaquetar" : "Empezar a preparar";
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

type Props = {
  order: Order;
  vendorName: string;
  onClose: () => void;
  onAction: (order: Order, status: OrderStatus) => void;
  onModify?: (orderId: string, items: OrderItem[], modificationNotes: string) => Promise<{ ok: boolean; error?: string }>;
  offers?: DBProduct[];
  canPrint?: boolean;
  transfer?: { alias: string | null; cbu: string | null; holder: string | null };
  blockUnpaid?: boolean;
  onMarkPaid?: (orderId: string) => void;
  isModa?: boolean;
};

export default function OrderDetailModal({ order, vendorName, onClose, onAction, onModify, offers = [], canPrint = true, transfer, blockUnpaid = false, onMarkPaid, isModa = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<OrderItem[]>([]);
  const [modNotes, setModNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<"ok" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isCancelled = order.status === "cancelled";
  const isCompleted = order.status === "completed";
  const isTerminal = isCancelled || isCompleted;
  const canModify = order.status === "new" && !isTerminal;
  const STEP_ORDER = flowSteps(isModa);
  const statusIdx = STEP_ORDER.indexOf(order.status as OrderStatus);
  const nextStatus = nextStatusFor(order.status as OrderStatus, order.method, isModa, order.channel);

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

  const contextualWa = isCounterChannel ? null : buildContextualWhatsApp(order, vendorName, transfer, () => transferInstructions, isModa);
  const isBlockedByPayment = blockUnpaid && isTransferAppPending;

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

  const removeItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addProduct = (product: DBProduct) => {
    setEditItems((prev) => [
      ...prev,
      {
        product_id: product.id,
        name: product.name,
        price: product.promo_price ?? product.price,
        qty: 1,
        modifiers: [],
      },
    ]);
  };

  const availableProducts = offers.filter(
    (p) =>
      p.available &&
      !editItems.some((i) => i.product_id === p.id) &&
      p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const newTotal = editItems.reduce((sum, item) => {
    const modPrice = item.modifiers?.reduce((s, m) => s + (typeof m === "object" ? 0 : 0), 0) || 0;
    return sum + (item.price + modPrice) * item.qty;
  }, 0);

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
      items: editItems,
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

  async function handlePrint() {
    setPrinting(true);
    setPrintStatus(null);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
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
  const elapsed = Math.floor((Date.now() - created.getTime()) / 60000);

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
            <span className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8)}</span>
            <Badge className={ORDER_STATUS_COLORS[order.status as OrderStatus]}>
              {order.status === "ready" ? orderReadyLabel(order) : statusLabel(order.status as OrderStatus, isModa)}
            </Badge>
            {order.modification_notes && !editing && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">Editado</Badge>
            )}
            {isTransferAppPending && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-700">🕐 Pago pendiente</Badge>
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
          </div>

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
                          {step === "ready" ? orderReadyLabel(order) : statusLabel(step, isModa)}
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
            </div>
          )}

          {/* Items - View mode */}
          {!editing && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Productos</h3>
              <div className="space-y-1.5">
                {(order.items || []).map((item, i) => (
                  <div key={i} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-bold">{item.qty}x</span> {item.name}
                      </p>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/70 pl-5">
                          ({item.modifiers.join(", ")})
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-medium whitespace-nowrap">
                      ${(item.price * item.qty).toLocaleString("es-AR")}
                    </span>
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
                      <p className="text-[10px] text-muted-foreground">${item.price.toLocaleString("es-AR")} c/u</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => updateItemQty(i, item.qty - 1)}
                        className="w-7 h-7 rounded-lg border border-border bg-muted flex items-center justify-center text-sm font-bold"
                      >
                        -
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{item.qty}</span>
                      <button
                        onClick={() => updateItemQty(i, item.qty + 1)}
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
                  placeholder="Ej: Pizza no disponible, se reemplazo por empanadas..."
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
            </div>
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
                <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-xs space-y-1.5">
                  <p className="font-semibold">🕐 Pago pendiente ({order.payment_status})</p>
                  <p className="text-amber-700">
                    Transferí los datos al cliente y confirmá el depósito antes de avanzar.
                  </p>
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
                isBlockedByPayment ? (
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
                      {getActionButtonLabel(nextStatus, order, isModa)} — esperando pago
                    </button>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => { onAction(order, nextStatus); onClose(); }}
                  >
                    {getActionButtonLabel(nextStatus, order, isModa)}
                  </Button>
                )
              )}
              {order.status !== "new" && orderNeedsKitchen(order) && (
                <>
                  {canPrint ? (
                    <button
                      onClick={handlePrint}
                      disabled={printing}
                      className={`w-full h-10 rounded-xl font-bold text-sm border active:scale-[0.98] transition-all ${
                        printStatus === "ok"
                          ? "bg-green-50 text-green-700 border-green-300"
                          : printStatus === "error"
                          ? "bg-red-50 text-red-600 border-red-300"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {printing ? "🖨️ Imprimiendo..." : printStatus === "ok" ? "✅ Impreso" : printStatus === "error" ? "❌ Error al imprimir" : "🖨️ Imprimir comanda"}
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
                      Imprimir comanda — Exclusivo plan Gestión
                    </button>
                  )}
                  {!canPrint && (
                    <p className="text-[11px] text-center text-muted-foreground">
                      Actualizá a <a href="/planes" className="text-primary font-medium underline">Gestión integral</a> para imprimir comandas
                    </p>
                  )}
                </>
              )}
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
              <Button
                variant="outline"
                className="w-full text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => { onAction(order, "cancelled"); onClose(); }}
              >
                {/* En moda, cancelar antes de empaquetar = rechazar (sin stock, etc.) */}
                {isModa && (order.status === "new" || order.status === "confirmed") ? "Rechazar pedido" : "Cancelar pedido"}
              </Button>
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
