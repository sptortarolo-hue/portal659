"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Eye, EyeOff, ExternalLink, Pencil, Loader2 } from "lucide-react";

type AdminUser = { id: string; email: string; full_name: string };

export default function AdminComercioDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const [vendor, setVendor] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [assignedUserId, setAssignedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [payMethod, setPayMethod] = useState("efectivo");
  const [payAmount, setPayAmount] = useState("");
  const [recordingPay, setRecordingPay] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/comercios/${id}`);
    const data = await res.json();
    if (data.vendor) {
      setVendor(data.vendor);
      setProducts(data.vendor.products || []);
      setAssignedUserId(data.vendor.user_id || "");
      setSubscriptions(data.subscriptions || []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    load();
    fetch("/api/admin/users?per_page=100")
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []))
      .catch(() => setUsers([]));
  }, [id, load]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/comercios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await res.json();
    load();
  }

  async function toggleVisible() {
    await patch({ visible: !vendor?.visible });
    setMsg(vendor?.visible ? "Comercio oculto de la página." : "Comercio visible en la página.");
  }

  async function assignUser() {
    setSaving(true);
    await patch({ user_id: assignedUserId || null });
    setSaving(false);
    setMsg(assignedUserId ? "Dueño asignado." : "Dueño desasignado (queda sin asignar).");
  }

  const [resetting, setResetting] = useState(false);

  async function handleRecordPayment() {
    if (!subscriptions.length) return;
    setRecordingPay(true);
    try {
      const res = await fetch("/api/admin/comercios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: id,
          action: "record_payment",
          paymentMethod: payMethod,
          amount: payAmount !== "" && Number(payAmount) >= 0 ? Number(payAmount) : null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg(`Pago registrado (${payMethod}${payAmount ? ` · $${payAmount}` : ""}).`);
        setPayAmount("");
        load();
      } else {
        setMsg(data.error || "No se pudo registrar el pago");
      }
    } catch {
      setMsg("Error al registrar el pago");
    } finally {
      setRecordingPay(false);
    }
  }

  async function resetOrders() {
    if (!confirm(`¿Eliminar TODOS los pedidos y poner las mesas en libre de "${vendor?.store_name}"?`)) return;
    if (!confirm("Esta acción es definitiva y no se puede deshacer. ¿Continuar?")) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/comercios/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_orders" }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg(`Pedidos y contadores inicializados: ${data.ordersDeleted} pedido(s) eliminado(s), ${data.tablesReset} mesa(s) en libre.`);
      } else {
        setMsg(data.error || "No se pudo inicializar");
      }
    } catch {
      setMsg("Error al inicializar pedidos");
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return <div className="space-y-3"><div className="h-16 rounded-xl bg-muted animate-pulse" /></div>;
  }

  if (!vendor) {
    return <p className="text-muted-foreground">Comercio no encontrado.</p>;
  }

  const visible = !!vendor.visible;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link href="/admin/comercios" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Volver a comercios
        </Link>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={visible ? "outline" : "default"} onClick={toggleVisible}>
            {visible ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {visible ? "Ocultar de la página" : "Mostrar en la página"}
          </Button>
          <Button size="sm" asChild>
            <Link href={`/vendor/dashboard?as=${vendor.id}`}>
              <Pencil className="h-4 w-4 mr-1" /> Editar en el dashboard
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {vendor.logo_url ? (
          <img src={vendor.logo_url} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
            <span className="text-xl font-bold text-muted-foreground">{vendor.store_name?.charAt(0)}</span>
          </div>
        )}
        <div>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
            {vendor.store_name}
            {visible ? (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">Visible</Badge>
            ) : (
              <Badge variant="secondary">Oculto</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">/{vendor.slug}</p>
        </div>
      </div>

      {msg && <p className="text-sm text-emerald-600">{msg}</p>}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Asignación de dueño */}
        <div className="rounded-xl border border-border p-4 space-y-3">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Dueño</h2>
          <p className="text-xs text-muted-foreground">
            {vendor.user_id ? "Este comercio ya tiene un dueño asignado." : "Sin dueño asignado (modo llave en mano)."}
          </p>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
          >
            <option value="">— Sin asignar —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name || u.email} ({u.email})
              </option>
            ))}
          </select>
          <Button size="sm" onClick={assignUser} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Asignar dueño
          </Button>
        </div>

        {/* Contenido cargado */}
        <div className="rounded-xl border border-border p-4 space-y-3">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Contenido cargado</h2>
          <p className="text-sm">{products.length} producto{products.length !== 1 ? "s" : ""}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/tienda/${vendor.slug}`} target="_blank">
                <ExternalLink className="h-4 w-4 mr-1" /> Ver micrositio
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Datos básicos */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Datos del comercio</h2>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Vertical:</span> {vendor.vertical || "-"}</div>
          <div><span className="text-muted-foreground">Barrio:</span> {vendor.neighborhood || "-"}</div>
          <div><span className="text-muted-foreground">Teléfono:</span> {vendor.phone || "-"}</div>
          <div><span className="text-muted-foreground">WhatsApp:</span> {vendor.whatsapp || "-"}</div>
          <div><span className="text-muted-foreground">Dirección:</span> {vendor.address || "-"}</div>
          <div><span className="text-muted-foreground">Registro:</span> {new Date(vendor.created_at).toLocaleDateString("es-AR")}</div>
        </div>
      </div>

      {/* Pagos / Suscripciones */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
          Plan y pagos
        </h2>
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Plan actual:</span>{" "}
            {vendor.plan_status === "gratuito" ? "Gratuito" : (
              <>
                {subscriptions[0]?.plan_name || vendor.plan_id} · {vendor.plan_status}
              </>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Vence:</span>{" "}
            {vendor.plan_expires_at
              ? new Date(vendor.plan_expires_at).toLocaleDateString("es-AR")
              : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Último pago:</span>{" "}
            {subscriptions[0]?.paid_at
              ? `${new Date(subscriptions[0].paid_at).toLocaleDateString("es-AR")} · ${subscriptions[0].payment_method || ""}${subscriptions[0].amount != null ? ` · $${Number(subscriptions[0].amount).toLocaleString("es-AR")}` : ""}`
              : "Sin registrar"}
          </div>
        </div>

        {subscriptions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-2 font-medium">Fecha</th>
                  <th className="py-1.5 pr-2 font-medium">Plan</th>
                  <th className="py-1.5 pr-2 font-medium">Período</th>
                  <th className="py-1.5 pr-2 font-medium">Método</th>
                  <th className="py-1.5 pr-2 font-medium">Monto</th>
                  <th className="py-1.5 pr-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s: any) => (
                  <tr key={s.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-2">{new Date(s.created_at).toLocaleDateString("es-AR")}</td>
                    <td className="py-1.5 pr-2">{s.plan_name || s.plan_slug || "—"}</td>
                    <td className="py-1.5 pr-2">
                      {s.current_period_end
                        ? `hasta ${new Date(s.current_period_end).toLocaleDateString("es-AR")}`
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      {s.payment_method === "efectivo" ? "💵 Efectivo" :
                       s.payment_method === "transferencia" ? "🏦 Transf." :
                       s.payment_method === "mercadopago" ? "💳 MP" : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      {s.amount != null ? `$${Number(s.amount).toLocaleString("es-AR")}` : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      {s.paid_at ? (
                        <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">
                          Pagado
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-medium">
                          Sin pagar
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sin suscripciones registradas (plan Gratuito).</p>
        )}

        {subscriptions.length > 0 && !subscriptions[0]?.paid_at && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-muted/40 border border-border p-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Método</label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
              >
                <option value="efectivo">💵 Efectivo</option>
                <option value="transferencia">🏦 Transferencia</option>
                <option value="mercadopago">💳 Mercado Pago</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Monto ($)</label>
              <input
                type="number"
                min={0}
                placeholder="0"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
            <Button size="sm" onClick={handleRecordPayment} disabled={recordingPay}>
              {recordingPay ? "Guardando…" : "Registrar pago"}
            </Button>
          </div>
        )}
      </div>

      {/* Inicializar pedidos y contadores */}
      <div className="rounded-xl border border-red-200 bg-red-50/40 dark:bg-red-950/20 dark:border-red-900 p-4 space-y-3">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-red-600">Inicializar pedidos y contadores</h2>
        <p className="text-xs text-muted-foreground">
          Elimina los pedidos cargados y deja todas las mesas en libre. Útil para sacar los datos de
          prueba antes de arrancar. Se conserva el catálogo (productos) y el plan del comercio.
        </p>
        <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={resetOrders} disabled={resetting}>
          {resetting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Inicializar pedidos
        </Button>
      </div>
    </div>
  );
}