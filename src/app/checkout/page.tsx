"use client";

import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildComandaWhatsApp } from "@/lib/whatsapp-message";
import { deliveryLabel, normalizeDeliveryMode, resolveDeliveryFee } from "@/lib/delivery";
import { cashAppliesToItem, cashPrice, normalizeCashPct } from "@/lib/cash-discount";
import { cashBillSuggestions } from "@/lib/cash-bills";
import { cartLineTotal } from "@/lib/order-line";
import { mirrorVolume } from "@/lib/volume-mirror";
import { checkArgPhone, toE164 } from "@/lib/phone";
import { fmtVence } from "@/lib/gift-card-share";
import { OrderSummaryModal } from "@/components/cart/order-summary-modal";
import { readPreviewSession } from "@/components/store/preview-session-sync";

export default function CheckoutPage() {
  const router = useRouter();
  const { vendor, items, total, clear } = useCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [references, setReferences] = useState("");
  const [inArea, setInArea] = useState(true);
  const [zoneId, setZoneId] = useState("");
  // Zona extendida del catálogo del portal (Portal 659 Envíos): "none" = no.
  const [shipZoneId, setShipZoneId] = useState("none");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"delivery" | "pickup">("delivery");
  const [paymentMethod, setPaymentMethod] = useState<"whatsapp" | "efectivo" | "transferencia">("whatsapp");
  // "¿Con cuánto abonás?" (efectivo + delivery): el comercio sabe cuánto
  // vuelto llevar el repartidor. El toggle `cash_ask_amount` lo apaga.
  const [cashAmount, setCashAmount] = useState("");
  const [cashAskAmount, setCashAskAmount] = useState(true);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [mpConfigured, setMpConfigured] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // Canje de giftcard (efectivo/transferencia/Coordinar-por-WA): valida el
  // saldo y lo descuenta del total. MP va por su propia ruta (ya cobró todo).
  const [showGiftcard, setShowGiftcard] = useState(false);
  const [giftcardCode, setGiftcardCode] = useState("");
  const [giftcardLookup, setGiftcardLookup] = useState<{ loading: boolean; error: string; balance: number | null; expiresAt: string | null }>({ loading: false, error: "", balance: null, expiresAt: null });
  const [showSummary, setShowSummary] = useState(false);
  // Guard anti doble-tap: evita crear dos pedidos al tocar "Enviar" rápido.
  const sendingRef = useRef(false);
  const [prefillInfo, setPrefillInfo] = useState<{ found: boolean; name?: string | null } | null>(null);
  // Turnos de reparto retail (moda/comercio): próximos 3 slots del comercio.
  const [deliverySlots, setDeliverySlots] = useState<{ id: string; label: string; range: string; isToday: boolean; isTomorrow: boolean }[]>([]);
  const [deliveryOpen, setDeliveryOpen] = useState<boolean | null>(null);
  const [deliveryPaused, setDeliveryPaused] = useState(false);
  const [deliveryCoordinar, setDeliveryCoordinar] = useState(false);
  const [pauseClientMsg, setPauseClientMsg] = useState<string | null>(null);
  const [slotId, setSlotId] = useState("");
  const [doneTrackToken, setDoneTrackToken] = useState<string | null>(null);
  // Snapshot del nombre del comercio al confirmar: confirmSend limpia el
  // carrito (vendor=null) y la página de éxito debe seguir mostrándolo.
const [doneVendorName, setDoneVendorName] = useState<string | null>(null);
const [doneIsPreview, setDoneIsPreview] = useState(false);
const [doneIsGift, setDoneIsGift] = useState(false);
  // Vuelta de Mercado Pago (back_urls: /checkout?payment=success|pending|failure&vendor=<slug>).
  // El pedido lo crea el webhook de forma asíncrona; el token de seguimiento
  // se obtiene con un poll corto a /api/orders/latest-token.
  const [mpReturn, setMpReturn] = useState<{
    status: "success" | "pending" | "failure";
    paymentId: string | null;
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
  // Datos que vienen del pedido ya creado (server) — no dependen del storage
  // del cliente (MP suele volver por la app y el sessionStorage se pierde).
  const [mpOrderInfo, setMpOrderInfo] = useState<{
    storeName: string | null;
    whatsapp: string | null;
    total: number | null;
    pickupNumber: number | null;
    customerName: string | null;
    slug?: string | null;
  } | null>(null);
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

  // Envío por zona (espejo visual; el servidor recalcula y manda).
  const vendorZones = Array.isArray(vendor?.deliveryZones) ? vendor.deliveryZones : [];
  const zonesMode = normalizeDeliveryMode(vendor?.deliveryMode) === "zones" && vendorZones.length > 0;
  // Zonas extendidas del catálogo del portal (Portal 659 Envíos).
  const vendorShipZones = Array.isArray((vendor as any)?.shipZones) ? (vendor as any).shipZones : [];
  const shipActive =
    method === "delivery" && shipZoneId !== "none" && shipZoneId !== "" &&
    vendorShipZones.some((z: any) => String(z.id) === String(shipZoneId));
  // Sin área cargada, la pregunta dentro/fuera no tiene referencia: no se
  // muestra y se asume dentro (tarifa única automática, cero fricción).
  const hasArea = !!vendor?.deliveryAreaText?.trim();
  const inAreaEffective = hasArea ? inArea : true;
  const zoneOut = zoneId === "__OUT__";
  const activeZoneId = zoneOut ? "" : zoneId || vendorZones[0]?.id || "";
  const deliverySel =
    method !== "delivery"
      ? ({ kind: "pickup" } as const)
      : shipActive
        ? ({ kind: "extends_zone", zoneId: String(shipZoneId) } as const)
        : zonesMode
          ? activeZoneId
            ? ({ kind: "zone", zoneId: activeZoneId } as const)
            : ({ kind: "out_of_area" } as const)
          : inAreaEffective
            ? ({ kind: "in_area" } as const)
            : ({ kind: "out_of_area" } as const);
  const resolvedDelivery = resolveDeliveryFee({
    mode: normalizeDeliveryMode(vendor?.deliveryMode),
    baseFee: vendor?.deliveryFee,
    freeMin: vendor?.freeDeliveryMin,
    zones: vendorZones,
    extendedZones: vendorShipZones.map((z: any) => ({ id: String(z.id), name: String(z.name ?? ""), fee: Number(z.price) || 0 })),
    selection: deliverySel,
    netSubtotal,
  });
  const deliveryFee = method === "delivery" ? resolvedDelivery.fee : 0;
  const deliveryOutOfArea = method === "delivery" && resolvedDelivery.outOfArea;
  const deliveryFreeShip = method === "delivery" && resolvedDelivery.freeShipping;
  const deliveryZoneName = resolvedDelivery.zoneName;
  const shipZoneInfo = shipActive ? vendorShipZones.find((z: any) => String(z.id) === String(shipZoneId)) : null;
  const grandTotal = total + deliveryFee;
  // Turno de entrega retail (solo moda/comercio a domicilio): el cliente
  // elige entre los próximos 3; default el primero (el server lo valida y,
  // si viene vacío/trucho, auto-asigna el próximo).
  const isRetailVendor = vendor?.vertical === "moda" || vendor?.vertical === "comercio";
  const showSlots = isRetailVendor && method === "delivery" && deliverySlots.length > 0 && !deliveryCoordinar;
  const activeSlotId = slotId || deliverySlots[0]?.id || "";
  const activeSlotLabel = deliverySlots.find((s) => s.id === activeSlotId)?.label || "";

  // Dirección + referencias en una línea (así viaja a customer_address,
  // WhatsApp, ticket e historial sin cambios de esquema).
  const fullAddress = (() => {
    const a = address.trim();
    const r = references.trim();
    if (!a && !r) return "";
    return r ? `${a} — Ref: ${r}` : a;
  })();

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
  const giftcardDiscount = giftcardLookup.balance != null ? Math.min(giftcardLookup.balance, grandTotal - vol.volumeDiscount - cashDiscount) : 0;
  const displayTotal = Math.max(0, grandTotal - vol.volumeDiscount - cashDiscount - giftcardDiscount);
  const volumeLabel = vol.applied.length > 0
    ? vol.applied.map((a) => `${a.groupName} (${a.label})`).join(" · ")
    : "";

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("payment");
    const mpStatus = sp.get("status"); // lo agrega MP al volver: approved/pending/rejected...
    const paymentId = sp.get("payment_id");
    let status: "success" | "pending" | "failure" | null = null;
    if (p === "success" || p === "pending" || p === "failure") status = p;
    else if (mpStatus === "approved") status = "success";
    else if (mpStatus === "pending" || mpStatus === "in_process") status = "pending";
    else if (mpStatus === "rejected" || mpStatus === "cancelled" || mpStatus === "refunded") status = "failure";
    if (!status) return;
    let stash: any = null;
    try {
      const raw = sessionStorage.getItem("mp_return");
      if (raw) {
        stash = JSON.parse(raw);
        sessionStorage.removeItem("mp_return");
      }
    } catch { /* noop */ }
    setMpReturn({ status, stash, paymentId });
  }, []);

  useEffect(() => {
    if (!mpReturn || mpTokenDone || mpReturn.status === "failure") return;
    const paymentId = mpReturn.paymentId;
    const slug = mpReturn.stash?.slug;
    const phone = mpReturn.stash?.phone;
    if (!paymentId && !(slug && phone)) {
      setMpTokenDone(true);
      return;
    }
    const buildUrl = () =>
      paymentId
        ? `/api/orders/latest-token?payment_id=${encodeURIComponent(paymentId)}`
        : `/api/orders/latest-token?vendor=${encodeURIComponent(slug!)}&phone=${encodeURIComponent(phone!)}`;
    let cancelled = false;
    let tries = 0;
    let id: number | null = null;
    const tick = async () => {
      tries++;
      try {
        const r = await fetch(buildUrl());
        const d = await r.json().catch(() => null);
        // Datos del comercio para los botones, aunque el token todavía no esté.
        if (d && (d.storeName || d.whatsapp || d.phoneVendor || d.token)) {
          if (!cancelled) {
            setMpOrderInfo({
              storeName: d.storeName ?? null,
              whatsapp: d.whatsapp ?? d.phoneVendor ?? null,
              total: d.total ?? null,
              pickupNumber: d.pickupNumber ?? null,
              customerName: d.customerName ?? null,
              slug: d.slug ?? null,
            });
          }
        }
        if (d?.token) {
          if (!cancelled) {
            setMpTrackToken(d.token);
            setMpTokenDone(true);
          }
          if (id !== null) window.clearInterval(id);
          return;
        }
      } catch { /* noop */ }
      if (tries >= 30) {
        if (id !== null) window.clearInterval(id);
        if (!cancelled) setMpTokenDone(true);
      }
    };
    void tick(); // primer intento inmediato; después cada 3s (~90s de ventana)
    id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mpReturn, mpTokenDone]);

  useEffect(() => {
    if (!vendor?.id) return;
    fetch(`/api/payments?vendorId=${encodeURIComponent(vendor.id)}`)
      .then(r => r.json())
      .then(d => {
        setMpConfigured(d.configured);
        if (typeof d.cashAskAmount === "boolean") setCashAskAmount(d.cashAskAmount);
      })
      .catch(() => setMpConfigured(false));
    // Turnos de reparto (retail): el server calcula hoy+próximos en TZ AR.
    fetch(`/api/delivery-availability?vendorId=${encodeURIComponent(vendor.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.slots)) setDeliverySlots(d.slots.slice(0, 3));
        setDeliveryCoordinar(d.deliveryCoordinar === true);
        setDeliveryOpen(typeof d.deliveryOpen === "boolean" ? d.deliveryOpen : null);
        setDeliveryPaused(d.deliveryPaused === true);
        setPauseClientMsg(typeof d.pauseClientMsg === "string" && d.pauseClientMsg ? d.pauseClientMsg : null);
      })
      .catch(() => {});
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

  // Compra 100% giftcards: no hay retiro ni delivery — entrega digital por
  // WhatsApp al teléfono del comprador (se pide abajo si falta).
  const isGiftOnly = items.length > 0 && items.every((i) => (i as any).isGift === true);
  // "¿Con cuánto abonás?" (efectivo + delivery, salvo que el comercio lo apague):
  // el vuelto se calcula en vivo contra el total final (con descuentos y envío).
  const cashAskVisible = paymentMethod === "efectivo" && method === "delivery" && cashAskAmount && !isGiftOnly;
  const cashAmountNum = Math.round((parseFloat(cashAmount.replace(",", ".")) || 0) * 100) / 100;
  const cashAskValid = !cashAskVisible || (cashAmountNum > 0 && cashAmountNum >= displayTotal);
  const cashChange = cashAskVisible && cashAmountNum > 0 ? Math.max(0, Math.round((cashAmountNum - displayTotal) * 100) / 100) : 0;
  // Sugerencias con billetes reales (1-2 billetes, montos "redondos"): el monto
  // exacto va aparte como chip "Exacto" y el cliente siempre puede tipear otro.
  const cashBillOptions = cashBillSuggestions(displayTotal);
  // Si el comercio no ofrece el método elegido, forzar el habilitado.
  // Va ANTES de cualquier return temprano: todos los hooks deben correr en
  // todos los renders (si no, React tira "fewer hooks" y cae el boundary).
  useEffect(() => {
    const opts = vendor?.deliveryOptions || "ambos";
    if (opts === "retiro" && method === "delivery") setMethod("pickup");
    if (opts === "domicilio" && method === "pickup") setMethod("delivery");
  }, [vendor?.deliveryOptions, method]);
  // Compra solo-giftcards: no hay entrega física — se fuerza retiro (sin
  // costo ni turnos) y la entrega real es digital por WhatsApp.
  useEffect(() => {
    if (isGiftOnly && method === "delivery") setMethod("pickup");
  }, [isGiftOnly, method]);

  if (mpReturn) {
    const s = mpReturn;
    // Datos del pedido criado: primero del endpoint (server = fuente de verdad),
    // si no, el stash local. Funciona aunque MP haya vuelto por su app.
    const storeName = mpOrderInfo?.storeName || s.stash?.storeName || "el local";
    const waNum = (mpOrderInfo?.whatsapp || s.stash?.whatsapp || "").replace(/[^0-9]/g, "");
    const totalTxt =
      mpOrderInfo?.total != null
        ? `$${Number(mpOrderInfo.total).toLocaleString("es-AR")}`
        : s.stash?.total != null
          ? `$${Number(s.stash.total).toLocaleString("es-AR")}`
          : null;
    const numTxt = mpOrderInfo?.pickupNumber ? ` Nro. ${mpOrderInfo.pickupNumber}` : "";
    const nameTxt = mpOrderInfo?.customerName || s.stash?.customerName || "un cliente";
    const trackSnippet = mpTrackToken ? ` · Seguimiento: ${window.location.origin}/seguimiento/${mpTrackToken}` : "";
    const waText =
      s.status === "failure"
        ? `Hola ${storeName}! Intenté pagar online y no se pudo cobrar. ¿Coordinamos el pedido por acá?`
        : `Hola ${storeName}! Soy ${nameTxt}: ya pagué mi pedido por Mercado Pago${totalTxt ? ` (${totalTxt})` : ""}${numTxt}.${trackSnippet}`;
    const waLink = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(waText)}` : null;
    const tiendaLink = mpOrderInfo?.slug ? `/tienda/${mpOrderInfo.slug}` : s.stash?.slug ? `/tienda/${s.stash.slug}` : "/";

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
              💬 {s.status === "failure" ? "Coordinar por WhatsApp" : "Consultar por WhatsApp"}
            </a>
          )}
          <Button variant="outline" className="w-full" onClick={() => router.push(tiendaLink)}>
            Volver a la tienda
          </Button>
        </div>
      </main>
    );
  }

  // Éxito post-confirmación (usa snapshots: el carrito ya se limpió).
  if (done) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <div className="text-6xl mb-4 animate-bounce-in">✅</div>
        <h1 className="font-display text-3xl font-semibold mb-4">
          Pedido enviado
        </h1>
        <p className="text-muted-foreground mb-4">
          Se abrió WhatsApp con tu pedido para{" "}
          <span className="font-medium">{doneVendorName || "el local"}</span>.
          {doneIsGift && (
            <span className="block mt-1 text-sm font-medium text-violet-700">
              🎁 Son solo tarjetas: te llegan por WhatsApp al confirmar el pago, sin retiro ni envío.
            </span>
          )}
          {doneIsPreview && (
            <span className="block mt-1 text-xs font-semibold text-amber-700">
              🧪 Fue un pedido de prueba.
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground/70 mb-6">
          📍 Si tu dirección es difícil de encontrar, mandale tu ubicación por WhatsApp al comercio.
          <span className="block mt-1">
            Seguí el estado de tu pedido con tu número de WhatsApp en{" "}
            <button onClick={() => router.push("/mis-pedidos")} className="underline text-primary hover:text-primary/80">
              Mis pedidos
            </button>
          </span>
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
          combo_members: (i as any).comboMembers,
        };
      }
      const modTotal = (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0);
      const unit = vline
        ? Math.round((lineNet / Math.max(1, i.qty)) * 100) / 100
        : i.price + modTotal;
      // Por peso: MP exige quantity entero → 1 × total de la línea.
      const isKg = (i as any).unit === "kg";
      return {
        offerId: i.offerId,
        variantId: i.variantId,
        name: isKg ? `${i.name} (${Number(i.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}kg)` : i.name,
        price: isKg ? Math.round(lineNet * 100) / 100 : unit,
        qty: isKg ? 1 : i.qty,
        unit: isKg ? "kg" : undefined,
        combo_members: (i as any).comboMembers,
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
        customerAddress: method === "delivery" ? fullAddress || null : null,
        method,
        deliveryZoneId: method === "delivery" && zonesMode && !deliveryOutOfArea && !shipActive ? activeZoneId || null : null,
        deliveryOutOfArea: method === "delivery" && deliveryOutOfArea && !shipActive,
        shippingZoneId: method === "delivery" && shipActive ? shipZoneId : null,
        deliveryWindow: method === "delivery" && showSlots && activeSlotId ? activeSlotId : null,
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
    } else {
      setError("No se pudo iniciar el pago con Mercado Pago. Probá de nuevo.");
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone) return;

    const e164 = toE164(phone);
    if (!e164) {
      setError(phoneMsg || "Ingresá tu celular con código de área (ej: 11 5555 1234)");
      return;
    }

    // "¿Con cuánto abonás?": obligatorio en efectivo + delivery (si el
    // comercio lo pide). El vuelto se lo lleva calculado el repartidor.
    if (!cashAskValid) {
      setError(
        cashAmountNum > 0
          ? "El monto con el que abonás tiene que ser igual o mayor al total del pedido."
          : "Elegí con cuánto vas a abonar en efectivo (el repartidor lleva el cambio)."
      );
      return;
    }

    // El pedido se crea recién al tocar "Enviar por WhatsApp" (confirmSend):
    // acá solo revisamos y abrimos el resumen.
    setError("");
    setShowSummary(true);
  }

  async function confirmSend() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setLoading(true);
    setError("");

    // Snapshot de todo lo que el POST y el mensaje necesitan: clear() vacía el
    // carrito y vendor queda en null.
    const vendorSnap = v;
    const itemsSnap = items;
    const methodSnap = method;
    const paymentSnap = paymentMethod;
    const nameSnap = name;
    const notesSnap = notes;
    const giftcardSnap = giftcardCode;
    const giftcardBalanceSnap = giftcardLookup.balance;
    const previewSnap = isPreview;
    const giftOnlySnap = isGiftOnly;
    const phoneSnap = toE164(phone);
    // Zona extendida elegida (Portal 659 Envíos): capturar antes de clear().
    const shipZoneSnap = shipZoneId;
    const shipActiveSnap =
      methodSnap === "delivery" && shipZoneId !== "none" && shipZoneId !== "" &&
      vendorShipZones.some((z: any) => String(z.id) === String(shipZoneId));

    if (!phoneSnap) {
      setError("Ingresá tu celular con código de área (ej: 11 5555 1234)");
      setLoading(false);
      sendingRef.current = false;
      return;
    }
    if (!cashAskValid) {
      setError(
        cashAmountNum > 0
          ? "El monto con el que abonás tiene que ser igual o mayor al total del pedido."
          : "Elegí con cuánto vas a abonar en efectivo (el repartidor lleva el cambio)."
      );
      setLoading(false);
      sendingRef.current = false;
      return;
    }

    // Popup síncrono: si esperamos el fetch antes de abrirlo, el navegador lo
    // bloquea por no ser parte del gesto del usuario.
    const popup = window.open("", "_blank");

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: vendorSnap?.id,
          customerName: nameSnap,
          customerPhone: phoneSnap,
          customerAddress: methodSnap === "delivery" ? fullAddress || null : null,
          method: methodSnap,
          paymentMethod: paymentSnap,
          customerId: userId || null,
          isPreview: previewSnap,
          previewToken: previewCtx?.token ?? null,
          deliveryZoneId: methodSnap === "delivery" && zonesMode && !deliveryOutOfArea && !shipActiveSnap ? activeZoneId || null : null,
          deliveryOutOfArea: methodSnap === "delivery" && deliveryOutOfArea && !shipActiveSnap,
          shippingZoneId: methodSnap === "delivery" && shipActiveSnap ? shipZoneSnap : null,
          deliveryWindow: methodSnap === "delivery" && showSlots && activeSlotId ? activeSlotId : null,
          giftcardCode: giftcardBalanceSnap != null ? giftcardSnap.trim() : undefined,
          cashAmount: cashAskVisible && cashAmountNum > 0 ? cashAmountNum : null,
          items: itemsSnap.map((i) => ({
            offerId: i.offerId,
            variantId: i.variantId,
            name: i.name,
            price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
            qty: i.qty,
            modifiers: (i.modifiers || []).map((m) => ({ label: m.label, group: m.group })),
            unit: (i as any).unit,
            combo_members: (i as any).comboMembers,
          })),
          total: displayTotal,
          notes: notesSnap.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        popup?.close();
        setError(data.error || "Error al crear el pedido");
        setLoading(false);
        return;
      }

      const waTotal = typeof data.total === "number" ? data.total : grandTotal;
      const waFee = typeof data.deliveryFee === "number" ? data.deliveryFee : deliveryFee;
      const waZone = typeof data.deliveryZoneName === "string" && data.deliveryZoneName ? data.deliveryZoneName : deliveryZoneName;
      const waOutOfArea = data.deliveryOutOfArea === true || deliveryOutOfArea;
      // Turno prometido: el que resolvió el server gana (pudo auto-asignar).
      const waWindowId = typeof data.deliveryWindow === "string" && data.deliveryWindow ? data.deliveryWindow : activeSlotId;
      const waWindowLabel = deliverySlots.find((s) => s.id === waWindowId)?.label || "";
      const waDeliveryLine = methodSnap === "delivery"
        ? `Envío: ${deliveryLabel({ fee: waFee, zoneName: waZone, outOfArea: waOutOfArea, freeShipping: !waOutOfArea && deliveryFreeShip })}${waOutOfArea ? " ⚠️" : ""}${waWindowLabel ? ` · Te lo llevamos ${waWindowLabel} 📦` : ""}${deliveryCoordinar ? " · Coordinamos por WhatsApp 🤝" : ""}`
        : undefined;
      const waCashDiscount = typeof data.cashDiscount === "number" ? data.cashDiscount : 0;
      const waCashPct = typeof data.cashPct === "number" ? data.cashPct : 0;
      const waVolumeDiscount = typeof data.volumeDiscount === "number" ? data.volumeDiscount : 0;
      const waVolumeLabel = Array.isArray(data.volumeApplied) && data.volumeApplied.length > 0
        ? data.volumeApplied.map((a: any) => `${a.groupName} (${a.label})`).join(" · ")
        : volumeLabel;
      const previewPrefix = previewSnap ? "🧪 [PRUEBA] " : "";
      const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, "");
      const trackUrl = data.trackToken ? `${baseUrl}/seguimiento/${data.trackToken}` : undefined;
      const registerUrl = data.trackToken ? `${baseUrl}/registro?next=/perfil` : undefined;
      const waMessage = buildComandaWhatsApp({
        vendorName: vendorSnap?.storeName || "",
        items: itemsSnap.map((i) => ({
          name: i.name,
          price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
          qty: i.qty,
          modifiers: (i.modifiers || []).map((m) => m.label),
          lineTotal: cartLineTotal(i),
          unit: (i as any).unit,
          combo_members: (i as any).comboMembers,
        })),
        total: waTotal,
        customerName: nameSnap,
        customerPhone: phoneSnap,
        method: methodSnap,
        isGiftOrder: giftOnlySnap,
        address: methodSnap === "delivery" ? fullAddress || undefined : undefined,
        paymentMethod: paymentSnap,
        cashAmount: cashAskVisible && cashAmountNum > 0 ? cashAmountNum : undefined,
        notes: notesSnap.trim() || undefined,
        trackUrl,
        registerUrl,
        cashDiscount: waCashDiscount,
        cashPct: waCashPct,
        volumeDiscount: waVolumeDiscount,
        volumeLabel: waVolumeLabel || undefined,
        deliveryLine: waDeliveryLine,
      });

      const waNumber = (vendorSnap?.whatsapp || "").replace(/[^0-9]/g, "");
      const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(previewPrefix + waMessage)}`;
      if (popup && !popup.closed) {
        popup.location.href = waUrl;
      } else {
        window.open(waUrl, "_blank");
      }

      clear();
      setDoneVendorName(vendorSnap?.storeName || null);
      setDoneIsPreview(previewSnap);
      setDoneIsGift(giftOnlySnap);
      setDoneTrackToken(data.trackToken || null);
      setShowSummary(false);
      setDone(true);
      setLoading(false);
    } catch {
      popup?.close();
      setError("Ocurrió un error al enviar el pedido. Probá de nuevo.");
      setLoading(false);
    } finally {
      sendingRef.current = false;
    }
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
        {(() => {
          // Una línea por pack (solo visual; totales intactos).
          const order = items.map((_, idx) => idx);
          const gkey = (idx: number) => vol.lines[idx]?.groupId || "";
          order.sort((a, b) => gkey(a).localeCompare(gkey(b)));
          let lastGroup = "\0";
          return order.map((idx) => {
          const i = items[idx];
          const gid = gkey(idx);
          const applied = gid ? vol.applied.find((a) => a.groupId === gid) : undefined;
          const header = applied && gid !== lastGroup ? (
            <p key={`gh-${gid}`} className="text-xs font-semibold text-emerald-700">
              🧊 {applied.groupName} · {applied.label}
            </p>
          ) : null;
          lastGroup = gid;
          const lineTotal = cartLineTotal(i);
          return (
            <Fragment key={`${i.offerId}-${idx}`}>
            {header}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 text-sm font-bold text-muted-foreground">
                {(i as any).unit === "kg"
                  ? `${Number(i.qty).toLocaleString("es-AR", { maximumFractionDigits: 2 })}k`
                  : `${i.qty}x`}
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
            </Fragment>
          );
          });
        })()}
        <div className="border-t border-border pt-3 mt-2 space-y-1">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Subtotal</span>
            <span>${total.toLocaleString("es-AR")}</span>
          </div>
          {method === "delivery" && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Envío{deliveryZoneName ? ` (${deliveryZoneName})` : ""}</span>
              {deliveryOutOfArea ? (
                <span className="font-semibold text-amber-700">A convenir*</span>
              ) : deliveryFreeShip ? (
                <span className="font-semibold text-green-700">🎉 ¡Gratis!</span>
              ) : (
                <span>${deliveryFee.toLocaleString("es-AR")}</span>
              )}
            </div>
          )}
          {deliveryOutOfArea && (
            <p className="text-xs text-amber-700">⚠️ El comercio te confirma el costo de envío por WhatsApp.</p>
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
          {giftcardDiscount > 0 && (
            <div className="flex justify-between text-sm font-medium text-violet-700">
              <span>Giftcard</span>
              <span>−${giftcardDiscount.toLocaleString("es-AR")}</span>
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
            {isGiftOnly && (
              <p className="text-[11px] text-violet-700 mt-1">🎁 Acá te llegan las tarjetas por WhatsApp.</p>
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
        {isGiftOnly ? (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-900">
            <p className="font-semibold">📲 Entrega digital por WhatsApp — sin costo</p>
            <p className="mt-0.5 text-violet-800">
              No hay retiro ni envío: al confirmar el pago te mandamos los códigos a tu WhatsApp.
            </p>
          </div>
        ) : (
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
        )}
        {method === "delivery" && (
          <div className="animate-fade-in-up space-y-3">
            {zonesMode ? (
              <div>
                <Label htmlFor="zone">Tu zona de entrega</Label>
                <select
                  id="zone"
                  value={zoneOut ? "__OUT__" : activeZoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                >
                  {vendorZones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} — ${Number(z.fee).toLocaleString("es-AR")}{z.description ? ` (${z.description})` : ""}
                    </option>
                  ))}
                  <option value="__OUT__">Otra zona (se coordina por WhatsApp)</option>
                </select>
              </div>
            ) : hasArea ? (
              <div>
                <Label>¿Estás dentro de nuestra zona de reparto?</Label>
                <p className="text-xs text-muted-foreground mt-0.5">“{v.deliveryAreaText}”</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setInArea(true)}
                    className={`rounded-xl border-2 py-2 px-1 text-xs sm:text-sm font-medium transition-all ${
                      inArea ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    Sí, estoy dentro{vendor?.deliveryFee != null ? ` → $${Number(vendor.deliveryFee).toLocaleString("es-AR")}` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInArea(false)}
                    className={`rounded-xl border-2 py-2 px-1 text-xs sm:text-sm font-medium transition-all ${
                      !inArea ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    No, estoy más lejos
                  </button>
                </div>
              </div>
            ) : null}
            {vendorShipZones.length > 0 && (
              <div>
                <Label htmlFor="shipzone">🚚 ¿Vivís fuera del barrio?</Label>
                <select
                  id="shipzone"
                  value={shipZoneId}
                  onChange={(e) => setShipZoneId(e.target.value)}
                  className="mt-1 w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
                >
                  <option value="none">No — quiero reparto del local</option>
                  {vendorShipZones.map((z: any) => (
                    <option key={String(z.id)} value={String(z.id)}>
                      {z.name} — ${Number(z.price).toLocaleString("es-AR")}
                      {Number(z.etaDays) > 0 ? ` · llega en ${z.etaDays} ${Number(z.etaDays) === 1 ? "día" : "días"}` : ""}
                      {z.description ? ` (${z.description}` : ""}
                    </option>
                  ))}
                </select>
                {shipZoneInfo && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    📦 Enviado {shipZoneInfo.carrierName ? `por ${shipZoneInfo.carrierName} ` : "por la logística del portal "}
                    con seguimiento: seguís tu paquete desde el link del pedido.
                  </p>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="address">Dirección</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Calle, entrecalles o barrio"
                required
              />
            </div>
            <div>
              <Label htmlFor="references">Referencias <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Input
                id="references"
                value={references}
                onChange={(e) => setReferences(e.target.value)}
                placeholder="Casa verde, portón de madera, negocio cercano…"
              />
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                Si tu calle no tiene número, contanos cómo ubicarte.
              </p>
            </div>
            {showSlots && (
              <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
                {deliveryPaused ? (
                  <p className="text-xs leading-relaxed rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-2">
                    ⏸️ Reparto en pausa{pauseClientMsg ? `: ${pauseClientMsg}` : ""}. Tu pedido sale en el próximo turno que elijas 👇
                    {allowPickup ? " Si no podés esperar, podés retirarlo en el local 🏠" : ""}
                  </p>
                ) : deliveryOpen === false && (
                  <p className="text-xs leading-relaxed rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-2">
                    😴 Ya cerramos el reparto por hoy: tu pedido sale en el próximo turno.
                    {allowPickup ? " Si no podés esperar, podés retirarlo en el local 🏠" : ""}
                  </p>
                )}
                <Label>¿Cuándo te lo llevamos? 🛵</Label>
                <div className="grid gap-1.5">
                  {deliverySlots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSlotId(s.id)}
                      className={`rounded-xl border-2 py-2 px-3 text-xs sm:text-sm font-medium text-left transition-all ${
                        activeSlotId === s.id
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      📦 {s.label}
                      {s.isToday && s.id === deliverySlots[0]?.id && deliveryOpen !== false ? " · lo antes posible" : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {isRetailVendor && method === "delivery" && deliveryCoordinar && (
              <p className="text-xs leading-relaxed rounded-lg bg-muted/40 border border-border px-2.5 py-2">
                🤝 Coordinamos por WhatsApp el horario de entrega.
              </p>
            )}
          </div>
        )}

        {/* Notes */}
        <div className="animate-fade-in-up">
          <Label htmlFor="notes">Instrucciones especiales (opcional)</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={esRetail ? "Ej: preferencia de color, timbre roto, alergias..." : "Sin cebolla, extra picante, acceso por el costado..."}
            className="h-16 text-sm resize-none"
            maxLength={200}
          />
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{notes.length}/200</p>
        </div>

        {/* Gift Card: canjea en efectivo/transferencia/coordinar (MP cobra aparte). */}
          <div className="animate-fade-in-up rounded-xl border border-border bg-muted/30 p-3 space-y-2">
            <button
              type="button"
              onClick={() => setShowGiftcard((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-sm font-medium text-primary"
            >
              🎁 ¿Tenés giftcard?
              <span className="text-muted-foreground text-xs">{showGiftcard ? "▲" : "▼"}</span>
            </button>
            {showGiftcard && (
              <div className="space-y-2">
                <Input
                  value={giftcardCode}
                  onChange={(e) => { setGiftcardCode(e.target.value.toUpperCase()); setGiftcardLookup({ loading: false, error: "", balance: null, expiresAt: null }); }}
                  placeholder="Código (ej: ABC-123456)"
                  className="h-10 text-sm font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const code = giftcardCode.trim();
                    if (!code || !v) return;
                    setGiftcardLookup({ loading: true, error: "", balance: null, expiresAt: null });
                    try {
                      const res = await fetch(`/api/giftcards/validate?vendorId=${encodeURIComponent(v.id)}&code=${encodeURIComponent(code)}`);
                      const data = await res.json();
                      if (data.ok) {
                        setGiftcardLookup({ loading: false, error: "", balance: Number(data.balance), expiresAt: typeof data.expires_at === "string" ? data.expires_at : null });
                      } else {
                        setGiftcardLookup({ loading: false, error: data.error || "Código no válido", balance: null, expiresAt: null });
                      }
                    } catch {
                      setGiftcardLookup({ loading: false, error: "Error de conexión", balance: null, expiresAt: null });
                    }
                  }}
                  disabled={giftcardLookup.loading || !giftcardCode.trim()}
                  className="w-full"
                >
                  {giftcardLookup.loading ? "Validando..." : "Aplicar giftcard"}
                </Button>
                {giftcardLookup.error && (
                  <p className="text-xs text-red-600">{giftcardLookup.error}</p>
                )}
                {giftcardLookup.balance != null && (
                  <div className="rounded-lg bg-green-50 border border-green-200 px-2.5 py-2 text-xs text-green-800">
                    Saldo disponible: <strong>${Number(giftcardLookup.balance).toLocaleString("es-AR")}</strong>
                    <span className="block mt-0.5 text-green-700">
                      {giftcardLookup.expiresAt ? `Válida hasta el ${fmtVence(giftcardLookup.expiresAt)}` : "Sin vencimiento"}
                    </span>
                    {giftcardDiscount > 0 && (
                      <span className="block mt-0.5">Se descuenta <strong>${giftcardDiscount.toLocaleString("es-AR")}</strong> del total</span>
                    )}
                  </div>
                )}
              </div>
            )}
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

        {/* ¿Con cuánto abonás? (efectivo + delivery): el repartidor lleva el cambio justo. */}
        {cashAskVisible && (
          <div className="rounded-2xl border border-green-200 bg-green-50/60 p-4 animate-fade-in-up space-y-2">
            <Label htmlFor="cash-amount">¿Con cuánto abonás? 💵</Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Así el repartidor te lleva el cambio justo.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCashAmount(String(displayTotal))}
                className="rounded-full border border-green-300 bg-white px-3 py-1 text-xs font-medium text-green-800 hover:bg-green-100 transition-colors"
              >
                Exacto (${displayTotal.toLocaleString("es-AR")})
              </button>
              {cashBillOptions.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setCashAmount(String(b))}
                  className="rounded-full border border-green-300 bg-white px-3 py-1 text-xs font-medium text-green-800 hover:bg-green-100 transition-colors"
                >
                  ${b.toLocaleString("es-AR")}
                </button>
              ))}
            </div>
            <Input
              id="cash-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              placeholder={`Monto con el que pagás (total: $${displayTotal.toLocaleString("es-AR")})`}
              className={cashAmount && cashAmountNum < displayTotal ? "border-red-300" : ""}
              required
            />
            {cashAmountNum > 0 && (
              cashAmountNum < displayTotal ? (
                <p className="text-xs text-red-600">
                  Tiene que ser igual o mayor al total (${displayTotal.toLocaleString("es-AR")}). Si no tenés cambio, pagá con Mercado Pago o coordiná por WhatsApp.
                </p>
              ) : (
                <p className="text-xs font-semibold text-green-700">
                  Tu cambio: ${cashChange.toLocaleString("es-AR")}
                </p>
              )
            )}
          </div>
        )}

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
          unit: (i as any).unit,
        }))}
        total={displayTotal}
        cashDiscount={cashActive ? cashDiscount : 0}
        cashPct={cashActive ? cashPct : 0}
        volumeDiscount={vol.volumeDiscount}
        volumeLabel={volumeLabel || undefined}
        deliveryFee={deliveryFee}
        method={method}
        address={method === "delivery" ? fullAddress || undefined : undefined}
        deliveryWindowLabel={method === "delivery" && activeSlotLabel ? activeSlotLabel : undefined}
        paymentMethod={paymentMethod}
        cashAmount={cashAskVisible && cashAmountNum > 0 ? cashAmountNum : undefined}
        cashChange={cashAskVisible && cashAmountNum > 0 ? cashChange : undefined}
        loading={loading}
        error={error}
      />
    </main>
  );
}
