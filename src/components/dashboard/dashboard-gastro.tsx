"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Switch } from "@/components/ui/switch";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LivePreview, TransferConfig, DeliveryFeeConfig } from "@/components/dashboard/shared";
import { MpConnectCard } from "@/components/dashboard/mp-connect-card";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import { LocationPicker } from "./location-picker";
import { StaffManager } from "@/components/vendor/staff-manager";
import type { Vendor, VendorGallery } from "@/types/database";

type Props = {
  vendor: Vendor | null;
  gallery: VendorGallery[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
  onCrop: (target: "cover" | "logo" | "offer") => void;
};

const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  gastronomia: [
    "empanadas",
    "pizzas",
    "pastas",
    "asado",
    "postres",
    "regional",
    "rotisería",
    "comida casera",
    "sushi",
    "hamburguesas",
    "sándwiches",
    "ensaladas",
    "repostería",
    "helados",
    "bebidas",
    "otras",
  ],
};

const PAYMENT_OPTIONS = [
  { label: "Efectivo", value: "Efectivo", icon: "💵" },
  { label: "Débito", value: "Débito", icon: "💳" },
  { label: "Crédito", value: "Crédito", icon: "💳" },
  { label: "Mercado Pago", value: "Mercado Pago", icon: "📱" },
  { label: "Transferencia", value: "Transferencia", icon: "🏦" },
];

const DELIVERY_OPTIONS = [
  { label: "Retiro", value: "retiro", icon: "🏠", desc: "en local" },
  { label: "Domicilio", value: "domicilio", icon: "🚗", desc: "" },
  { label: "Ambos", value: "ambos", icon: "🔄", desc: "" },
];

const PREP_TIME_OPTIONS = [15, 20, 25, 30, 40, 50, 60];

export default function DashboardGastro({
  vendor,
  gallery,
  msg,
  setMsg,
  reload,
  saveVendor,
  uploading,
  onCrop,
}: Props) {
  const [storeName, setStoreName] = useState(vendor?.store_name || "");
  const [storeCategory, setStoreCategory] = useState(vendor?.category || "otras");
  const [address, setAddress] = useState(vendor?.address || "");
  const [lat, setLat] = useState<number | null>(vendor?.lat ?? null);
  const [lng, setLng] = useState<number | null>(vendor?.lng ?? null);
  const [hours, setHours] = useState(vendor?.hours || "");
  const [description, setDescription] = useState(vendor?.description || "");
  const [whatsapp, setWhatsapp] = useState(vendor?.whatsapp || "");
  const [phone, setPhone] = useState(vendor?.phone || "");
  const [instagram, setInstagram] = useState(vendor?.instagram || "");
  const [facebook, setFacebook] = useState(vendor?.facebook || "");
  const [paymentMethods, setPaymentMethods] = useState<string[]>(
    vendor?.payment_methods
      ? vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean)
      : []
  );
  const [deliveryOptions, setDeliveryOptions] = useState(vendor?.delivery_options || "ambos");
  const [onlineOrders, setOnlineOrders] = useState(vendor?.accepts_online_orders !== false);
  const [cashDiscount, setCashDiscount] = useState(
    vendor?.cash_discount_pct != null ? String(vendor.cash_discount_pct) : ""
  );
  const [prepTimeMin, setPrepTimeMin] = useState(
    vendor?.prep_time_min || 30
  );

  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [storePreview, setStorePreview] = useState<string | null>(vendor?.image_url || null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(vendor?.logo_url || null);

  const [saving, setSaving] = useState(false);

  const [galleryUploading, setGalleryUploading] = useState(false);
  const galleryFileRef = useRef<HTMLInputElement>(null);

  const [printerIp, setPrinterIp] = useState(vendor?.printer_ip || "");
  const [printerPort, setPrinterPort] = useState(String(vendor?.printer_port || 9100));
  const [printMode, setPrintMode] = useState<"server" | "app">(
    vendor?.print_mode === "app" ? "app" : "server"
  );
  const [agentOnline, setAgentOnline] = useState(false);
  const [bridgeConfigured, setBridgeConfigured] = useState(false);
  const [printToken, setPrintToken] = useState<string | null>(vendor?.print_token || null);
  const [lastPrint, setLastPrint] = useState<{
    at: string | null;
    ok: boolean | null;
    error: string | null;
  }>({ at: null, ok: null, error: null });
  const [printQueue, setPrintQueue] = useState<{ id: string; type: string; enqueuedAt: number }[]>(
    []
  );
  const [queueLoading, setQueueLoading] = useState(false);

  const [printerSectionOpen, setPrinterSectionOpen] = useState(false);

  useEffect(() => {
    const handler = () => setPrinterSectionOpen(true);
    window.addEventListener("portal:open-printer-config", handler);
    return () => window.removeEventListener("portal:open-printer-config", handler);
  }, []);

  useEffect(() => {
    setStoreName(vendor?.store_name || "");
    setStoreCategory(vendor?.category || "otras");
    setAddress(vendor?.address || "");
    setLat(vendor?.lat ?? null);
    setLng(vendor?.lng ?? null);
    setHours(vendor?.hours || "");
    setDescription(vendor?.description || "");
    setWhatsapp(vendor?.whatsapp || "");
    setPhone(vendor?.phone || "");
    setInstagram(vendor?.instagram || "");
    setFacebook(vendor?.facebook || "");
    setPaymentMethods(
      vendor?.payment_methods
        ? vendor.payment_methods.split(", ").map((s: string) => s.trim()).filter(Boolean)
        : []
    );
    setDeliveryOptions(vendor?.delivery_options || "ambos");
    setOnlineOrders(vendor?.accepts_online_orders !== false);
    setCashDiscount(vendor?.cash_discount_pct != null ? String(vendor.cash_discount_pct) : "");
    setPrepTimeMin(vendor?.prep_time_min || 30);
    setStorePreview(vendor?.image_url || null);
    setLogoPreview(vendor?.logo_url || null);
    setPrinterIp(vendor?.printer_ip || "");
    setPrinterPort(String(vendor?.printer_port || 9100));
    setPrintMode(vendor?.print_mode === "app" ? "app" : "server");
    setPrintToken(vendor?.print_token || null);
  }, [vendor]);

  useEffect(() => {
    if (printMode !== "app") return;
    let mounted = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/vendor/print/status");
        const data = await res.json();
        if (!mounted || !data.vendor) return;
        setAgentOnline(!!data.agent?.online);
        setBridgeConfigured(!!data.bridgeConfigured);
        setPrintToken(data.vendor.print_token || null);
        setLastPrint({
          at: data.vendor.last_print_at || null,
          ok: data.vendor.last_print_ok ?? null,
          error: data.vendor.last_print_error || null,
        });
      } catch {
        /* relay sin configurar o error transitorio */
      }
    };
    poll();
    const interval = setInterval(poll, 6000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [printMode]);

  const changePrintMode = async (mode: "server" | "app") => {
    setPrintMode(mode);
    await saveVendor({ print_mode: mode });
    if (mode === "app") {
      const res = await fetch("/api/vendor/print/status");
      const data = await res.json().catch(() => null);
      setPrintToken(data?.vendor?.print_token || printToken);
    }
  };

  const regenerateToken = async () => {
    const res = await fetch("/api/vendor/print/token", { method: "POST" });
    const data = await res.json().catch(() => ({ error: "Error de red" }));
    if (data.token) {
      setPrintToken(data.token);
      setMsg("✅ Token regenerado — pegá el nuevo token en la app Portal Print");
    } else {
      setMsg(`❌ ${data.error || "No se pudo regenerar el token"}`);
    }
  };

  const testPrinter = async () => {
    const res = await fetch("/api/print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    const data = await res.json().catch(() => ({ error: "Respuesta inválida del servidor" }));
    if (data.offline) {
      setMsg("❌ La app Portal Print no está conectada (abrí la app en tu celu)");
    } else if (data.ok) {
      setMsg("✅ Impresión de prueba enviada");
    } else {
      setMsg(`❌ ${data.error || (data.reason ?? "Error al imprimir")}`);
    }
  };

  const loadPrintQueue = async () => {
    setQueueLoading(true);
    try {
      const res = await fetch("/api/vendor/print/queue");
      const data = await res.json().catch(() => null);
      setPrintQueue(data?.jobs || []);
    } catch {
      setPrintQueue([]);
    } finally {
      setQueueLoading(false);
    }
  };

  const cancelPrintJob = async (jobId: string) => {
    const res = await fetch(`/api/vendor/print/queue?id=${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) setMsg("🗑️ Trabajo cancelado de la cola");
    else setMsg(`❌ ${data.error || "No se pudo cancelar el trabajo"}`);
    setTimeout(() => setMsg(""), 2500);
    loadPrintQueue();
  };

  const clearPrintQueue = async () => {
    const res = await fetch("/api/vendor/print/queue", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (data.ok) setMsg(`🧹 Cola vaciada (${data.removed ?? "0"} trabajos descartados)`);
    else setMsg(`❌ ${data.error || "No se pudo vaciar la cola"}`);
    setTimeout(() => setMsg(""), 2500);
    loadPrintQueue();
  };

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg("");

    const data: Record<string, unknown> = {
      store_name: storeName,
      category: storeCategory,
      address,
      lat,
      lng,
      hours,
      description,
      whatsapp,
      phone,
      instagram,
      facebook,
      payment_methods: paymentMethods.join(", "),
      delivery_options: deliveryOptions,
      prep_time_min: prepTimeMin,
      cash_discount_pct: cashDiscount === "" ? null : Number(cashDiscount),
    };

    if (storeFile) {
      const fd = new FormData();
      fd.append("file", storeFile);
      fd.append("folder", "vendors");
      try {
        const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
        const uploaded = await res.json();
        if (uploaded.url) {
          data.image_url = uploaded.url;
        } else {
          setMsg("No se pudo subir la foto del comercio");
          setSaving(false);
          return;
        }
      } catch {
        setMsg("Error al subir la foto del comercio");
        setSaving(false);
        return;
      }
    }

    if (logoFile) {
      const fd = new FormData();
      fd.append("file", logoFile);
      fd.append("folder", "vendors");
      try {
        const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
        const uploaded = await res.json();
        if (uploaded.url) {
          data.logo_url = uploaded.url;
        } else {
          setMsg("No se pudo subir el logo");
          setSaving(false);
          return;
        }
      } catch {
        setMsg("Error al subir el logo");
        setSaving(false);
        return;
      }
    }

    await saveVendor(data);
    setStoreFile(null);
    setLogoFile(null);
    setSaving(false);
  }, [
    storeName, storeCategory, address, lat, lng, hours, description,
    whatsapp, phone, instagram, facebook, paymentMethods,
    deliveryOptions, prepTimeMin, cashDiscount,
    storeFile, logoFile, saveVendor, setMsg,
  ]);

  async function handleGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setGalleryUploading(true);
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "gallery");
      const uploadRes = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const uploadData = await uploadRes.json();
      if (!uploadData.url) { setMsg(uploadData.error || "Error al subir imagen"); return; }
      const galleryRes = await fetch("/api/vendor/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: uploadData.url }),
      });
      const galleryData = await galleryRes.json();
      if (galleryData.error) { setMsg(galleryData.error); return; }
      reload();
    } catch { setMsg("Error de conexión"); }
    finally { setGalleryUploading(false); if (galleryFileRef.current) galleryFileRef.current.value = ""; }
  }

  async function handleDeleteGalleryImage(id: string) {
    try {
      const res = await fetch(`/api/vendor/gallery/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) { setMsg(data.error); return; }
      reload();
    } catch { setMsg("Error de conexión"); }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <LivePreview
        storeName={storeName}
        storePreview={storePreview}
        vendor={vendor}
        logoPreview={logoPreview}
        description={description}
        hours={hours}
        address={address}
        paymentMethods={paymentMethods}
        whatsapp={whatsapp}
        isService={false}
      />

      <CollapsibleSection icon="🏪" title="Tu comercio" defaultOpen>
        <div className="space-y-3">
          <div>
            <Label>Nombre</Label>
            <Input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Categoría</Label>
            <input
              list="cat-suggestions-gastro"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={storeCategory}
              onChange={(e) => setStoreCategory(e.target.value)}
              placeholder="Ej: empanadas, pizzas..."
            />
            <datalist id="cat-suggestions-gastro">
              {(CATEGORY_SUGGESTIONS.gastronomia || []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📍" title="Ubicación y horarios">
        <div className="space-y-3">
          <div>
            <Label>Dirección</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle y número"
            />
          </div>
          <LocationPicker
            lat={lat}
            lng={lng}
            onChange={(newLat, newLng) => {
              setLat(newLat);
              setLng(newLng);
            }}
            neighborhood={vendor?.neighborhood}
          />
          <div>
            <Label>Horarios</Label>
            <HoursEditor value={hours} onChange={setHours} />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📸" title="Fotos">
        <div className="space-y-3">
          <div>
            <Label>Foto del comercio</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) {
                  setStoreFile(f);
                  setStorePreview(URL.createObjectURL(f));
                  onCrop("cover");
                }
              }}
            />
            {storePreview && (
              <img
                src={storePreview}
                alt="Vista previa"
                className="mt-2 h-24 w-full object-cover rounded-lg"
              />
            )}
          </div>
          <div>
            <Label>Logo</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                if (f) {
                  setLogoFile(f);
                  setLogoPreview(URL.createObjectURL(f));
                  onCrop("logo");
                }
              }}
            />
            {logoPreview && (
              <img
                src={logoPreview}
                alt="Logo"
                className="mt-2 h-16 w-16 object-cover rounded-full border"
              />
            )}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="📝" title="Descripción">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Contá qué hacés..."
        />
      </CollapsibleSection>

      <CollapsibleSection icon="📱" title="Contacto">
        <div className="space-y-3">
          <div>
            <Label>WhatsApp</Label>
            <Input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="5492215550000"
            />
          </div>
          <div>
            <Label>Teléfono directo</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="2215550000"
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🌐" title="Redes sociales">
        <div className="space-y-3">
          <div>
            <Label>Instagram</Label>
            <Input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@tulocal"
            />
          </div>
          <div>
            <Label>Facebook</Label>
            <Input
              value={facebook}
              onChange={(e) => setFacebook(e.target.value)}
              placeholder="https://facebook.com/tulocal"
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="💳" title="Pago y entrega">
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Medios de pago</Label>
            <ChipToggle
              options={PAYMENT_OPTIONS}
              value={paymentMethods}
              onChange={setPaymentMethods}
            />
          </div>
          {paymentMethods.includes("Transferencia") && (
            <TransferConfig vendor={vendor} saveVendor={saveVendor} />
          )}
          {paymentMethods.includes("Efectivo") && (
            <div>
              <Label className="mb-2 block">Descuento en efectivo (%)</Label>
              <Input
                type="number"
                min={0}
                max={99}
                step="any"
                value={cashDiscount}
                onChange={(e) => setCashDiscount(e.target.value)}
                placeholder="Ej: 10"
                className="max-w-40"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Se muestra junto a cada precio y se descuenta solo al pagar en efectivo.
              </p>
            </div>
          )}
          <MpConnectCard
            mpUserId={vendor?.mp_user_id ?? null}
            mpConnectedAt={vendor?.mp_connected_at ?? null}
          />
          <div>
            <Label className="mb-2 block">Entrega</Label>
            <RadioCards
              options={DELIVERY_OPTIONS}
              value={deliveryOptions}
              onChange={setDeliveryOptions}
            />
          </div>
          {deliveryOptions !== "retiro" && (
            <DeliveryFeeConfig vendor={vendor} saveVendor={saveVendor} />
          )}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <div>
              <Label className="text-sm">Aceptar pedidos online</Label>
              <p className="text-xs text-muted-foreground">
                {onlineOrders
                  ? "Tu micrositio muestra carrito y toman pedidos por la app."
                  : "Apagado: solo contacto por WhatsApp, sin carrito."}
              </p>
            </div>
            <Switch
              checked={onlineOrders}
              onCheckedChange={async (v) => {
                setOnlineOrders(v);
                await saveVendor({ accepts_online_orders: v });
              }}
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="⏱️" title="Tiempo de preparación">
        <div className="space-y-3">
            <div>
              <Label>Tiempo de preparación</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aparece como &quot;⏱️ X min&quot; en tu micrositio y cuenta como referencia del pedido.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {PREP_TIME_OPTIONS.map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setPrepTimeMin(min)}
                    className={`flex-1 min-w-0 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                      prepTimeMin === min
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {min} min
                  </button>
                ))}
              </div>
              <div className="mt-2">
                <Input
                  type="number"
                  min={10}
                  max={180}
                  value={prepTimeMin}
                  onChange={(e) => setPrepTimeMin(Number(e.target.value) || 30)}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1 text-center">
                ⏱️ {prepTimeMin} min
              </p>
            </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🛵" title="Equipo / Repartidor">
        <StaffManager storeName={vendor?.store_name} />
      </CollapsibleSection>

      <CollapsibleSection id="printer-config" icon="🖨️" title="Impresora térmica" open={printerSectionOpen} onToggle={setPrinterSectionOpen}>
        <div className="space-y-3">
          <div>
            <Label>Cómo imprime</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => changePrintMode("app")}
                className={`rounded-lg border-2 px-3 py-2 text-sm font-medium text-left transition-colors ${
                  printMode === "app"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30"
                }`}
              >
                📱 App en tu celu
                <p className="text-[10px] font-normal mt-1 opacity-80">
                  Impresora en la red local (recomendado)
                </p>
              </button>
              <button
                type="button"
                onClick={() => changePrintMode("server")}
                className={`rounded-lg border-2 px-3 py-2 text-sm font-medium text-left transition-colors ${
                  printMode === "server"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30"
                }`}
              >
                🖥️ Servidor (TCP)
                <p className="text-[10px] font-normal mt-1 opacity-80">
                  El VPS imprime directo a la impresora
                </p>
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              {printMode === "app"
                ? "La app Portal Print (en tu celular, mismo Wi-Fi que la impresora) recibe el ticket y lo imprime. No hace falta abrir puertos ni IP pública."
                : "El servidor envía el ticket por TCP directo. Requiere alcanzar la impresora desde el VPS (VPN o puerto reenviado)."}
            </p>
          </div>

          {printMode === "app" && (
            <>
              <div className="flex items-start justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className={agentOnline ? "text-green-500" : "text-red-500"}>
                    {agentOnline ? "🟢" : "🔴"}
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {agentOnline ? "App conectada" : "App no conectada"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {agentOnline
                        ? "Impresión automática activa: los pedidos confirmados salen solos"
                        : "Instalá y conectá la app abajo"}
                    </p>
                  </div>
                </div>
              </div>

              <details className="rounded-lg border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  📱 Configurar la app Portal Print
                </summary>

                <a
                  href="/downloads/portal-print.apk"
                  download="portal-print.apk"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
                >
                  📥 Descargar la app (Android)
                </a>
                <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                  Habilitá {`"Instalar apps desconocidas"`} cuando lo pida el navegador.
                </p>

                <ol className="mt-2 space-y-1 list-decimal pl-4 text-muted-foreground">
                  <li>
                    Conectá el celular al <strong>mismo Wi-Fi</strong> que la impresora.
                  </li>
                  <li>
                    Descargá e instalá la app tocando el botón de arriba.
                  </li>
                  <li>
                    En la app pegá el <strong>token</strong> de abajo, guardá y conectá.
                  </li>
                  <li>
                    Dejá la app <strong>abierta</strong> en el mostrador (enchufada) y tocá
                    "Imprimir prueba".
                  </li>
                </ol>
              </details>

              <details className="rounded-lg border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  💻 Descargar para PC (Windows)
                </summary>

                <a
                  href="/uploads/downloads/portal-print-agent.zip?v=3"
                  download="portal-print-agent.zip"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-fresh text-fresh-foreground px-4 py-2.5 text-sm font-semibold hover:bg-fresh/80 active:scale-[0.98] transition-all"
                >
                  📥 Descargar el agente (Windows, .zip)
                </a>

                <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                  No instala nada ni requiere permisos de administrador: descargás el .zip,
                  extraés la carpeta y abrís <code>Portal Print Agent.exe</code>.
                </p>

                <ol className="mt-2 space-y-1 list-decimal pl-4 text-muted-foreground">
                  <li>La impresora debe estar en la <strong>misma red</strong> que la PC.</li>
                  <li>Descargá el <strong>.zip</strong> y <strong>extraelo</strong> en una carpeta.</li>
                  <li>Abrí <strong>Portal Print Agent.exe</strong> (doble clic).</li>
                  <li>Pegá el <strong>token</strong> de abajo, la <strong>IP de la impresora</strong> y tocá <strong>Guardar</strong>.</li>
                  <li>Usá <strong>Probar impresora</strong> para verificar y activá <strong>«Arrancar al encender la PC»</strong>.</li>
                </ol>

                <p className="mt-2 rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
                  Al cerrar la ventana, el agente sigue imprimiendo en segundo plano desde la
                  bandeja del sistema (ícono junto al reloj).
                </p>
                <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800">
                  ¿Tu antivirus (AVG/Avast) lo marca? Es un <strong>falso positivo heurístico</strong>.
                  Restaurá el archivo, agregá una excepción y avisanos. Guía en
                  <a href="/manuales/impresora" className="underline"> el manual de impresora</a>.
                </p>
              </details>

              {printToken && (
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Token de la app</Label>
                    <button
                      type="button"
                      className="text-xs text-primary font-medium"
                      onClick={() => {
                        navigator.clipboard?.writeText(printToken).catch(() => undefined);
                        setMsg("✅ Token copiado");
                      }}
                    >
                      Copiar
                    </button>
                  </div>
                  <p className="font-mono text-xs break-all bg-muted rounded px-2 py-1.5">
                    {printToken}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-destructive"
                    onClick={regenerateToken}
                  >
                    Regenerar token
                  </button>
                </div>
              )}

              {!bridgeConfigured && (
                <p className="text-[10px] text-amber-500">
                  ⚠️ El relay de impresión aún no está configurado en el servidor
                  (PRINT_BRIDGE_URL). Avisá al administrador.
                </p>
              )}

              {lastPrint.at && (
                <p className="text-[10px] text-muted-foreground/70">
                  Última impresión: {new Date(lastPrint.at).toLocaleString("es-AR")} ·{" "}
                  {lastPrint.ok === true
                    ? "✅ OK"
                    : lastPrint.ok === false
                      ? `❌ ${lastPrint.error || "error"}`
                      : ""}
                </p>
              )}
            </>
          )}

          <div className="flex items-center justify-between">
            <div>
              <Label>Impresión automática</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Imprime comanda automáticamente al aceptar un pedido
              </p>
            </div>
            <Switch
              checked={vendor?.auto_print || false}
              onCheckedChange={(v) => saveVendor({ auto_print: v })}
            />
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div>
              <Label className="text-sm font-semibold">Configuración de ticket</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Qué sale en el encabezado de todos los documentos impresos. El nombre del
                local y el pie de página siempre se imprimen.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Logo del comercio</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Redondo, junto al nombre (cargalo en Datos del local)
                </p>
              </div>
              <Switch
                checked={vendor?.print_logo ?? true}
                onCheckedChange={(v) => saveVendor({ print_logo: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Dirección</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  La dirección que cargaste en Datos del local
                </p>
              </div>
              <Switch
                checked={vendor?.print_address ?? true}
                onCheckedChange={(v) => saveVendor({ print_address: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Teléfono / WhatsApp</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Los números de contacto del local
                </p>
              </div>
              <Switch
                checked={vendor?.print_phone ?? true}
                onCheckedChange={(v) => saveVendor({ print_phone: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Redes sociales</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Instagram y Facebook del local
                </p>
              </div>
              <Switch
                checked={vendor?.print_social ?? true}
                onCheckedChange={(v) => saveVendor({ print_social: v })}
              />
            </div>
          </div>
          <div>
            <Label>IP de la impresora</Label>
            <Input
              value={printerIp}
              onChange={(e) => setPrinterIp(e.target.value)}
              onBlur={() => saveVendor({ printer_ip: printerIp || null })}
              placeholder="192.168.1.100"
              className="mt-1"
            />
            <p className="text-[10px] text-muted-foreground/50 mt-0.5">
              Impresora conectada a la red local (TCP)
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Puerto</Label>
              <Input
                type="number"
                value={printerPort}
                onChange={(e) => setPrinterPort(e.target.value)}
                onBlur={() => saveVendor({ printer_port: Number(printerPort) || 9100 })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Tamaño papel</Label>
              <div className="flex gap-2 mt-1">
                {["58mm", "80mm"].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => saveVendor({ paper_size: size })}
                    className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                      (vendor?.paper_size || "80mm") === size
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" type="button" onClick={testPrinter}>
            🖨️ Imprimir prueba
          </Button>

          {printMode === "app" && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label>Cola de impresión</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs text-primary font-medium"
                    onClick={loadPrintQueue}
                  >
                    {queueLoading ? "Cargando..." : "Actualizar"}
                  </button>
                  {printQueue.length > 0 && (
                    <button type="button" className="text-xs text-destructive font-medium" onClick={clearPrintQueue}>
                      Vaciar cola
                    </button>
                  )}
                </div>
              </div>
              {printQueue.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No hay trabajos esperando a la app.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {printQueue.map((job) => (
                    <div key={job.id} className="flex items-center justify-between rounded-lg bg-muted/60 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-medium">
                          {job.type === "comanda" ? "🍳 Comanda" : job.type === "retiro" ? "🎫 Retiro" : job.type === "precuenta" ? "🧾 Precuenta" : job.type === "ticket" ? "🧾 Ticket" : job.type === "test" ? "🧪 Prueba" : job.type}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(job.enqueuedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-destructive font-medium flex-shrink-0"
                        onClick={() => cancelPrintJob(job.id)}
                      >
                        Cancelar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🍽️" title="Menú" defaultOpen>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Platos, categorías, opciones, precios por volumen e importación de Excel ahora se
            gestionan desde la pestaña <strong>Menú</strong>, en un panel integrado.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.dispatchEvent(new CustomEvent("portal:go-menu"))}
          >
            🍽️ Ir al Menú
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon="🖼️" title={`Galería (${gallery.length})`}>
        <div className="space-y-3">
          <input ref={galleryFileRef} type="file" accept="image/*" onChange={handleGalleryUpload} className="hidden" />
          <Button type="button" onClick={() => galleryFileRef.current?.click()} disabled={galleryUploading} className="w-full" variant="outline">
            {galleryUploading ? "Subiendo..." : "Agregar foto"}
          </Button>
          {gallery.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Todavía no subiste fotos.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {gallery.map((item: any) => (
                <div key={item.id} className="border border-border rounded-lg overflow-hidden bg-background">
                  <div className="aspect-square relative">
                    <img src={item.image_url} alt={item.caption || "Foto"} className="w-full h-full object-cover" />
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="w-full h-7 text-xs text-red-600" onClick={() => handleDeleteGalleryImage(item.id)}>
                    Eliminar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {msg && (
        <p className="text-sm text-red-600">{msg}</p>
      )}

      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Guardando..." : "Guardar cambios"}
      </Button>
    </form>
  );
}
