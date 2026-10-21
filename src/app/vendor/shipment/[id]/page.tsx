"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Oblea A4 del envío extendido ("Portal 659 Envíos"): se imprime y se pega en
 * el paquete. Lleva QR al tracking público `/envio/[code]` + datos mínimos del
 * destino. La logística partner retira con esta oblea.
 */
export default function ObleaEnvioPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [shipment, setShipment] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [qr, setQr] = useState<string>("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/vendor/shipments/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Envío no encontrado");
          return;
        }
        setShipment(data.shipment);
        setEvents(data.events || []);
      } catch {
        setError("Error de conexión");
      }
    })();
  }, [id]);

  // QR al tracking público (la URL absoluta la arma el navegador).
  useEffect(() => {
    if (!shipment?.code) return;
    let alive = true;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = `${window.location.origin}/envio/${encodeURIComponent(shipment.code)}`;
        const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: "M" });
        if (alive) setQr(dataUrl);
      } catch {
        // sin QR igual se imprime el código en texto
      }
    })();
    return () => {
      alive = false;
    };
  }, [shipment?.code]);

  if (error) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }
  if (!shipment) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </main>
    );
  }

  const items: any[] = Array.isArray(shipment.items) ? shipment.items : [];

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: A4;margin: 12mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="no-print max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
        <a href="/vendor/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver al panel
        </a>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => window.print()}>🖨️ Imprimir oblea</Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto bg-white text-black rounded-xl sm:rounded-none p-8 mb-8 print:mb-0 print:rounded-none shadow print:shadow-none">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Oblea de envío · Portal 659</h1>
            <p className="text-sm text-neutral-600">Logística partner coordinada por Portal 659</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-neutral-600">Código de seguimiento</p>
            <p className="text-xl font-bold tracking-widest">{shipment.code}</p>
          </div>
        </div>

        {/* QR + destino */}
        <div className="flex gap-6 mb-5">
          <div className="flex-shrink-0 flex flex-col items-center">
            {qr ? (
              <img src={qr} alt={`QR ${shipment.code}`} className="w-44 h-44" />
            ) : (
              <div className="w-44 h-44 bg-neutral-100 rounded flex items-center justify-center text-xs text-neutral-500">
                QR no disponible
              </div>
            )}
            <p className="text-[11px] text-neutral-600 mt-1 text-center">
              Escaneá para seguir el envío
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Destino</p>
            <p className="text-sm">{shipment.order?.customer_name || "—"}</p>
            {shipment.order?.customer_phone && (
              <p className="text-sm text-neutral-600">Tel/WA: {shipment.order.customer_phone}</p>
            )}
            {shipment.order?.customer_address && (
              <p className="text-sm text-neutral-600">{shipment.order.customer_address}</p>
            )}
            <p className="text-sm text-neutral-600 mt-1">Zona: {shipment.shipping_zone_name || "Zona extendida"}</p>
            <p className="text-sm text-neutral-600 mt-1">
              Retiro: {shipment.store_name || ""}
            </p>
          </div>
        </div>

        {/* Contenido del paquete */}
        {items.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-bold mb-1">Contenido del paquete</p>
            <table className="w-full text-sm">
              <tbody>
                {items.map((it: any, i: number) => (
                  <tr key={i} className="border-b border-neutral-100">
                    <td className="py-1 pr-2 w-10">{it.qty}</td>
                    <td className="py-1">{it.name}</td>
                    <td className="py-1 text-right">${Number(it.price * it.qty).toLocaleString("es-AR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm font-bold text-right mt-1">
              Total: ${Number(shipment.order?.total || 0).toLocaleString("es-AR")}
            </p>
          </div>
        )}

        {/* Timeline chapita */}
        <div className="border-t border-neutral-300 pt-3">
          <p className="text-[11px] text-neutral-600 mb-1">Estados del envío</p>
          <div className="flex flex-wrap gap-1.5">
            {(events.length > 0 ? events : [{ status: shipment.status }]).map((e: any, i: number) => (
              <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full border ${e.status === "cancelled" ? "border-red-300 text-red-700" : "border-neutral-300 text-neutral-700"}`}>
                {e.status}
                {e.created_at ? ` · ${new Date(e.created_at).toLocaleDateString("es-AR")}` : ""}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-neutral-400 mt-2">
            El pedido {shipment.order?.order_number ? `#${shipment.order.order_number}` : ""} queda asociado en el panel del comercio.
          </p>
        </div>
      </div>
    </main>
  );
}
