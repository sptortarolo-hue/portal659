"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildComandaWhatsApp } from "@/lib/whatsapp-message";
import { cashAppliesToItem, cashPrice, normalizeCashPct } from "@/lib/cash-discount";
import { cartLineTotal } from "@/lib/order-line";
import { mirrorVolume } from "@/lib/volume-mirror";
import { checkArgPhone, toE164 } from "@/lib/phone";
import { OrderSummaryModal } from "@/components/cart/order-summary-modal";
import { readPreviewSession } from "@/components/store/preview-session-sync";

export default function CheckoutPage() {
  const router = useRouter();
  const { vendor, items, total, clear } = useCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"delivery" | "pickup">("delivery");
  const [paymentMethod, setPaymentMethod] = useState<"whatsapp" | "efectivo" | "transferencia">("whatsapp");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [mpConfigured, setMpConfigured] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<{ orderId: string; message: string; waNumber: string; trackToken?: string } | null>(null);
  const [prefillInfo, setPrefillInfo] = useState<{ found: boolean; name?: string | null } | null>(null);
  const [doneTrackToken, setDoneTrackToken] = useState<string | null>(null);
  // Vuelta de Mercado Pago (back_urls: /checkout?payment=success|pending|failure&vendor=<slug>).
  // El pedido lo crea el webhook de forma asíncrona; el token de seguimiento
  // se obtiene con un poll corto a /api/orders/latest-token.
  const [mpReturn, setMpReturn] = useState<{
    status: "success" | "pending" | "failure";
    stash: {
      slug?: string;
      storeName?: string;
      whatsapp?: string;
      phone?: string;
      customerName?: string;
      total?: number;
    } | null;
  } | null>(null);
  const [mpTrackToken, setMpTrackToken] = useState<string | null>(null);
  const [mpTokenDone, setMpTokenDone] = useState(false);
  // Validación de WhatsApp en vivo (misma que el registro de usuarios).
  const [phoneMsg, setPhoneMsg] = useState("");
  const [phoneOk, setPhoneOk] = useState(false);

  function updatePhone(raw: string) {
    setPhone(raw);
    if (!raw.trim()) {
      setPhoneMsg("");
      setPhoneOk(false);
      return;
    }
    const res = checkArgPhone(raw);
    if (res.ok) {
      setPhoneMsg(`Se usará ${res.formatted} para tu pedido`);
      setPhoneOk(true);
    } else if (res.invalid) {
      setPhoneMsg(res.message);
      setPhoneOk(false);
    } else {
      setPhoneMsg("");
      setPhoneOk(false);
    }
  }

  // Espejo visual del volumen (el servidor recalcula y manda).
  const vol = useMemo(() => mirrorVolume(items, vendor?.volumeGroups), [items, vendor]);
  const netSubtotal = total - vol.volumeDiscount;

  const deliveryFee =
  vendor &&
  method === "delivery" &&
  vendor.deliveryFee != null &&
  !(vendor.freeDeliveryMin != null && netSubtotal >= Number(vendor.freeDeliveryMin))
    ? Number(vendor.deliveryFee)
    : 0;
  const grandTotal = total + deliveryFee;

  // Espejo visual del descuento en efectivo (el servidor recalcula y manda).
  // % sobre la NETA DE LA LÍNEA (pack-native: nunca se deriva de unidades
  // redondeadas). Con volumen sin combine, la línea no recibe cash; con
  // combine, corre sobre el neto del grupo.
  const cashPct = normalizeCashPct(vendor?.cashDiscountPct);
  const cashActive = paymentMethod === "efectivo" && cashPct > 0;
  let cashDiscount = 0;
  if (cashActive) {
    items.forEach((i, idx) => {
      const vline = vol.lines[idx];
      if (vline && !vline.cashEligible) return;
      if (!cashAppliesToItem({ hasPromo: vline?.hasPromo ?? !!i.hasPromo, excluded: i.cashExcluded })) return;
      const lineNet = vline ? vline.netTotal : cartLineTotal(i);
      cashDiscount += lineNet - Math.round(lineNet * (1 - cashPct / 100) * 100) / 100;
    });
    cashDiscount = Math.round(cashDiscount * 100) / 100;
  }
  const displayTotal = grandTotal - vol.volumeDiscount - cashDiscount;
  const volumeLabel = vol.applied.length > 0
    ? vol.applied.map((a) => `${a.groupName} (${a.label})`).join(" · ")
    : "";

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("payment");
    if (p !== "success" && p !== "pending" && p !== "failure") return;
    let stash: any = null;
    try {
      const raw = sessionStorage.getItem("mp_return");
      if (raw) {
        stash = JSON.parse(raw);
        sessionStorage.removeItem("mp_return");
      }
    } catch { /* noop */ }
    setMpReturn({ status: p, stash });
  }, []);

  useEffect(() => {
    if (!mpReturn || mpTokenDone || mpReturn.status === "failure") return;
    const slug = mpReturn.stash?.slug;
    const phone = mpReturn.stash?.phone;
    if (!slug || !phone) {
      setMpTokenDone(true);
      return;
    }
    let cancelled = false;
    let tries = 0;
    const id = window.setInterval(async () => {
      tries++;
      try {
        const r = await fetch(
          `/api/orders/latest-token?vendor=${encodeURIComponent(slug)}&phone=${encodeURIComponent(phone)}`
        );
        const d = await r.json().catch(() => null);
        if (d?.token) {
          if (!cancelled) {
            setMpTrackToken(d.token);
            setMpTokenDone(true);
          }
          window.clearInterval(id);
          return;
        }
      } catch { /* noop */ }
      if (tries >= 20) {
        window.clearInterval(id);
        if (!cancelled) setMpTokenDone(true);
      }
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mpReturn, mpTokenDone]);

  useEffect(() => {
    if (!vendor?.id) return;
    fetch(`/api/payments?vendorId=${encodeURIComponent(vendor.id)}`)
      .then(r => r.json())
      .then(d => setMpConfigured(d.configured))
      .catch(() => setMpConfigured(false));
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) return;
        setUserId(d.user.id);
        setName((prev) => prev || d.user.full_name || d.user.name || "");
        setPhone((prev) => prev || d.user.whatsapp || d.user.phone || "");
      })
      .catch(() => {});
  }, [vendor?.id]);

  if (mpReturn) {
    const s = mpReturn;
    const storeName = s.stash?.storeName || "el local";
    const waNum = (s.stash?.whatsapp || "").replace(/[^0-9]/g, "");
    const waText =
      s.status === "failure"
        ? `Hola ${storeName}! Intenté pagar online y no se pudo cobrar. ¿Coordinamos el pedido por acá?`
        : `Hola ${storeName}! Soy ${s.stash?.customerName || "el cliente"}: ya pagué mi pedido online por Mercado Pago (${s.stash?.total ? `$${Number(s.stash.total).toLocaleString("es-AR")}` : "online"}).`;
    const waLink = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(waText)}` : null;
    const tiendaLink = s.stash?.slug ? `/tienda/${s.stash.slug}` : "/";

    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        {s.status === "success" && (
          <>
            <div className="text-6xl mb-4 animate-bounce-in">✅</div>
            <h1 className="font-display text-3xl font-semibold mb-3">¡Pago aprobado!</h1>
            <p className="text-muted-foreground mb-6">
              Tu pedido pagado ya llegó a <span className="font-medium">{storeName}</span>. No hace falta que avises por WhatsApp: les llega solo.
            </p>
          </>
        )}
        {s.status === "pending" && (
          <>
            <div className="text-6xl mb-4">⏳</div>
            <h1 className="font-display text-3xl font-semibold mb-3">Pago en revisión</h1>
            <p className="text-muted-foreground mb-6">
              Mercado Pago está procesando tu pago. Cuando se acredite, el pedido entra directo en{" "}
              <span className="font-medium">{storeName}</span>.
            </p>
          </>
        )}
        {s.status === "failure" && (
          <>
            <div className="text-6xl mb-4">❌</div>
            <h1 className="font-display text-3xl font-semibold mb-3">No se pudo cobrar</h1>
            <p className="text-muted-foreground mb-6">
              El pago online no se completó. Podés volver a intentar o coordinar el pago directo con{" "}
              <span className="font-medium">{storeName}</span>.
            </p>
          </>
        )}

        {s.status !== "failure" && (
          <div className="space-y-2 mb-4">
            {mpTrackToken ? (
              <Button className="w-full" onClick={() => router.push(`/seguimiento/${mpTrackToken}`)}>
                📦 Seguir mi pedido en vivo
              </Button>
            ) : !mpTokenDone ? (
              <div className="h-10 rounded-xl bg-muted animate-pulse" aria-label="Buscando tu pedido" />
            ) : null}
          </div>
        )}
        <div className="space-y-2">
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-xl bg-green-500 text-white text-sm font-medium py-2.5 hover:bg-green-600 transition-colors"
            >
              💬 {s.status === "failure" ? "Coordinar por WhatsApp" : "Avisar por WhatsApp (opcional)"}
            </a>
          )}
          <Button variant="outline" className="w-full" onClick={() => router.push(tiendaLink)}>
            Volver a la tienda
          </Button>
        </div>
      </main>
    );
  }

  if (!vendor || items.length === 0) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <div className="text-5xl mb-4">🛒</div>
        <h1 className="font-display text-3xl font-semibold mb-4">
          Tu pedido está vacío
        </h1>
        <p className="text-muted-foreground mb-6">
          {vendor?.vertical === "gastronomia" ? "Agregá platos de un local para poder hacer el pedido." : "Agregá productos de un local para poder hacer el pedido."}
        </p>
        <Button onClick={() => router.push("/")}>Ver ofertas</Button>
      </main>
    );
  }

  const v = vendor;
  // Retail (moda/comercio): textos de "productos", sin referencias a cocina.
  const esRetail = v.vertical === "moda" || v.vertical === "comercio";
  // Métodos de entrega que habilitó el comercio ("ambos" | "retiro" | "domicilio").
  const deliveryOpts = v.deliveryOptions || "ambos";
  const allowDelivery = deliveryOpts !== "retiro";
  const allowPickup = deliveryOpts !== "domicilio";
  // Modo prueba: el micrositio en preview guarda el contexto en sessionStorage.
  const previewCtx = v?.id ? readPreviewSession(v.id) : null;
  const isPreview = previewCtx !== null;

  // Si el comercio no ofrece el método elegido, forzar el habilitado.
  useEffect(() => {
    if (!allowDelivery && method === "delivery") setMethod("pickup");
    if (!allowPickup && method === "pickup") setMethod("delivery");
  }, [allowDelivery, allowPickup, method]);

  async function lookupPhone() {
    // Autocompletar datos de pedidos anteriores: solo con celular válido.
    const e164 = toE164(phone);
    if (!e164) return;
    const clean = e164;
    try {
      const res = await fetch(`/api/orders/last?phone=${encodeURIComponent(clean)}`);
      const data = await res.json();
      if (data.found) {
        if (!name.trim()) setName(data.name || "");
        setPrefillInfo({ found: true, name: data.name });
      } else {
        setPrefillInfo({ found: false });
      }
    } catch {
      setPrefillInfo({ found: false });
    }
  }

  async function handleMercadoPago() {
    if (isPreview) {
      setError("Los pagos online están deshabilitados en modo prueba.");
      return;
    }
    if (!name || !phone) return;
    const e164 = toE164(phone);
    if (!e164) {
      setError(phoneMsg || "Ingresá tu celular con código de área (ej: 11 5555 1234)");
      return;
    }
    setLoading(true);
    setError("");

    const cleanPhone = e164;

    // Con volumen, MP cobra los netos por línea (la preferencia suma ítems).
    // Con pack: MP recibe packs (qty = N° de packs, precio por pack) — nunca
    // la unidad redondeada (igual que la fórmula del servidor).
    const mpItems = items.map((i, idx) => {
      const vline = vol.lines[idx];
      const lineNet = vline ? vline.netTotal : cartLineTotal(i);
      if (i.packSize && i.packSize >= 2) {
        const packs = Math.max(1, Math.round(i.qty / i.packSize));
        return {
          offerId: i.offerId,
          variantId: i.variantId,
          name: i.name,
          price: Math.round((lineNet / packs) * 100) / 100,
          qty: packs,
        };
      }
      const modTotal = (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0);
      const unit = vline
        ? Math.round((lineNet / Math.max(1, i.qty)) * 100) / 100
        : i.price + modTotal;
      return {
        offerId: i.offerId,
        variantId: i.variantId,
        name: i.name,
        price: unit,
        qty: i.qty,
      };
    });
    const mpTotal = mpItems.reduce((s, it) => s + it.price * it.qty, 0) + deliveryFee;

    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId: v.id,
        items: mpItems,
        total: mpTotal,
        customerName: name,
        customerPhone: cleanPhone,
        customerAddress: method === "delivery" ? address : null,
        method,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setError(data.error);
      setLoading(false);
      return;
    }

    if (data.initPoint) {
      // Stash para la pantalla de vuelta (el pedido lo crea el webhook MP;
      // sin esto la vuelta caía en "carrito vacío" sin confirmación).
      try {
        sessionStorage.setItem(
          "mp_return",
          JSON.stringify({
            slug: v.slug,
            storeName: v.storeName,
            whatsapp: v.whatsapp || "",
            phone: cleanPhone,
            customerName: name,
            total: mpTotal,
          })
        );
      } catch { /* noop */ }
      clear();
      window.location.href = data.initPoint;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone) return;

    const e164 = toE164(phone);
    if (!e164) {
      setError(phoneMsg || "Ingresá tu celular con código de área (ej: 11 5555 1234)");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const cleanPhone = e164;

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: v.id,
          customerName: name,
          customerPhone: cleanPhone,
          customerAddress: method === "delivery" ? address : null,
          method,
          paymentMethod,
          customerId: userId || null,
          isPreview,
          previewToken: previewCtx?.token ?? null,
          items: items.map((i) => ({
            offerId: i.offerId,
            variantId: i.variantId,
            name: i.name,
            price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
            qty: i.qty,
            modifiers: (i.modifiers || []).map((m) => m.label),
          })),
          total: displayTotal,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Error al crear el pedido");
        setLoading(false);
        return;
      }

      const waTotal = typeof data.total === "number" ? data.total : grandTotal;
      const waCashDiscount = typeof data.cashDiscount === "number" ? data.cashDiscount : 0;
      const waCashPct = typeof data.cashPct === "number" ? data.cashPct : 0;
      const waVolumeDiscount = typeof data.volumeDiscount === "number" ? data.volumeDiscount : 0;
      const waVolumeLabel = Array.isArray(data.volumeApplied) && data.volumeApplied.length > 0
        ? data.volumeApplied.map((a: any) => `${a.groupName} (${a.label})`).join(" · ")
        : volumeLabel;
      const previewPrefix = isPreview ? "🧪 [PRUEBA] " : "";
      const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, "");
      const trackUrl = data.trackToken ? `${baseUrl}/seguimiento/${data.trackToken}` : undefined;
      const registerUrl = data.trackToken ? `${baseUrl}/registro?next=/perfil` : undefined;
      const waMessage = buildComandaWhatsApp({
        vendorName: v.storeName,
        items: items.map((i) => ({
          name: i.name,
          price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
          qty: i.qty,
          modifiers: (i.modifiers || []).map((m) => m.label),
          lineTotal: cartLineTotal(i),
        })),
        total: waTotal,
        customerName: name,
        customerPhone: cleanPhone,
        method,
        address: method === "delivery" ? address : undefined,
        paymentMethod,
          notes: notes.trim() || undefined,
          trackUrl,
          registerUrl,
          cashDiscount: waCashDiscount,
          cashPct: waCashPct,
          volumeDiscount: waVolumeDiscount,
          volumeLabel: waVolumeLabel || undefined,
        });
      const message = previewPrefix + waMessage;

      const waNumber = (v.whatsapp || "").replace(/[^0-9]/g, "");
      setPendingOrder({ orderId: data.orderId || "", message, waNumber, trackToken: data.trackToken });
      setShowSummary(true);
      setLoading(false);
    } catch {
      setLoading(false);
      setError("Ocurrió un error al enviar el pedido. Probá de nuevo.");
    }
  }

  function confirmSend() {
    if (!pendingOrder) return;
    setLoading(true);
    window.open(
      `https://wa.me/${pendingOrder.waNumber}?text=${encodeURIComponent(pendingOrder.message)}`,
      "_blank"
    );
    clear();
    setDoneTrackToken(pendingOrder.trackToken || null);
    setShowSummary(false);
    setPendingOrder(null);
    setDone(true);
    setLoading(false);
  }

  if (done) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <div className="text-6xl mb-4 animate-bounce-in">✅</div>
        <h1 className="font-display text-3xl font-semibold mb-4">
          Pedido enviado
        </h1>
        <p className="text-muted-foreground mb-4">
          Se abrió WhatsApp con tu pedido para{" "}
          <span className="font-medium">{v.storeName}</span>.
          {isPreview && (
            <span className="block mt-1 text-xs font-semibold text-amber-700">
              🧪 Fue un pedido de prueba.
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground/70 mb-6">
          Seguí el estado de tu pedido con tu número de WhatsApp en{" "}
          <button onClick={() => router.push("/mis-pedidos")} className="underline text-primary hover:text-primary/80">
            Mis pedidos
          </button>
          {doneTrackToken && (
            <>
              {" · "}
              <button onClick={() => router.push(`/seguimiento/${doneTrackToken}`)} className="underline text-primary hover:text-primary/80">
                Ver seguimiento en vivo
              </button>
            </>
          )}
        </p>
        {!userId && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 mb-6 text-left">
            <p className="font-semibold text-sm mb-1">📋 ¿Guardamos tus datos para la próxima?</p>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              Creá tu cuenta gratis y tené tus favoritos, tus datos de contacto ya cargados,
              tu historial de pedidos y acceso a dejar reseñas.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => router.push("/registro?next=/perfil")}
            >
              Crear mi cuenta gratis
            </Button>
          </div>
        )}
        <Button onClick={() => router.push("/")}>Seguir viendo ofertas</Button>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-md">
      <h1 className="font-display text-3xl font-semibold mb-2">
        Confirmar pedido
      </h1>
      <p className="text-muted-foreground text-sm mb-6">
        Con <span className="font-medium">{v.storeName}</span> · {items.length} items ·{" "}
        <span className="font-bold text-foreground">${displayTotal.toLocaleString("es-AR")}</span>
      </p>

      {/* Order summary */}
      <div className="border border-border rounded-2xl p-4 mb-6 bg-card space-y-3">
        {items.map((i, idx) => {
          const lineTotal = cartLineTotal(i);
          return (
            <div key={`${i.offerId}-${idx}`} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 text-sm font-bold text-muted-foreground">
                {i.qty}x
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {i.name}
                  {i.packSize && <span className="ml-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 whitespace-nowrap">pack x{i.packSize}</span>}
                </p>
                {i.modifiers && i.modifiers.length > 0 && (
                  <p className="text-xs text-muted-foreground/60 truncate">
                    {i.modifiers.map((m) => m.label).join(" · ")}
                  </p>
                )}
              </div>
              <span className="text-sm font-bold tabular-nums">
                ${lineTotal.toLocaleString("es-AR")}
              </span>
            </div>
          );
        })}
        <div className="border-t border-border pt-3 mt-2 space-y-1">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Subtotal</span>
            <span>${total.toLocaleString("es-AR")}</span>
          </div>
          {deliveryFee > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Envío</span>
              <span>${deliveryFee.toLocaleString("es-AR")}</span>
            </div>
          )}
          {cashActive && cashDiscount > 0 && (
            <div className="flex justify-between text-sm font-medium text-green-700">
              <span>Desc. efectivo ({Number(cashPct).toLocaleString("es-AR")}%)</span>
              <span>−${cashDiscount.toLocaleString("es-AR")}</span>
            </div>
          )}
          {vol.volumeDiscount > 0 && (
            <div className="flex justify-between text-sm font-medium text-emerald-700">
              <span>Desc. volumen{volumeLabel ? ` (${volumeLabel})` : ""}</span>
              <span>−${vol.volumeDiscount.toLocaleString("es-AR")}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg">
            <span>Total</span>
            <span>${displayTotal.toLocaleString("es-AR")}</span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {isPreview && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            🧪 Pedido de prueba — no se cobra online ni cuenta en tus métricas.
          </div>
        )}
        {/* Name & Phone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <Label htmlFor="name">Tu nombre</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre y apellido"
              required
            />
          </div>
          <div className="min-w-0">
            <Label htmlFor="phone">Tu WhatsApp</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => updatePhone(e.target.value)}
              onBlur={() => {
                if (phone) {
                  lookupPhone();
                }
              }}
              placeholder="11 5555 1234"
              className={
                phone && !phoneOk && phone.replace(/\D/g, "").length >= 10
                  ? "border-red-300"
                  : phoneOk
                    ? "border-green-400"
                    : ""
              }
              required
            />
            {phoneMsg && (
              <p className={`text-xs mt-1 ${phoneOk ? "text-green-600" : "text-red-500"}`}>{phoneMsg}</p>
            )}
          </div>
        </div>

        {prefillInfo?.found && (
          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 -mt-2 animate-fade-in-up">
            👋 {prefillInfo.name ? `¡Hola de nuevo, ${prefillInfo.name}! ` : "¡Te reconocimos! "}
            Completamos tus datos de anteriores pedidos.
          </div>
        )}

        {/* Delivery method */}
        <div>
          <Label>
            {allowDelivery && allowPickup
              ? "¿Retirás o pedís delivery?"
              : allowDelivery
                ? "Entrega a domicilio"
                : "Retiro en el local"}
          </Label>
          <div className="flex gap-2 mt-1">
            {allowDelivery && (
              <button
                type="button"
                onClick={() => setMethod("delivery")}
                className={`flex-1 min-w-0 rounded-xl border-2 py-3 px-1 text-xs sm:text-sm font-medium transition-all break-words ${
                  method === "delivery"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/30"
                }`}
              >
                🛵 A domicilio
              </button>
            )}
            {allowPickup && (
              <button
                type="button"
                onClick={() => setMethod("pickup")}
                className={`flex-1 min-w-0 rounded-xl border-2 py-3 px-1 text-xs sm:text-sm font-medium transition-all break-words ${
                  method === "pickup"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/30"
                }`}
              >
                🏠 Retiro en el local
              </button>
            )}
          </div>
        </div>
        {method === "delivery" && (
          <div className="animate-fade-in-up">
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle y número"
            />
          </div>
        )}

        {/* Notes */}
        <div className="animate-fade-in-up">
          <Label htmlFor="notes">Instrucciones especiales (opcional)</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={esRetail ? "Ej: preferencia de color, horario de entrega..." : "Sin cebolla, extra picante, acceso por el costado..."}
            className="h-16 text-sm resize-none"
            maxLength={200}
          />
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{notes.length}/200</p>
        </div>

        {/* Payment method */}
        <div>
          <Label>¿Cómo pagás?</Label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <button
              type="button"
              onClick={() => setPaymentMethod("whatsapp")}
              className={`rounded-xl border-2 py-3 px-1 text-xs sm:text-sm font-medium transition-all min-w-0 break-words ${
                paymentMethod === "whatsapp"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              📱 Coordinar
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("efectivo")}
              className={`rounded-xl border-2 py-3 px-1 text-xs sm:text-sm font-medium transition-all min-w-0 break-words ${
                paymentMethod === "efectivo"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              💵 Efectivo
              {normalizeCashPct(vendor?.cashDiscountPct) > 0 && (
                <span className="ml-1 rounded-full bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5">
                  −{Number(normalizeCashPct(vendor?.cashDiscountPct)).toLocaleString("es-AR")}%
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("transferencia")}
              className={`rounded-xl border-2 py-3 px-1 text-xs sm:text-sm font-medium transition-all min-w-0 break-words ${
                paymentMethod === "transferencia"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              🏦 Transferencia
            </button>
          </div>
        </div>

        {/* Transfer info */}
        {paymentMethod === "transferencia" && (
          <div className="rounded-2xl border border-fresh bg-fresh/30 p-5 animate-fade-in-up">
            <p className="font-medium text-fresh-foreground text-sm">🏦 Transferencia</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              Al confirmar el pedido, el comercio te contacta por WhatsApp con los datos de la cuenta y el monto exacto a transferir. Ahí coordinás todo directo con ellos, incluido el envío del comprobante.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Hero CTA */}
        <Button
          type="submit"
          className="w-full bg-whatsapp text-white hover:bg-whatsapp-dark h-12 text-base font-semibold rounded-xl active:scale-[0.98] transition-transform"
          disabled={loading}
        >
          {loading ? "Enviando pedido..." : "Confirmar pedido por WhatsApp"}
        </Button>

        {mpConfigured && !isPreview && (
          <button
            type="button"
            onClick={handleMercadoPago}
            disabled={loading}
            className="w-full rounded-xl border-2 border-blue-200 bg-blue-50 text-blue-700 py-3 text-sm font-medium hover:bg-blue-100 disabled:opacity-50 transition-all"
          >
            💳 Pagar con Mercado Pago
          </button>
        )}

        <p className="text-xs text-muted-foreground text-center px-4">
          {mpConfigured
            ? "Elegí WhatsApp para coordinar el pago directo, o pagá online con Mercado Pago."
            : "El pedido se envía al WhatsApp del local. Sin registro, sin pagar online: el local te pasa el total y coordinás el pago directo."}
        </p>
      </form>

      <OrderSummaryModal
        open={showSummary}
        onClose={() => { setShowSummary(false); }}
        onConfirm={confirmSend}
        vendorName={v.storeName}
        items={items.map((i) => ({
          name: i.name,
          price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
          qty: i.qty,
          modifiers: (i.modifiers || []).map((m) => m.label),
          lineTotal: cartLineTotal(i),
        }))}
        total={displayTotal}
        cashDiscount={cashActive ? cashDiscount : 0}
        cashPct={cashActive ? cashPct : 0}
        volumeDiscount={vol.volumeDiscount}
        volumeLabel={volumeLabel || undefined}
        deliveryFee={deliveryFee}
        method={method}
        address={method === "delivery" ? address : undefined}
        paymentMethod={paymentMethod}
        loading={loading}
      />
    </main>
  );
}
