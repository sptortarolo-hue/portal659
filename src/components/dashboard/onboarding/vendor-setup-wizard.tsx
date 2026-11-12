"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Modal } from "@/components/ui/modal";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { RadioCards } from "@/components/ui/radio-cards";
import { HoursEditor } from "@/components/dashboard/hours-editor";
import { LocationPicker } from "@/components/dashboard/location-picker";
import { LivePreview, apiJson } from "@/components/dashboard/shared";
import {
  catalogNoun,
  setupChecks,
  setupKind,
  wizardSteps,
  type SetupKind,
  type WizardStep,
  type WizardStepId,
} from "@/lib/setup-steps";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft";
import type { Vendor, Product } from "@/types/database";

// react-easy-crop no SSR (mismo patrón que el dashboard).
const ImageCropModal = dynamic(
  () => import("@/components/ui/image-crop-modal").then((m) => m.ImageCropModal),
  { ssr: false }
);

const VERTICAL_OPTIONS = [
  { value: "gastronomia", label: "Gastronomía", icon: "🍽️" },
  { value: "comercio", label: "Comercio", icon: "🏪" },
  { value: "servicio", label: "Servicio", icon: "🔧" },
  { value: "moda", label: "Ropa y Accesorios", icon: "👗" },
  { value: "estetica", label: "Peluquería y Estética", icon: "💇" },
  { value: "salud", label: "Salud y Bienestar", icon: "🧘" },
  { value: "taller", label: "Talleres y Reparaciones", icon: "🛠️" },
  { value: "otro", label: "Otro", icon: "📋" },
];

const PAYMENT_OPTIONS = [
  { label: "Efectivo", value: "Efectivo", icon: "💵" },
  { label: "Débito", value: "Débito", icon: "💳" },
  { label: "Crédito", value: "Crédito", icon: "💳" },
  { label: "Mercado Pago", value: "Mercado Pago", icon: "📱" },
  { label: "Transferencia", value: "Transferencia", icon: "🏦" },
];

const DELIVERY_OPTIONS = [
  { label: "Retiro", value: "retiro", icon: "🏠", desc: "en el local" },
  { label: "Domicilio", value: "domicilio", icon: "🚗", desc: "" },
  { label: "Ambos", value: "ambos", icon: "🔄", desc: "" },
];

/** Sugerencias de rubro (mismo espíritu que CATEGORY_SUGGESTIONS de los dashboards). */
const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  gastronomia: ["Pizzería", "Heladería", "Rotisería", "Cafetería", "Hamburguesería", "Panadería"],
  comercio: ["Almacén", "Farmacia", "Librería", "Ferretería", "Verdulería", "Regalería"],
  moda: ["Indumentaria", "Carteras", "Calzado", "Joyería"],
  servicio: ["Plomería", "Electricidad", "Gas", "Limpieza"],
  estetica: ["Peluquería", "Barbería", "Uñas", "Pestañas", "Masajes"],
  salud: ["Kinesiología", "Nutrición", "Podología"],
  taller: ["Bicicletería", "Servicio técnico", "Gomería", "Cerrajería"],
  otro: ["Otro"],
};

type FormState = {
  vertical: string;
  store_name: string;
  category: string;
  description: string;
  address: string;
  lat: number | null;
  lng: number | null;
  hours: string;
  whatsapp: string;
  phone: string;
  instagram: string;
  facebook: string;
  image_url: string;
  logo_url: string;
  payment_methods: string[];
  delivery_options: string;
  services_list: string;
  service_area: string;
  accepting_quotes: boolean;
  bookings_enabled: boolean;
  urgent_enabled: boolean;
  urgent_surcharge_pct: string;
};

const BLANK: FormState = {
  vertical: "comercio",
  store_name: "",
  category: "",
  description: "",
  address: "",
  lat: null,
  lng: null,
  hours: "",
  whatsapp: "",
  phone: "",
  instagram: "",
  facebook: "",
  image_url: "",
  logo_url: "",
  payment_methods: [],
  delivery_options: "ambos",
  services_list: "",
  service_area: "",
  accepting_quotes: true,
  bookings_enabled: true,
  urgent_enabled: false,
  urgent_surcharge_pct: "30",
};

function formFromVendor(v: Vendor | null): FormState {
  if (!v) return BLANK;
  return {
    vertical: v.vertical || "comercio",
    store_name: v.store_name || "",
    category: v.category || "",
    description: v.description || "",
    address: v.address || "",
    lat: v.lat ?? null,
    lng: v.lng ?? null,
    hours: v.hours || "",
    whatsapp: v.whatsapp || "",
    phone: v.phone || "",
    instagram: v.instagram || "",
    facebook: v.facebook || "",
    image_url: v.image_url || "",
    logo_url: v.logo_url || "",
    payment_methods: v.payment_methods ? v.payment_methods.split(",").map((s) => s.trim()).filter(Boolean) : [],
    delivery_options: v.delivery_options || "ambos",
    services_list: v.services_list || "",
    service_area: v.service_area || "",
    accepting_quotes: v.accepting_quotes ?? true,
    bookings_enabled: v.bookings_enabled ?? true,
    urgent_enabled: v.urgent_enabled ?? false,
    urgent_surcharge_pct: String(v.urgent_surcharge_pct ?? 30),
  };
}

export type VendorSetupWizardProps = {
  /** "alta" = pantalla completa para un comercio que aún no existe.
   *  "completar" = modal sobre un comercio ya creado (tienda Nº2 / retomar). */
  mode: "alta" | "completar";
  vendor: Vendor | null;
  offers?: Product[];
  categories?: { id: string; name: string; position: number }[];
  /** POST /api/vendor/me envuelto: devuelve el resultado para detectar errores. */
  saveVendor: (data: Record<string, unknown>) => Promise<{ error?: string; vendor?: Vendor }>;
  /** Refrescar ofertas/categorías tras cargar el primer producto. */
  reload?: () => void;
  /** Tras el primer guardado (el comercio pasa a existir). */
  onCreated?: () => void;
  /** Terminar: cerrar el paso a paso y volver al panel. */
  onDone: () => void;
  onGoTab?: (tab: string) => void;
  onGoSection?: (section: string) => void;
};

type CropTarget = "cover" | "logo" | null;

export function VendorSetupWizard({
  mode,
  vendor,
  offers = [],
  categories = [],
  saveVendor,
  reload,
  onCreated,
  onDone,
  onGoTab,
  onGoSection,
}: VendorSetupWizardProps) {
  // Antes de que exista el comercio no hay vendorId: la clave del borrador es
  // fija ("nuevo") y se migra sola al crearlo (saveDraft es best-effort).
  const draftId = vendor?.id ?? "nuevo";
  const [form, setForm] = useState<FormState>(() => formFromVendor(vendor));
  const [step, setStep] = useState<WizardStepId>("negocio");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [publishSent, setPublishSent] = useState(!!vendor?.publish_requested_at);
  // El tipo de arranque sale del vendor guardado o del formulario (durante el
  // alta el vertical se elige recién en el paso 1).
  const kind: SetupKind = setupKind(vendor?.vertical || form.vertical);
  const steps: WizardStep[] = useMemo(() => wizardSteps(kind), [kind]);

  // Foto en crop (estado local: el modal de crop vive en el wizard).
  const [crop, setCrop] = useState<CropTarget>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropBusy, setCropBusy] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  // Alta rápida del primer producto.
  const [offName, setOffName] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offCategory, setOffCategory] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offFile, setOffFile] = useState<File | null>(null);
  const [offSaving, setOffSaving] = useState(false);
  const [offMsg, setOffMsg] = useState("");

  const restored = useRef(false);

  // Rehidratar: borrador (24h) manda sobre el vendor guardado, así se retoma
  // justo donde se cortó (recarga, crash, deploy a mitad de sesión).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const d = loadDraft<{ step?: WizardStepId; form?: FormState }>(draftId, "setup");
      if (d?.form) setForm({ ...BLANK, ...formFromVendor(vendor), ...d.form });
      if (d?.step && steps.some((s) => s.id === d.step)) setStep(d.step as WizardStepId);
      else if (vendor) setStep("listo");
    } catch {
      /* borrador corrupto: se arranca de cero */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // Persistir el avance (debounce 400ms, mismo patrón que el dashboard).
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => saveDraft(draftId, "setup", { step, form }), 400);
    return () => clearTimeout(t);
  }, [step, form, draftId]);

  const idx = steps.findIndex((s) => s.id === step);
  const current = steps[idx] ?? steps[0];
  const isLast = idx >= steps.length - 1;
  const noun = catalogNoun(vendor?.vertical || form.vertical);

  // Checks en vivo: con vendor creado se leen de la DB; durante el alta, del
  // formulario (así el paso "¡Listo!" muestra lo que falta en el momento).
  const checks = useMemo(
    () =>
      setupChecks(
        vendor ?? {
          store_name: form.store_name,
          category: form.category,
          description: form.description,
          image_url: form.image_url,
          logo_url: form.logo_url,
          address: form.address,
          lat: form.lat,
          lng: form.lng,
          hours: form.hours,
          whatsapp: form.whatsapp,
          payment_methods: form.payment_methods.join(", "),
          vertical: form.vertical,
        },
        { offers: offers.length },
        kind
      ),
    [vendor, form, offers.length, kind]
  );
  const pendingCount = checks.filter((c) => !c.optional && !c.done).length;

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  async function uploadImage(file: File, folder: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    try {
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      return data?.url || null;
    } catch {
      return null;
    }
  }

  /** payload del paso actual: solo lo que ese toca. */
  function payloadFor(id: WizardStepId): Record<string, unknown> {
    switch (id) {
      case "negocio":
        return {
          store_name: form.store_name.trim(),
          vertical: form.vertical,
          category: form.category.trim(),
          description: form.description.trim(),
        };
      case "ubicacion":
        return {
          address: form.address.trim(),
          lat: form.lat,
          lng: form.lng,
          hours: form.hours,
        };
      case "contacto":
        return {
          whatsapp: form.whatsapp.trim(),
          phone: form.phone.trim(),
          instagram: form.instagram.trim(),
          facebook: form.facebook.trim(),
        };
      case "fotos":
        return { image_url: form.image_url || null, logo_url: form.logo_url || null };
      case "operacion":
        return kind === "venta"
          ? {
              payment_methods: form.payment_methods.join(", "),
              delivery_options: form.delivery_options,
            }
          : {
              accepting_quotes: form.accepting_quotes,
              bookings_enabled: form.bookings_enabled,
              urgent_enabled: form.urgent_enabled,
              urgent_surcharge_pct: form.urgent_enabled ? Math.max(0, Math.min(99, Number(form.urgent_surcharge_pct) || 0)) : 0,
            };
      // Servicios (oficios): "qué ofrecés" y la zona se cargan en el paso
      // Catálogo, que es donde están los campos.
      case "catalogo":
        return kind === "servicio"
          ? { services_list: form.services_list.trim(), service_area: form.service_area.trim() }
          : {};
      default:
        return {};
    }
  }

  /** Validación por paso: solo los obligatorios frenan el avance. */
  function validate(id: WizardStepId): string {
    if (id === "negocio") {
      if (!form.store_name.trim()) return "Ponele el nombre de tu comercio.";
      if (!form.category.trim()) return "Contanos a qué te dedicás (el rubro).";
    }
    if (id === "contacto" && !form.whatsapp.trim()) {
      return "Sin WhatsApp no te pueden escribir. Podés cargarlo ahora o después en Contacto.";
    }
    return "";
  }

  async function saveStep(id: WizardStepId): Promise<boolean> {
    const payload = payloadFor(id);
    // Paso sin campos que guardar (listo/catalogo avanzan directo).
    if (Object.keys(payload).length === 0) return true;
    setSaving(true);
    setError("");
    try {
      const res = await saveVendor(payload);
      if (res?.error) {
        setError(res.error);
        return false;
      }
      // El comercio acaba de nacer: avisar al padre para que cargue todo.
      if (!vendor && res?.vendor) onCreated?.();
      return true;
    } catch {
      setError("No se pudo guardar. Revisá tu conexión y probá de nuevo.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function goNext() {
    const err = validate(current.id);
    if (err) {
      setError(err);
      return;
    }
    const ok = await saveStep(current.id);
    if (!ok) return;
    if (!isLast) {
      setStep(steps[idx + 1].id);
      setError("");
      return;
    }
    finish();
  }

  function goBack() {
    if (idx > 0) {
      setStep(steps[idx - 1].id);
      setError("");
    }
  }

  function finish() {
    clearDraft(draftId, "setup");
    if (vendor?.id) clearDraft(vendor.id, "setup");
    onDone();
  }

  async function requestPublish() {
    setError("");
    try {
      const res = await fetch("/api/vendor/publish-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error || "No se pudo enviar la solicitud.");
        return;
      }
      setPublishSent(true);
    } catch {
      setError("No se pudo enviar la solicitud. Probá desde la tarjeta de tu panel.");
    }
  }

  async function createFirstOffer() {
    if (!offName.trim() || !offPrice.trim()) {
      setOffMsg("Ponele nombre y precio a tu " + noun + ".");
      return;
    }
    setOffSaving(true);
    setOffMsg("");
    try {
      let imageUrl: string | null = null;
      if (offFile) imageUrl = await uploadImage(offFile, "offers");
      const r = await apiJson("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: offName.trim(),
          description: offDesc.trim(),
          price: Number(offPrice),
          category: offCategory || null,
          image_url: imageUrl,
        }),
      });
      if (!r.ok) {
        setOffMsg(r.error || "No se pudo cargar.");
        return;
      }
      setOffMsg("¡Listo! Ya aparece en tu vidriera.");
      setOffName("");
      setOffPrice("");
      setOffCategory("");
      setOffDesc("");
      setOffFile(null);
      reload?.();
    } catch {
      setOffMsg("No se pudo cargar. Probá de nuevo.");
    } finally {
      setOffSaving(false);
    }
  }

  // --- Crop de fotos (cover 3:1, logo 1:1) ---
  function pickCover(file: File | null) {
    if (!file) return;
    setCoverFile(file);
    setCropSrc(URL.createObjectURL(file));
    setCrop("cover");
  }
  function pickLogo(file: File | null) {
    if (!file) return;
    setLogoFile(file);
    setCropSrc(URL.createObjectURL(file));
    setCrop("logo");
  }
  async function confirmCrop(file: File, _preview: string) {
    setCropBusy(true);
    const url = await uploadImage(file, "vendors");
    setCropBusy(false);
    setCrop(null);
    setCropSrc(null);
    if (!url) {
      setError("No se pudo subir la foto. Probá de nuevo.");
      return;
    }
    if (crop === "cover") {
      patch({ image_url: url });
      setCoverFile(null);
    } else {
      patch({ logo_url: url });
      setLogoFile(null);
    }
  }

  // --- Render de cada paso ---
  function stepBody(id: WizardStepId) {
    switch (id) {
      case "negocio":
        return (
          <div className="space-y-4">
            <div>
              <Label>¿A qué te dedicás?</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {VERTICAL_OPTIONS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => patch({ vertical: v.value, category: "" })}
                    disabled={mode === "completar"}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-medium transition-colors disabled:opacity-60 ${
                      form.vertical === v.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <span className="text-2xl">{v.icon}</span>
                    <span className="text-center leading-tight">{v.label}</span>
                  </button>
                ))}
              </div>
              {mode === "completar" && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  El rubro no se cambia desde acá: está en Configuración → Perfil.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="w-name">Nombre de tu comercio</Label>
              <Input
                id="w-name"
                value={form.store_name}
                onChange={(e) => patch({ store_name: e.target.value })}
                placeholder="Ej: Pizzería Don Nicolás"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="w-cat">Rubro</Label>
              <Input
                id="w-cat"
                value={form.category}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder="Ej: pizzería, almacén, peluquería…"
                list="w-cat-list"
              />
              <datalist id="w-cat-list">
                {(CATEGORY_SUGGESTIONS[form.vertical] || CATEGORY_SUGGESTIONS.otro).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(CATEGORY_SUGGESTIONS[form.vertical] || []).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => patch({ category: c })}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="w-desc">Descripción (2 líneas)</Label>
              <Textarea
                id="w-desc"
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Ej: Pizzas a la piedra y empanadas para llevar. Todos los días al mediodía."
                rows={3}
              />
            </div>
          </div>
        );

      case "ubicacion":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="w-addr">Dirección</Label>
              <Input
                id="w-addr"
                value={form.address}
                onChange={(e) => patch({ address: e.target.value })}
                placeholder="Ej: Av. 13 Nº 1234, La Plata"
              />
            </div>
            <LocationPicker
              lat={form.lat}
              lng={form.lng}
              onChange={(lat, lng) => patch({ lat, lng })}
              neighborhood={vendor?.neighborhood}
            />
            <div>
              <Label>Horarios de atención</Label>
              <HoursEditor value={form.hours} onChange={(hours) => patch({ hours })} />
            </div>
          </div>
        );

      case "contacto":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="w-wa">WhatsApp de tu comercio</Label>
              <Input
                id="w-wa"
                value={form.whatsapp}
                onChange={(e) => patch({ whatsapp: e.target.value })}
                placeholder="221 555 0000"
                inputMode="tel"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Es el canal principal: los pedidos y consultas llegan por acá.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="w-phone">Teléfono (opcional)</Label>
                <Input id="w-phone" value={form.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="221 555 0000" />
              </div>
              <div>
                <Label htmlFor="w-ig">Instagram (opcional)</Label>
                <Input id="w-ig" value={form.instagram} onChange={(e) => patch({ instagram: e.target.value })} placeholder="@tulocal" />
              </div>
            </div>
            <div>
              <Label htmlFor="w-fb">Facebook (opcional)</Label>
              <Input id="w-fb" value={form.facebook} onChange={(e) => patch({ facebook: e.target.value })} placeholder="https://facebook.com/tulocal" />
            </div>
          </div>
        );

      case "fotos":
        return (
          <div className="space-y-5">
            <div>
              <Label>Foto de portada</Label>
              <Input type="file" accept="image/*" onChange={(e) => pickCover(e.target.files?.[0] || null)} />
              <p className="mt-1 text-xs text-muted-foreground">Se recorta a una franja ancha (3:1), como la tapa de tu vidriera.</p>
              {(form.image_url || coverFile) && (
                <img
                  src={form.image_url || (coverFile ? URL.createObjectURL(coverFile) : "")}
                  alt="Portada"
                  className="mt-2 h-24 w-full rounded-lg border border-border object-cover"
                />
              )}
            </div>
            <div>
              <Label>Logo</Label>
              <Input type="file" accept="image/*" onChange={(e) => pickLogo(e.target.files?.[0] || null)} />
              <p className="mt-1 text-xs text-muted-foreground">Cuadrado, se recorta en círculo. También sale en los tickets.</p>
              {(form.logo_url || logoFile) && (
                <img
                  src={form.logo_url || (logoFile ? URL.createObjectURL(logoFile) : "")}
                  alt="Logo"
                  className="mt-2 h-16 w-16 rounded-full border border-border object-cover"
                />
              )}
            </div>
            {cropBusy && <p className="text-xs text-muted-foreground">Subiendo la foto…</p>}
            {/* El modal de crop se monta una sola vez, al pie del wizard. */}
          </div>
        );

      case "operacion":
        if (kind === "venta") {
          return (
            <div className="space-y-5">
              <div>
                <Label className="mb-2 block">¿Qué medios de pago aceptás?</Label>
                <ChipToggle options={PAYMENT_OPTIONS} value={form.payment_methods} onChange={(v) => patch({ payment_methods: v })} />
              </div>
              <div>
                <Label className="mb-2 block">Entrega</Label>
                <RadioCards options={DELIVERY_OPTIONS} value={form.delivery_options} onChange={(v) => patch({ delivery_options: v })} />
              </div>
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  Después podés cargar cuentas para transferencias, tarifas y zonas de reparto, conectar Mercado Pago
                  y armar el descuento en efectivo en{" "}
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onGoSection?.("pagos")}>
                    Configuración → Pagos y entrega
                  </button>
                  .
                </p>
              </div>
            </div>
          );
        }
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Armá cómo recibís el trabajo de tus clientes. Esto después se ajusta en Configuración.
            </p>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Recibo consultas y presupuestos</span>
                <span className="block text-xs text-muted-foreground">Te escriben desde tu micrositio con el detalle de lo que necesitan.</span>
              </span>
              <Switch
                checked={form.accepting_quotes}
                onCheckedChange={(v) => patch({ accepting_quotes: v })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Turnera online</span>
                <span className="block text-xs text-muted-foreground">Eligen día y horario desde el celu, sin llamarte.</span>
              </span>
              <Switch checked={form.bookings_enabled} onCheckedChange={(v) => patch({ bookings_enabled: v })} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Urgencias 24 hs</span>
                <span className="block text-xs text-muted-foreground">Avisá que atendés emergencias y con qué recargo.</span>
              </span>
              <Switch checked={form.urgent_enabled} onCheckedChange={(v) => patch({ urgent_enabled: v })} />
            </label>
            {form.urgent_enabled && (
              <div className="max-w-[180px]">
                <Label htmlFor="w-urg">Recargo por urgencia (%)</Label>
                <Input
                  id="w-urg"
                  value={form.urgent_surcharge_pct}
                  onChange={(e) => patch({ urgent_surcharge_pct: e.target.value })}
                  inputMode="numeric"
                />
              </div>
            )}
            {kind === "hibrido" && (
              <div className="rounded-xl border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  Servicios, profesionales, sedes y packs se cargan en{" "}
                  <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onGoTab?.("servicios")}>
                    la pestaña Servicios
                  </button>
                  .
                </p>
              </div>
            )}
          </div>
        );

      case "catalogo":
        if (kind === "venta") {
          return (
            <div className="space-y-4">
              <div className="rounded-xl border border-border p-3">
                <p className="mb-3 text-sm font-medium">Cargá tu primer {noun}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="o-name">Nombre</Label>
                    <Input id="o-name" value={offName} onChange={(e) => setOffName(e.target.value)} placeholder={kind === "venta" && form.vertical === "gastronomia" ? "Ej: Muzzarella" : "Ej: Remera lisa"} />
                  </div>
                  <div>
                    <Label htmlFor="o-price">Precio</Label>
                    <Input id="o-price" value={offPrice} onChange={(e) => setOffPrice(e.target.value)} inputMode="decimal" placeholder="3500" />
                  </div>
                  <div>
                    <Label htmlFor="o-cat">Categoría</Label>
                    <select
                      id="o-cat"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={offCategory}
                      onChange={(e) => setOffCategory(e.target.value)}
                    >
                      <option value="">Sin categoría</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="o-file">Foto (opcional)</Label>
                    <Input id="o-file" type="file" accept="image/*" onChange={(e) => setOffFile(e.target.files?.[0] || null)} />
                  </div>
                </div>
                <div className="mt-3">
                  <Label htmlFor="o-desc">Descripción (opcional)</Label>
                  <Textarea id="o-desc" rows={2} value={offDesc} onChange={(e) => setOffDesc(e.target.value)} />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button type="button" size="sm" onClick={createFirstOffer} disabled={offSaving}>
                    {offSaving ? "Cargando…" : "Cargar"}
                  </Button>
                  {offMsg && <span className="text-xs text-muted-foreground">{offMsg}</span>}
                </div>
              </div>
              {offers.length > 0 && (
                <div className="rounded-xl border border-border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Ya cargaste {offers.length} {offers.length === 1 ? noun : noun + "s"}
                  </p>
                  <ul className="space-y-1 text-sm">
                    {offers.slice(0, 5).map((o) => (
                      <li key={o.id} className="flex justify-between gap-2">
                        <span className="truncate">{o.name}</span>
                        <span className="tabular-nums text-muted-foreground">${Number(o.price).toLocaleString("es-AR")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        }
        // Híbridos y servicios: los servicios viven en su propia pestaña/sección.
        return (
          <div className="space-y-4">
            {kind === "servicio" && (
              <>
                <div>
                  <Label htmlFor="w-svc">¿Qué servicios ofrecés?</Label>
                  <Textarea
                    id="w-svc"
                    rows={3}
                    value={form.services_list}
                    onChange={(e) => patch({ services_list: e.target.value })}
                    placeholder="Ej: destapaciones, arreglo de pérdidas, instalación de termotanques"
                  />
                </div>
                <div>
                  <Label htmlFor="w-area">Zona que cubrís</Label>
                  <Input id="w-area" value={form.service_area} onChange={(e) => patch({ service_area: e.target.value })} placeholder="Ej: La Plata y alrededores" />
                </div>
              </>
            )}
            <div className="rounded-xl border border-border p-4 text-center">
              <p className="text-3xl">🧰</p>
              <p className="mt-2 text-sm font-medium">Cargá tus servicios uno por uno</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nombre, duración, precio y seña. Con eso tus clientes ya pueden reservar desde el celu.
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                onClick={() => (kind === "hibrido" ? onGoTab?.("servicios") : onGoSection?.("servicios"))}
              >
                Ir a cargar servicios
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Podés saltear este paso y cargarlos cuando quieras: tu vidriera igual ya funciona.
            </p>
          </div>
        );

      case "listo":
      default:
        return (
          <div className="space-y-5">
            <LivePreview
              storeName={form.store_name}
              storePreview={form.image_url || null}
              vendor={vendor ?? (form as unknown as Vendor)}
              logoPreview={form.logo_url || null}
              description={form.description}
              hours={form.hours}
              address={form.address}
              paymentMethods={form.payment_methods}
              whatsapp={form.whatsapp}
              isService={kind !== "venta"}
            />
            {pendingCount > 0 ? (
              <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 dark:bg-amber-950/20">
                <p className="text-sm font-semibold">Te faltan {pendingCount} cosas para estar al 100%</p>
                <ul className="mt-2 space-y-1">
                  {checks
                    .filter((c) => !c.optional && !c.done)
                    .map((c) => (
                      <li key={c.id} className="text-xs text-muted-foreground">• {c.label}</li>
                    ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Los ves con el detalle en la tarjeta &ldquo;Cómo va tu comercio&rdquo; del inicio.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-green-300/60 bg-green-50/60 p-3 dark:bg-green-950/20">
                <p className="text-sm font-semibold">🎉 ¡Tu comercio está completo!</p>
              </div>
            )}
            <div className="rounded-xl border border-border p-4">
              <p className="text-sm font-medium">Publicar tu comercio</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Hoy tu micrositio funciona con el link de vista previa. Al publicarlo lo revisamos y aparecés en el
                portal para todos los vecinos.
              </p>
              {publishSent ? (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700 dark:bg-green-950/40 dark:text-green-300">
                  ✅ Solicitud enviada: te avisamos cuando esté aprobado.
                </p>
              ) : (
                <Button type="button" size="sm" className="mt-3" onClick={requestPublish}>
                  Solicitar publicación
                </Button>
              )}
            </div>
          </div>
        );
    }
  }

  const body = (
    <div className="space-y-4">
      {/* Barra de progreso */}
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Paso {idx + 1} de {steps.length}
          </span>
          <span>{current.title}</span>
        </div>
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              title={s.title}
              onClick={() => {
                // Solo se permite volver a pasos anteriores (o el actual).
                if (i <= idx) {
                  setStep(s.id);
                  setError("");
                }
              }}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < idx ? "bg-green-500" : i === idx ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-2xl leading-none">{current.emoji}</span>
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{current.title}</p>
            <p className="text-xs text-muted-foreground">{current.desc}</p>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {stepBody(current.id)}
    </div>
  );

  const footer = (
    <>
      <Button type="button" variant="outline" onClick={goBack} disabled={idx === 0 || saving} className="flex-1">
        Atrás
      </Button>
      {current.optional && !isLast && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setStep(steps[idx + 1].id);
            setError("");
          }}
          disabled={saving}
        >
          Saltar
        </Button>
      )}
      <Button type="button" onClick={goNext} disabled={saving} className="flex-1">
        {saving ? "Guardando…" : isLast ? (mode === "alta" ? "Ir a mi panel" : "Terminar") : "Siguiente"}
      </Button>
    </>
  );

  // Modo "alta": pantalla completa (sin panel detrás) hasta terminar o salir.
  if (mode === "alta") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-24">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Armemos tu comercio</p>
          <h1 className="font-display text-2xl font-semibold">Paso a paso, en 2 minutos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Completá estos pasos y tu vidriera queda lista para difundir. Podés saltear lo que quieras y
            volver cuando quieras: todo se guarda.
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            {body}
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">{footer}</div>
          </div>
          <aside className="hidden lg:block">
            <div className="lg:sticky lg:top-24 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Así se ve tu vidriera</p>
              <LivePreview
                storeName={form.store_name}
                storePreview={form.image_url || null}
                vendor={vendor ?? (form as unknown as Vendor)}
                logoPreview={form.logo_url || null}
                description={form.description}
                hours={form.hours}
                address={form.address}
                paymentMethods={form.payment_methods}
                whatsapp={form.whatsapp}
                isService={kind !== "venta"}
              />
              <Button type="button" variant="ghost" size="sm" onClick={finish} disabled={saving}>
                Salir y seguir después
              </Button>
            </div>
          </aside>
        </div>
        {crop && cropSrc && (
          <ImageCropModal
            imageSrc={cropSrc}
            aspect={crop === "cover" ? 3 / 1 : 1}
            title={crop === "cover" ? "Ajustá la foto de portada" : "Ajustá el logo"}
            onCropComplete={confirmCrop}
            onCancel={() => {
              setCrop(null);
              setCropSrc(null);
              setCoverFile(null);
              setLogoFile(null);
            }}
          />
        )}
      </div>
    );
  }

  // Modo "completar": modal sobre el panel (tienda Nº2 / retomar el armado).
  return (
    <Modal
      open
      onClose={finish}
      title="Armemos tu comercio"
      size="xl"
      footer={footer}
    >
      {body}
    </Modal>
  );
}
