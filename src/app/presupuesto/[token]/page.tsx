"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { workOrderStateLabel, WORK_ORDER_FLOW } from "@/lib/work-order";

/**
 * Página pública del presupuesto (/presupuesto/[token]): el mismo contenido
 * del impreso A4 (partidas incluidas). Antes de aceptar muestra el botón
 * ✅ Aceptar; después pasa a modo seguimiento: estado de la orden vinculada
 * (Recibida → … → Lista para retirar), refrescado al recargar.
 */
type PublicQuote = {
  id: string;
  status: string;
  customer_name: string | null;
  service_name: string | null;
  description: string | null;
  preferred_date: string | null;
  quoted_price: number | null;
  deposit_pct: number | null;
  deposit_amount: number | null;
  created_at: string;
  accepted_at: string | null;
  equipment_kind: string | null;
  equipment_brand: string | null;
  equipment_model: string | null;
  equipment_identifier: string | null;
  equipment_rodado: number | string | null;
  equipment_color: string | null;
};

type PublicItem = { id: string; kind: string | null; description: string | null; qty: number | string; unit_price: number | string };

type PublicOrder = { status: string; work_order_no: number | null; delivery_date: string | null } | null;

type Data = {
  quote: PublicQuote;
  items: PublicItem[];
  vendor: { store_name: string | null; address: string | null; phone: string | null; whatsapp: string | null; vertical: string | null };
  order: PublicOrder;
};

const fdate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("es-AR") : "";

export default function PresupuestoPublicPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");

  const load = async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/presupuesto/${token}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error || "Presupuesto no encontrado");
        return;
      }
      setData(d as Data);
    } catch {
      setError("Error de conexión");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/presupuesto/${token}/accept`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok && !d?.already) {
        setOkMsg(d?.error || "No se pudo aceptar");
      } else {
        setOkMsg(d?.already ? "Ya lo habías aceptado." : "¡Listo! El taller quedó avisado.");
      }
      await load();
    } catch {
      setOkMsg("Error de conexión");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <main className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </main>
    );
  }

  const { quote, items, vendor, order } = data;
  const total = items.length > 0
    ? items.reduce((s, it) => s + Number(it.qty) * Number(it.unit_price), 0)
    : Number(quote.quoted_price) || 0;
  const canAccept = quote.status === "pending" || quote.status === "responded";
  const accepted = quote.status === "accepted" || quote.status === "cobrado";
  const waPhone = String(vendor.whatsapp || vendor.phone || "").replace(/\D/g, "");
  const flowIdx = order ? (WORK_ORDER_FLOW as readonly string[]).indexOf(order.status) : -1;

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-2xl mx-auto bg-white text-black rounded-xl p-6 sm:p-8 my-4 sm:my-8 shadow">
        <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold">{vendor.store_name || ""}</h1>
            {vendor.address && <p className="text-sm text-neutral-600">{vendor.address}</p>}
            {[vendor.phone, vendor.whatsapp].filter(Boolean).join(" · ") !== "" && (
              <p className="text-sm text-neutral-600">{[vendor.phone, vendor.whatsapp].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-bold">PRESUPUESTO</p>
            <p className="text-sm text-neutral-600">{fdate(quote.created_at)}</p>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-sm font-bold">Cliente</p>
          <p>{quote.customer_name}</p>
          {quote.equipment_kind && (quote.equipment_brand || quote.equipment_model || quote.equipment_identifier) && (
            <p className="text-sm text-neutral-600">
              🚲 Equipo: {[quote.equipment_brand, quote.equipment_model].filter(Boolean).join(" ")}
              {quote.equipment_rodado ? ` · Rodado ${quote.equipment_rodado}` : ""}
              {quote.equipment_identifier ? ` · N° ${quote.equipment_identifier}` : ""}
              {quote.equipment_color ? ` · ${quote.equipment_color}` : ""}
            </p>
          )}
          {quote.service_name && !quote.equipment_kind && (
            <p className="text-sm text-neutral-600">{vendor.vertical === "taller" ? "Equipo" : "Servicio"}: {quote.service_name}</p>
          )}
          {quote.preferred_date && <p className="text-sm text-neutral-600">Fecha estimada: {quote.preferred_date}</p>}
        </div>

        {quote.description && <p className="text-sm mb-4 whitespace-pre-wrap">{quote.description}</p>}

        {items.length > 0 && (
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                <th className="py-1 pr-2">Cant</th>
                <th className="py-1 pr-2">Descripción</th>
                <th className="py-1 pr-2 text-right">P. Unit</th>
                <th className="py-1 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-neutral-100">
                  <td className="py-1 pr-2">{it.qty}</td>
                  <td className="py-1 pr-2">
                    {it.kind === "labor" ? "Mano de obra: " : it.kind === "repuesto" ? "Repuesto: " : ""}
                    {it.description}
                  </td>
                  <td className="py-1 pr-2 text-right">${Number(it.unit_price).toLocaleString("es-AR")}</td>
                  <td className="py-1 text-right">${(Number(it.qty) * Number(it.unit_price)).toLocaleString("es-AR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-right text-xl font-bold mb-2">TOTAL: ${Number(total).toLocaleString("es-AR")}</p>
        {quote.deposit_amount != null && Number(quote.deposit_amount) > 0 && (
          <p className="text-right text-sm font-bold mb-2">
            Seña ({quote.deposit_pct ?? ""}%): ${Number(quote.deposit_amount).toLocaleString("es-AR")}
          </p>
        )}
        <p className="text-xs text-neutral-500 mt-4">
          Sin compromiso. Validez: 5 días. Este documento no es comprobante fiscal.
        </p>

        {/* Aceptar */}
        <div className="mt-5 border-t border-neutral-200 pt-4">
          {quote.status === "cancelled" && (
            <p className="text-sm text-neutral-600">Este presupuesto fue cancelado. Consultá con el comercio.</p>
          )}
          {canAccept && (
            <div className="space-y-2">
              <Button size="lg" className="w-full" onClick={accept} disabled={busy}>
                {busy ? "Enviando..." : "✅ Aceptar presupuesto"}
              </Button>
              <p className="text-xs text-neutral-500 text-center">
                Al aceptar avisás al taller y el trabajo queda aprobado para empezar.
              </p>
            </div>
          )}
          {accepted && (
            <p className="text-sm font-semibold text-green-700">
              ✅ Presupuesto aceptado{quote.accepted_at ? ` el ${fdate(quote.accepted_at)}` : ""}
            </p>
          )}
          {okMsg && <p className="text-xs text-neutral-600 mt-2">{okMsg}</p>}
          {waPhone.length >= 8 && (
            <a
              href={`https://wa.me/${waPhone}?text=${encodeURIComponent(`Hola ${vendor.store_name || ""}! Sobre el presupuesto de mi equipo:`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 text-sm text-green-700 hover:underline"
            >
              💬 Escribir por WhatsApp
            </a>
          )}
        </div>

        {/* Seguimiento (solo con orden vinculada) */}
        {order && (accepted || order.status) && (
          <div className="mt-5 border-t border-neutral-200 pt-4">
            <p className="text-sm font-bold mb-2">
              🛠️ Estado de tu trabajo
              {order.work_order_no ? ` · N° ${order.work_order_no}` : ""}
            </p>
            {order.status === "cancelled" ? (
              <p className="text-sm text-neutral-600">El trabajo fue cancelado. Consultá con el comercio.</p>
            ) : flowIdx >= 0 ? (
              <ol className="space-y-1.5">
                {(WORK_ORDER_FLOW as readonly string[]).map((st, i) => (
                  <li key={st} className={`text-sm flex items-center gap-2 ${i <= flowIdx ? "font-semibold" : "text-neutral-400"}`}>
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${i <= flowIdx ? "bg-green-600" : "bg-neutral-300"}`} />
                    {workOrderStateLabel(st)}
                    {i === flowIdx && <span className="text-[10px] font-bold text-green-700">← hoy</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-neutral-600">{workOrderStateLabel(order.status)}</p>
            )}
            {order.delivery_date && flowIdx >= 0 && flowIdx < (WORK_ORDER_FLOW as readonly string[]).indexOf("completed") && (
              <p className="text-xs text-neutral-600 mt-2">Entrega estimada: {fdate(order.delivery_date)}</p>
            )}
            <p className="text-xs text-neutral-400 mt-2">Esta página se actualiza cuando el taller avanza el trabajo.</p>
          </div>
        )}

        <p className="text-xs text-neutral-400 mt-6">Emitido con Portal 659</p>
      </div>
    </main>
  );
}
