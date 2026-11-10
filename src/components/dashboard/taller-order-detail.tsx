"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BookingCardProps } from "@/components/dashboard/booking-card";
import { isOrderBooking } from "@/lib/agenda";
import { equipmentLabel, orderEquipmentLabel, type Equipment } from "@/lib/equipment";
import { OrderEquipmentEditor } from "@/components/dashboard/order-equipment-editor";
import {
  accessorioPresetsFor,
  hasChecklistContent,
  normalizeChecklist,
  workOrderQuickActions,
  workOrderPrevState,
  workOrderStateLabel,
  workOrderStateTone,
  workOrderTitle,
  workOrderDatesLabel,
  workOrderDeliveryDue,
  type IntakeChecklist,
} from "@/lib/work-order";
import { money, orderCostSummary, type WorkOrderPart } from "@/lib/work-order-parts";

type EventRow = {
  id: string;
  kind: string;
  message: string;
  created_at: string;
  actor_name?: string | null;
};

type CatalogProduct = {
  id: string;
  name: string;
  price?: number | null;
  promo_price?: number | null;
  stock?: number | null;
  stock_control?: boolean | null;
};

const EVENT_ICON: Record<string, string> = {
  created: "📥",
  status: "🔄",
  diagnosis: "🔍",
  quote_linked: "🧾",
  quote_sent: "📤",
  quote_approved: "✅",
  parts: "🔩",
  payment: "💰",
  signature: "✍️",
  extended: "📅",
  note: "📝",
};

/**
 * Ficha de orden (job card) completa — el registro central del taller
 * (patrón RO App/Orderry: detailed order with event feed). Todo lo que pasó
 * y todo lo que se necesita, en una sola tarjeta: cliente, equipo, falla,
 * diagnóstico, checklist de ingreso, presupuesto, repuestos + mano de obra,
 * notas, actividad y acciones de entrega.
 *
 * Eventos y repuestos vienen de GET /api/vendor/bookings/[id]; sin la
 * migración v3 la ficha se ve igual pero sin esas secciones (tolerante).
 */
export function TallerOrderDetail({
  booking,
  bookingCardProps,
  partsCatalog = [],
  onClose,
  onEquipmentChanged,
}: {
  booking: any;
  bookingCardProps: Omit<BookingCardProps, "booking">;
  /** Catálogo de productos (repuestos) del comercio. */
  partsCatalog?: CatalogProduct[];
  onClose: () => void;
  /** Se guardó/cargó la ficha del equipo: recargar la lista de órdenes. */
  onEquipmentChanged?: () => void;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [parts, setParts] = useState<WorkOrderPart[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [eqJobs, setEqJobs] = useState<{ jobs: number; last_job_at: string | null } | null>(null);

  // Ediciones locales (se guardan con PATCH al confirmar).
  const [diagnosis, setDiagnosis] = useState(String(booking.diagnosis || ""));
  const [diagnosisDirty, setDiagnosisDirty] = useState(false);
  const [savingDiagnosis, setSavingDiagnosis] = useState(false);

  const [checklist, setChecklist] = useState<IntakeChecklist>(() =>
    normalizeChecklist(booking.intake_checklist)
  );
  const [showChecklist, setShowChecklist] = useState(hasChecklistContent(booking.intake_checklist));
  const [savingChecklist, setSavingChecklist] = useState(false);

  const [labor, setLabor] = useState(
    booking.labor_amount != null && Number(booking.labor_amount) > 0 ? String(booking.labor_amount) : ""
  );
  const [savingLabor, setSavingLabor] = useState(false);

  // Alta de repuesto.
  const [partQuery, setPartQuery] = useState("");
  const [partQty, setPartQty] = useState("1");
  const [partBusy, setPartBusy] = useState(false);
  const [partError, setPartError] = useState("");

  const isOrder = isOrderBooking(booking);
  const due = workOrderDeliveryDue(booking.delivery_date, booking.status);
  const orderDeclaredIssue = String(booking.declared_issue || "").trim();
  const [eqEditorOpen, setEqEditorOpen] = useState(false);
  // Presupuesto vinculado: la conexión orden ↔ presupuesto es solo del
  // vertical taller (servicios/estética la ocultan).
  const isTaller = (bookingCardProps.vendor as { vertical?: string } | null | undefined)?.vertical === "taller";
  const vendorCategory = (bookingCardProps.vendor as { category?: string } | null | undefined)?.category;
  const accessoryPresets = accessorioPresetsFor(vendorCategory);
  const [quoteLinkPick, setQuoteLinkPick] = useState("");
  const [quoteLinkBusy, setQuoteLinkBusy] = useState(false);
  const [quoteLinkMsg, setQuoteLinkMsg] = useState("");
  // La API devuelve los campos de equipo con prefijo equipment_* (LEFT JOIN en bookings/route.ts).
  // equipmentLabel espera brand, model, rodado, identifier, color sin prefijo.
  const equipmentData: Equipment = {
    id: booking.equipment_id,
    brand: booking.equipment_brand,
    model: booking.equipment_model,
    rodado: booking.equipment_rodado,
    identifier: booking.equipment_identifier,
    color: booking.equipment_color,
    notes: booking.equipment_notes,
  };

  async function loadDetail() {
    try {
      const res = await fetch(`/api/vendor/bookings/${booking.id}`);
      if (!res.ok) return;
      const d = await res.json();
      setEvents(Array.isArray(d.events) ? d.events : []);
      setParts(Array.isArray(d.parts) ? d.parts : []);
      if (d.booking?.diagnosis !== undefined) {
        setDiagnosis(String(d.booking.diagnosis || ""));
      }
      if (d.booking?.intake_checklist) setChecklist(normalizeChecklist(d.booking.intake_checklist));
      if (d.booking?.labor_amount != null) {
        setLabor(Number(d.booking.labor_amount) > 0 ? String(d.booking.labor_amount) : "");
      }
    } catch {
      /* sin red: la ficha sigue con lo que vino en la lista */
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    setLoaded(false);
    void loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id]);

  // Historial del equipo (conteo de trabajos) — best-effort.
  useEffect(() => {
    const eqId = String(booking.equipment_id || "");
    if (!eqId) return;
    (async () => {
      try {
        const res = await fetch(`/api/vendor/equipment?id=${encodeURIComponent(eqId)}`);
        if (!res.ok) return;
        const d = await res.json();
        const row = (d.equipment || [])[0];
        if (row) setEqJobs({ jobs: Number(row.jobs) || 0, last_job_at: row.last_job_at || null });
      } catch { /* sin historial, no pasa nada */ }
    })();
  }, [booking.equipment_id]);

  async function saveDiagnosis() {
    setSavingDiagnosis(true);
    try {
      const res = await fetch(`/api/vendor/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diagnosis }),
      });
      if (res.ok) setDiagnosisDirty(false);
      await loadDetail();
    } finally {
      setSavingDiagnosis(false);
    }
  }

  async function saveChecklist(next: IntakeChecklist) {
    setChecklist(next);
    setSavingChecklist(true);
    try {
      await fetch(`/api/vendor/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake_checklist: next }),
      });
      await loadDetail();
    } finally {
      setSavingChecklist(false);
    }
  }

  async function saveLabor() {
    setSavingLabor(true);
    try {
      await fetch(`/api/vendor/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labor_amount: labor.trim() ? Number(labor) : null }),
      });
      await loadDetail();
    } finally {
      setSavingLabor(false);
    }
  }

  async function addPart(product: CatalogProduct) {
    setPartBusy(true);
    setPartError("");
    const qty = Number(partQty) > 0 ? Number(partQty) : 1;
    try {
      const res = await fetch(`/api/vendor/bookings/${booking.id}/parts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: product.id, qty }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo agregar el repuesto");
      setPartQuery("");
      setPartQty("1");
      await loadDetail();
    } catch (e) {
      setPartError(e instanceof Error ? e.message : "No se pudo agregar el repuesto");
    } finally {
      setPartBusy(false);
    }
  }

  async function removePart(partId: string) {
    setPartBusy(true);
    setPartError("");
    try {
      const res = await fetch(`/api/vendor/bookings/${booking.id}/parts?partId=${encodeURIComponent(partId)}`, {
        method: "DELETE",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || "No se pudo quitar el repuesto");
      await loadDetail();
    } catch (e) {
      setPartError(e instanceof Error ? e.message : "No se pudo quitar el repuesto");
    } finally {
      setPartBusy(false);
    }
  }

  const summary = useMemo(
    () => orderCostSummary({ parts, laborAmount: Number(labor) || 0, quotedPrice: booking.service_price }),
    [parts, labor, booking.service_price]
  );

  const matches = useMemo(() => {
    const q = partQuery.trim().toLowerCase();
    if (!q) return [];
    return partsCatalog
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [partQuery, partsCatalog]);

  if (!isOrder) return null;
  const quickActions = workOrderQuickActions(booking.status);
  const canCobrar = booking.status !== "cancelled" && booking.status !== "completed";

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[61] w-full sm:max-w-2xl sm:mx-4 max-h-[92vh] sm:max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        {/* Cabecera */}
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-base font-bold">{workOrderTitle(booking.work_order_no)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${workOrderStateTone(booking.status)}`}>
                  {workOrderStateLabel(booking.status)}
                </span>
                {booking.is_preview && (
                  <span className="rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-semibold">🧪 PRUEBA</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {workOrderDatesLabel(booking.booking_date, booking.delivery_date) || "sin fecha de entrega"}
                {due && <span className={`ml-2 font-medium ${due.tone.startsWith("text-red") ? "text-red-600" : "text-amber-600"}`}>· {due.text}</span>}
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-7" onClick={onClose}>
              Cerrar
            </Button>
          </div>
          {/* Retroceder al estado anterior */}
          {workOrderPrevState(booking.status) && (
            <div className="flex flex-wrap gap-1 mt-2">
              <button
                type="button"
                onClick={() => bookingCardProps.handleUpdateBookingStatus(booking.id, workOrderPrevState(booking.status)!)}
                className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                ← Retroceder
              </button>
            </div>
          )}
          {/* Avance saltable: un toque lleva a cualquier estado posterior */}
          {quickActions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {quickActions.map((a) => (
                <button
                  key={a.to}
                  type="button"
                  onClick={() => bookingCardProps.handleUpdateBookingStatus(booking.id, a.to)}
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cuerpo */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          {/* Cliente + equipo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-muted/30 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Cliente</p>
              <p className="font-medium truncate">{booking.customer_name || "Sin nombre"}</p>
              {booking.customer_phone && (
                <a
                  href={`https://wa.me/${String(booking.customer_phone).replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-green-600 font-medium hover:underline"
                >
                  📲 {booking.customer_phone}
                </a>
              )}
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Equipo</p>
                <button
                  type="button"
                  onClick={() => setEqEditorOpen(true)}
                  className="mb-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted"
                  title={orderEquipmentLabel(booking as never) ? "Editar la ficha del equipo" : "Cargar la ficha del equipo"}
                >
                  {orderEquipmentLabel(booking as never) ? "✏️ Editar" : "＋ Cargar ficha"}
                </button>
              </div>
              <p className="font-medium truncate">{equipmentLabel(equipmentData) || "Sin ficha de equipo"}</p>
              {!equipmentLabel(equipmentData) && orderDeclaredIssue && (
                <p className="text-[11px] text-muted-foreground truncate">Falla: {orderDeclaredIssue}</p>
              )}
              {eqJobs && (
                <p className="text-[11px] text-muted-foreground">
                  {eqJobs.jobs} trabajo{eqJobs.jobs === 1 ? "" : "s"}
                  {eqJobs.last_job_at ? ` · último ${new Date(eqJobs.last_job_at).toLocaleDateString("es-AR")}` : ""}
                </p>
              )}
            </div>
          </div>

          {booking.equipment_photo_url && (
            <div className="overflow-hidden rounded-xl border border-border">
              <img src={String(booking.equipment_photo_url)} alt="Foto de recepción del equipo" className="max-h-44 w-full object-cover" />
              <p className="bg-card px-2 py-1 text-[10px] text-muted-foreground">📷 Foto de recepción</p>
            </div>
          )}

          {/* Falla + diagnóstico */}
          <div className="space-y-2">
            <div className="rounded-xl border border-border p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Falla declarada</p>
              <p className="text-sm">{String(booking.declared_issue || "—")}</p>
            </div>
            <div className="rounded-xl border border-border p-2.5 space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Diagnóstico {booking.status === "pending" && <span className="normal-case font-normal text-muted-foreground">(guardalo al pasar a Diagnosticada)</span>}
              </Label>
              <Textarea
                value={diagnosis}
                onChange={(e) => {
                  setDiagnosis(e.target.value);
                  setDiagnosisDirty(true);
                }}
                rows={2}
                placeholder="Qué encontraste y qué hay que hacer"
                className="text-sm"
              />
              {diagnosisDirty && (
                <Button size="sm" className="h-7 text-xs" disabled={savingDiagnosis} onClick={saveDiagnosis}>
                  {savingDiagnosis ? "Guardando..." : "Guardar diagnóstico"}
                </Button>
              )}
            </div>
          </div>

          {/* Checklist de ingreso (opcional) */}
          <div className="rounded-xl border border-border p-2.5">
            {!showChecklist && !hasChecklistContent(checklist) ? (
              <button
                type="button"
                className="text-xs text-primary font-medium hover:underline"
                onClick={() => setShowChecklist(true)}
              >
                ＋ Agregar checklist de ingreso (accesorios, contraseña, estado)
              </button>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Checklist de ingreso</p>
                <div className="flex flex-wrap gap-1">
                  {accessoryPresets.map((a) => {
                    const on = (checklist.accessories || []).includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        disabled={savingChecklist}
                        onClick={() => {
                          const cur = checklist.accessories || [];
                          const next = on ? cur.filter((x) => x !== a) : [...cur, a];
                          void saveChecklist({ ...checklist, accessories: next });
                        }}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    value={checklist.other || ""}
                    onChange={(e) => setChecklist({ ...checklist, other: e.target.value })}
                    onBlur={() => void saveChecklist(checklist)}
                    placeholder="Otros accesorios (libre)"
                    className="h-8 text-xs"
                  />
                  <Input
                    value={checklist.unlock || ""}
                    onChange={(e) => setChecklist({ ...checklist, unlock: e.target.value })}
                    onBlur={() => void saveChecklist(checklist)}
                    placeholder="🔑 Contraseña / patrón (solo interno)"
                    className="h-8 text-xs"
                  />
                </div>
                <Input
                  value={checklist.condition || ""}
                  onChange={(e) => setChecklist({ ...checklist, condition: e.target.value })}
                  onBlur={() => void saveChecklist(checklist)}
                  placeholder="Estado al recibir (rayones, golpes, falta algo...)"
                  className="h-8 text-xs"
                />
                {savingChecklist && <p className="text-[10px] text-muted-foreground">Guardando...</p>}
              </div>
            )}
          </div>

          {/* Presupuesto vinculado (solo vertical taller) */}
          {isTaller && (() => {
            const quotes = (bookingCardProps.orderQuotes || []) as any[];
            const linked = quotes.find((q: any) => String(q?.id) === String(booking.quote_id || "")) || null;
            const phoneDigits = String(booking.customer_phone || "").replace(/\D/g, "").slice(-10);
            const linkable = quotes.filter(
              (q: any) => q.status === "accepted" && !q.booking_id && !q.is_preview &&
                String(q.customer_phone || "").replace(/\D/g, "").slice(-10) === phoneDigits
            );
            const quoteStatusLabel: Record<string, string> = {
              pending: "Pendiente",
              responded: "Respondido",
              accepted: "Aceptado",
              cancelled: "Descartado",
            };

            async function linkQuote(quoteId: string) {
              setQuoteLinkBusy(true);
              setQuoteLinkMsg("");
              try {
                const res = await fetch(`/api/vendor/bookings/${booking.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ quote_id: quoteId }),
                });
                if (!res.ok) throw new Error("No se pudo vincular el presupuesto");
                onEquipmentChanged?.();
                setQuoteLinkMsg("Presupuesto vinculado ✅");
                await loadDetail();
              } catch (e) {
                setQuoteLinkMsg(e instanceof Error ? e.message : "No se pudo vincular");
              } finally {
                setQuoteLinkBusy(false);
              }
            }

            async function unlinkQuote() {
              if (!window.confirm("¿Desvincular el presupuesto de esta orden?")) return;
              setQuoteLinkBusy(true);
              setQuoteLinkMsg("");
              try {
                const res = await fetch(`/api/vendor/bookings/${booking.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ quote_id: null }),
                });
                if (!res.ok) throw new Error("No se pudo desvincular el presupuesto");
                onEquipmentChanged?.();
                setQuoteLinkMsg("Presupuesto desvinculado");
                await loadDetail();
              } catch (e) {
                setQuoteLinkMsg(e instanceof Error ? e.message : "No se pudo desvincular");
              } finally {
                setQuoteLinkBusy(false);
              }
            }

            return (
              <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 mb-1">Presupuesto</p>
                {linked ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{linked.description || "Sin descripción"}</p>
                    <p className="text-xs text-muted-foreground">
                      {linked.service_name ? `${linked.service_name} · ` : ""}
                      {linked.preferred_date || "Sin fecha"}{linked.preferred_time ? ` ${linked.preferred_time}` : ""}
                      {" · "}
                      <span className="font-medium">{quoteStatusLabel[linked.status] || linked.status}</span>
                    </p>
                    {linked.quoted_price != null && (
                      <p className="text-sm">
                        💰 Cotizado: <strong>${Number(linked.quoted_price).toLocaleString("es-AR")}</strong>
                      </p>
                    )}
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {bookingCardProps.onQuoteOrder && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            const linkedQuotes = ((bookingCardProps.orderQuotes || []) as any[]).filter(
                              (q: any) => String(q?.booking_id || "") === String(booking.id)
                            );
                            if (linkedQuotes.length > 0) {
                              const ok = window.confirm(
                                `Esta orden ya tiene ${linkedQuotes.length} presupuesto(s) vinculado(s). ¿Crear uno nuevo y desvincular el actual?`
                              );
                              if (!ok) return;
                              // desvincular el actual antes de crear el nuevo
                              void fetch(`/api/vendor/bookings/${booking.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ quote_id: null }),
                              });
                            }
                            bookingCardProps.onQuoteOrder!(booking);
                          }}
                        >
                          💰 Presupuestar
                        </Button>
                      )}
                      {linked && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/vendor/bookings/${booking.id}/import-quote`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ quote_id: linked.id }),
                              });
                              if (!res.ok) throw new Error("No se pudo importar");
                              await loadDetail();
                              onEquipmentChanged?.();
                            } catch (e) {
                              alert(e instanceof Error ? e.message : "No se pudo importar");
                            }
                          }}
                        >
                          📥 Pasar a cuenta
                        </Button>
                      )}
                      {(() => {
                        const allLinked = ((bookingCardProps.orderQuotes || []) as any[]).filter(
                          (q: any) => String(q?.booking_id || "") === String(booking.id)
                        );
                        if (allLinked.length <= 1) return null;
                        return (
                          <div className="w-full mt-1.5 space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">Historial de presupuestos de esta orden</p>
                            {allLinked.map((q: any) => (
                              <div key={q.id} className="flex items-center justify-between gap-2 text-[11px] rounded-md border border-violet-100 bg-white/50 px-2 py-1">
                                <span className="min-w-0 flex-1 truncate">
                                  {q.service_name || q.description || "Presupuesto"} · ${Number(q.quoted_price || 0).toLocaleString("es-AR")}
                                </span>
                                <span className="shrink-0 text-muted-foreground">{q.status}</span>
                                <Link href={`/vendor/presupuesto/${q.id}`} target="_blank" className="shrink-0 text-primary hover:underline">
                                  Ver
                                </Link>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      {bookingCardProps.onSendOrderQuote && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => bookingCardProps.onSendOrderQuote!(booking)}>
                          📲 Enviar por WhatsApp
                        </Button>
                      )}
                      <Link href={`/vendor/presupuesto/${linked.id}`} target="_blank" className="inline-flex items-center h-7 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted">
                        🧾 Ver presupuesto
                      </Link>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-muted-foreground" disabled={quoteLinkBusy} onClick={() => void unlinkQuote()}>
                        Desvincular
                      </Button>
                    </div>
                  </div>
                ) : linkable.length > 0 ? (
                  <div className="space-y-1.5">
                    <select
                      value={quoteLinkPick}
                      onChange={(e) => setQuoteLinkPick(e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="">Vincular un presupuesto aceptado…</option>
                      {linkable.map((q: any) => (
                        <option key={q.id} value={q.id}>
                          {(q.service_name || q.description || "Presupuesto").slice(0, 60)}
                          {q.quoted_price != null ? ` · $${Number(q.quoted_price).toLocaleString("es-AR")}` : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={!quoteLinkPick || quoteLinkBusy}
                      onClick={() => quoteLinkPick && void linkQuote(quoteLinkPick)}
                    >
                      {quoteLinkBusy ? "Vinculando..." : "Vincular"}
                    </Button>
                    {bookingCardProps.onQuoteOrder && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => bookingCardProps.onQuoteOrder!(booking)}>
                        💰 Presupuestar
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Sin presupuesto vinculado.</p>
                    {bookingCardProps.onQuoteOrder && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => bookingCardProps.onQuoteOrder!(booking)}>
                        💰 Presupuestar
                      </Button>
                    )}
                  </div>
                )}
                {quoteLinkMsg && (
                  <p className={`text-[11px] mt-1 ${quoteLinkMsg.includes("✅") ? "text-green-700" : "text-muted-foreground"}`}>
                    {quoteLinkMsg}
                  </p>
                )}
              </div>
            );
          })()}

          {/* Repuestos + mano de obra */}
          <div className="rounded-xl border border-border p-2.5 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Repuestos y mano de obra</p>

            {parts.length > 0 && (
              <div className="space-y-1">
                {parts.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name || "Repuesto"}</span>
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">× {p.qty}</span>
                    <span className="tabular-nums whitespace-nowrap">${money((Number(p.unit_price) || 0) * (Number(p.qty) || 0))}</span>
                    <button
                      type="button"
                      disabled={partBusy}
                      onClick={() => void removePart(p.id)}
                      className="text-muted-foreground hover:text-red-600"
                      title="Quitar (repone stock)"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Buscador de repuesto */}
            <div className="relative">
              <Input
                value={partQuery}
                onChange={(e) => setPartQuery(e.target.value)}
                placeholder="＋ Agregar repuesto del catálogo (buscá por nombre)"
                className="h-8 text-xs"
                disabled={partBusy}
              />
              {matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
                  {matches.map((p) => {
                    const stock = p.stock_control ? Number(p.stock ?? 0) : null;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={partBusy}
                        onClick={() => void addPart(p)}
                        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/50"
                      >
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                          {stock != null ? (stock > 0 ? `${stock} en stock` : "sin stock") : ""}
                          {" · "}${Number(p.promo_price ?? p.price ?? 0).toLocaleString("es-AR")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={partQty}
                onChange={(e) => setPartQty(e.target.value)}
                inputMode="decimal"
                className="h-8 w-16 text-xs"
                placeholder="Cant."
              />
              <Input
                value={labor}
                onChange={(e) => setLabor(e.target.value)}
                onBlur={() => void saveLabor()}
                inputMode="decimal"
                className="h-8 flex-1 text-xs"
                placeholder="Mano de obra ($) — se guarda al salir del campo"
              />
            </div>

            {partError && <p className="text-xs text-red-600">{partError}</p>}

            {/* Resumen de costo/margen */}
            {(parts.length > 0 || Number(labor) > 0 || Number(booking.service_price) > 0) && (
              <div className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Repuestos (costo)</span>
                  <span className="tabular-nums">${money(summary.partsCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mano de obra</span>
                  <span className="tabular-nums">${money(summary.labor)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{Number(booking.service_price) > 0 ? `Presupuestado` : "Cobro estimado"}</span>
                  <span className="tabular-nums">${money(summary.revenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margen estimado</span>
                  <span className={`tabular-nums ${summary.margin < 0 ? "text-red-600" : "text-green-700"}`}>
                    ${money(summary.margin)}
                  </span>
                </div>
               <Button
                 size="sm"
                 variant="outline"
                 className="h-7 text-xs w-full mt-1.5"
                 onClick={async () => {
                   const newTotal = Math.round((summary.partsPrice + summary.labor) * 100) / 100;
                   try {
                     const res = await fetch(`/api/vendor/bookings/${booking.id}`, {
                       method: "PATCH",
                       headers: { "Content-Type": "application/json" },
                       body: JSON.stringify({ service_price: newTotal }),
                     });
                     if (!res.ok) throw new Error("No se pudo actualizar");
                     await loadDetail();
                     onEquipmentChanged?.();
                   } catch (e) {
                     alert(e instanceof Error ? e.message : "No se pudo actualizar");
                   }
                 }}
               >
                 Recalcular total desde partidas
               </Button>
              </div>
            )}
          </div>

          {/* Notas */}
          {booking.notes && (
            <p className="text-xs text-muted-foreground italic rounded-xl border border-border bg-muted/20 p-2.5">
              📝 {String(booking.notes)}
            </p>
          )}

          {/* Actividad (event feed) */}
          <div className="rounded-xl border border-border p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Actividad</p>
            {!loaded ? (
              <p className="text-xs text-muted-foreground">Cargando actividad...</p>
            ) : events.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin eventos registrados todavía.</p>
            ) : (
              <div className="space-y-1">
                {(showAllEvents ? events : events.slice(0, 5)).map((ev) => (
                  <div key={ev.id} className="flex items-start gap-2 text-xs">
                    <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
                      {String(ev.created_at || "").slice(11, 16) || "—"}
                    </span>
                    <span className="shrink-0">{EVENT_ICON[ev.kind] || "•"}</span>
                    <span className="min-w-0 flex-1">{ev.message}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {String(ev.created_at || "").slice(8, 10)}/{String(ev.created_at || "").slice(5, 7)}
                    </span>
                  </div>
                ))}
                {events.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllEvents((v) => !v)}
                    className="text-[11px] text-primary font-medium hover:underline mt-1"
                  >
                    {showAllEvents ? "Ver menos" : `Ver todo el historial (${events.length})`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Pie: acciones de entrega */}
        <div className="shrink-0 border-t border-border bg-card px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {canCobrar && bookingCardProps.onCobroBooking && (
              <Button size="sm" className="flex-1 h-8 text-xs" onClick={() => bookingCardProps.onCobroBooking!(booking.id)}>
                {booking.status === "ready" ? "💰 Entregar y cobrar" : "💰 Cobrar"}
              </Button>
            )}
            {bookingCardProps.onPrintOrden && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => bookingCardProps.onPrintOrden!(booking.id)}>
                🖨️ Comprobante
              </Button>
            )}
            {bookingCardProps.onPrintEtiqueta && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => bookingCardProps.onPrintEtiqueta!(booking.id)}>
                🏷️ Etiqueta
              </Button>
            )}
            {bookingCardProps.onExtendDelivery && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => bookingCardProps.onExtendDelivery!(booking)}>
                📅 Prorrogar
              </Button>
            )}
            {bookingCardProps.onEditBooking && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => {
                  onClose();
                  bookingCardProps.onEditBooking!(booking);
                }}
              >
                ✏️ Editar
              </Button>
            )}
          </div>
        </div>
      </div>

      {eqEditorOpen && (
        <OrderEquipmentEditor
          order={booking}
          onClose={() => setEqEditorOpen(false)}
          onSaved={async () => {
            onEquipmentChanged?.();
            setLoaded(false);
            await loadDetail();
          }}
        />
      )}
    </div>
  );
}
