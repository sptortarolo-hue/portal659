"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { servicePriceLabel } from "@/lib/service-price";

type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_min: number | null;
  buffer_min: number | null;
  deposit_amount: number | null;
  price: number | null;
  price_from?: number | null;
  price_to?: number | null;
  commission_pct: number | null;
  require_deposit?: boolean | null;
  deposit_hours?: number | null;
  image_url?: string | null;
  featured_today?: boolean | null;
  location_id?: string | null;
  active: boolean | null;
};

const money = (n: number | null) =>
  n == null ? "—" : `$${Number(n).toLocaleString("es-AR")}`;

/** Estado del editor único de servicios (modal compartido por alta/edición). */
type ServiceFormState = {
  name: string;
  description: string;
  category: string;
  locationId: string;
  duration: string;
  buffer: string;
  deposit: string;
  priceMode: "fijo" | "desde";
  price: string;
  priceFrom: string;
  priceTo: string;
  commission: string;
  requireDeposit: boolean;
  depositHours: string;
  imageUrl: string;
  active: boolean;
  featured: boolean;
};

function blankForm(): ServiceFormState {
  return {
    name: "",
    description: "",
    category: "",
    locationId: "",
    duration: "60",
    buffer: "0",
    deposit: "",
    priceMode: "fijo",
    price: "",
    priceFrom: "",
    priceTo: "",
    commission: "",
    requireDeposit: false,
    depositHours: "24",
    imageUrl: "",
    active: true,
    featured: false,
  };
}

function formFromService(s: Service): ServiceFormState {
  return {
    name: String(s.name ?? ""),
    description: typeof s.description === "string" ? s.description : "",
    category: typeof (s as any).category === "string" ? (s as any).category : "",
    locationId: typeof s.location_id === "string" ? s.location_id : "",
    duration: s.duration_min != null ? String(s.duration_min) : "60",
    buffer: s.buffer_min != null ? String(s.buffer_min) : "0",
    deposit: s.deposit_amount != null ? String(s.deposit_amount) : "",
    priceMode: s.price != null || (s.price_from == null && s.price_to == null) ? "fijo" : "desde",
    price: s.price != null ? String(s.price) : "",
    priceFrom: s.price_from != null ? String(s.price_from) : "",
    priceTo: s.price_to != null ? String(s.price_to) : "",
    commission: s.commission_pct != null ? String(s.commission_pct) : "",
    requireDeposit: s.require_deposit === true,
    depositHours: s.deposit_hours != null ? String(s.deposit_hours) : "24",
    imageUrl: typeof s.image_url === "string" ? s.image_url : "",
    active: s.active !== false,
    featured: s.featured_today === true,
  };
}

/** ABM de servicios del centro de estética (duración + buffer + seña).
 *
 * `canChargeDeposits`: la seña online sólo se puede cobrar con Mercado Pago o
 * Stripe conectado; sin ninguno de los dos, los campos de seña se muestran
 * deshabilitados con el aviso (configurarla no tendría efecto). */
export function EsteticaServicesManager({ onChanged, canChargeDeposits = true, cancelRefundsDeposit = true, cancelHours = 24 }: { onChanged?: () => void; canChargeDeposits?: boolean; cancelRefundsDeposit?: boolean; cancelHours?: number }) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Editor único (modal) compartido por alta y edición: así todos los campos
  // están siempre en los dos flujos y no se vuelven a desincronizar.
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceFormState>(blankForm);
  const patch = (p: Partial<ServiceFormState>) => setForm((f) => ({ ...f, ...p }));
  // Política de seña al cancelar dentro del plazo (dato del comercio, se
  // guarda al instante vía PATCH me). Estado local para no depender del
  // refresh del padre: el selector responde aunque el vendor tarde.
  const [refunds, setRefunds] = useState(cancelRefundsDeposit);
  const [savingPolicy, setSavingPolicy] = useState(false);
  useEffect(() => { setRefunds(cancelRefundsDeposit); }, [cancelRefundsDeposit]);

  async function saveRefundPolicy(next: boolean) {
    setRefunds(next);
    setSavingPolicy(true);
    try {
      const res = await fetch("/api/vendor/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_refunds_deposit: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error || res.status >= 400) {
        setRefunds(!next);
        setMsg(typeof data.error === "string" ? data.error : "No se pudo guardar la política");
        return;
      }
      onChanged?.();
    } catch {
      setRefunds(!next);
      setMsg("Error de conexión");
    } finally {
      setSavingPolicy(false);
    }
  }

  async function uploadServicePhoto(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "services");
    try {
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      return typeof data.url === "string" ? data.url : null;
    } catch {
      return null;
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/services");
      const data = await res.json();
      if (data.migrationMissing) setMissing(true);
      setServices(data.services || []);
      setCategories([...new Set((data.services || []).map((s: any) => String(s.category || "").trim()).filter(Boolean))] as string[]);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
    try {
      const res = await fetch("/api/vendor/estetica-locations");
      const data = await res.json();
      setLocations((data.locations || []).filter((l: any) => l.active !== false).map((l: any) => ({ id: String(l.id), name: String(l.name ?? "") })));
    } catch { /* sin sedes */ }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm(blankForm());
    setFormMode("create");
    setEditingId(null);
    setMsg("");
    setFormOpen(true);
  }

  function openEdit(s: Service) {
    setForm(formFromService(s));
    setFormMode("edit");
    setEditingId(s.id);
    setMsg("");
    setFormOpen(true);
  }

  // Validación compartida con los mismos mensajes que la API.
  function validate(): string | null {
    if (!form.name.trim()) return "Poné un nombre al servicio";
    const deposit = form.deposit.trim() === "" ? null : Number(form.deposit);
    if (deposit != null && (!Number.isFinite(deposit) || deposit < 0)) {
      return "La seña debe ser un monto válido";
    }
    if (form.priceMode === "desde") {
      const from = form.priceFrom.trim() === "" ? null : Number(form.priceFrom);
      if (from != null && (!Number.isFinite(from) || from < 0)) {
        return "El precio 'desde' debe ser un monto válido";
      }
      const to = form.priceTo.trim() === "" ? null : Number(form.priceTo);
      if (to != null && (!Number.isFinite(to) || (from != null && to <= from))) {
        return from == null ? "Para la banda cargá primero el 'desde'" : "El precio 'hasta' debe ser mayor que el 'desde'";
      }
    }
    const commission = form.commission.trim() === "" ? null : Number(form.commission);
    if (commission != null && (!Number.isFinite(commission) || commission < 0 || commission > 100)) {
      return "La comisión debe estar entre 0 y 100";
    }
    if (canChargeDeposits && form.requireDeposit && !(deposit != null && deposit > 0)) {
      return "Para exigir seña poné primero el monto";
    }
    const hours = form.depositHours.trim() === "" ? 24 : Number(form.depositHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
      return "Las horas para pagar deben estar entre 1 y 168";
    }
    return null;
  }

  async function saveForm() {
    const err = validate();
    if (err) {
      setMsg(err);
      return;
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      location_id: form.locationId || null,
      duration_min: Number(form.duration) || 60,
      buffer_min: Number(form.buffer) || 0,
      // Sin MP/Stripe conectado no se puede cobrar la seña online: no se guarda.
      deposit_amount: canChargeDeposits && form.deposit.trim() !== "" ? Number(form.deposit) : null,
      price: form.priceMode === "fijo" ? (form.price.trim() === "" ? null : Number(form.price)) : null,
      price_from: form.priceMode === "desde" ? (form.priceFrom.trim() === "" ? null : Number(form.priceFrom)) : null,
      price_to: form.priceMode === "desde" && form.priceTo.trim() !== "" ? Number(form.priceTo) : null,
      commission_pct: form.commission.trim() === "" ? null : Number(form.commission),
      require_deposit: canChargeDeposits && form.requireDeposit,
      deposit_hours: form.depositHours.trim() === "" ? 24 : Number(form.depositHours),
      image_url: form.imageUrl || null,
      active: form.active,
      featured_today: form.featured,
    };
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(
        formMode === "edit" && editingId ? `/api/vendor/services/${editingId}` : "/api/vendor/services",
        {
          method: formMode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setFormOpen(false);
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: Service) {
    try {
      await fetch(`/api/vendor/services/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !(s.active !== false) }),
      });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  // "Oferta del día": un solo servicio destacado por comercio (el server
  // apaga los demás al marcar uno, igual que con los productos).
  async function toggleFeatured(s: Service) {
    const next = !(s.featured_today === true);
    try {
      const res = await fetch(`/api/vendor/services/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured_today: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setMsg(data.error);
        return;
      }
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar este servicio? Los turnos viejos se conservan.")) return;
    try {
      await fetch(`/api/vendor/services/${id}`, { method: "DELETE" });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  if (missing) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Falta aplicar la migración <code>migrate-estetica.sql</code> en la base para gestionar servicios.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">✨ Servicios</p>
        <p className="text-xs text-muted-foreground">
          Cada servicio tiene su duración y su seña. El turno online se bloquea si se pisa con otro del mismo profesional. Con <span title="Oferta del día">★</span> marcás la oferta del día (una sola): flota primero en tu carta, con badge &quot;Hoy&quot;, y aparece en el home.
        </p>
      </div>
      <div className="rounded-md border border-border p-2 space-y-1">
        <Label className="text-xs">Seña si la clienta cancela dentro del plazo ({cancelHours} h)</Label>
        <select
          value={refunds ? "devolver" : "retener"}
          onChange={(e) => saveRefundPolicy(e.target.value === "devolver")}
          disabled={savingPolicy}
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="devolver">Devolver la seña</option>
          <option value="retener">Retener la seña (no se devuelve)</option>
        </select>
        <p className="text-[11px] text-muted-foreground">
          Se muestra en el micrositio antes de reservar y al cancelar desde el link del turno. Con retención, la seña pagada queda a tu favor (igual que la política de ausente).
        </p>
      </div>
      <Button size="sm" className="w-full" onClick={openCreate}>
        + Agregar servicio
      </Button>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : services.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Todavía no cargaste servicios. Ejemplos: Semipermanente (60 min), Lifting de pestañas (90 min), Perfilado de cejas (30 min).
        </p>
      ) : (
        <div className="space-y-1.5">
          {services.map((s) => (
            <div key={s.id} className="rounded-lg bg-muted px-2.5 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0">
                  {s.image_url && (
                    <img src={s.image_url} alt="" className="h-10 w-10 rounded-lg object-cover border border-border mb-1" />
                  )}
                  <span className={`block font-medium truncate ${s.active === false ? "line-through opacity-60" : ""}`}>{s.name}</span>
                  {(s as any).category && (
                    <span className="inline-block rounded-full bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 mt-0.5">{String((s as any).category)}</span>
                  )}
                  {s.featured_today === true && (
                    <span className="inline-block rounded-full bg-sun text-ink text-[10px] font-bold px-2 py-0.5 mt-0.5 ml-1">Hoy</span>
                  )}
                  <span className="block text-muted-foreground">
                    {s.duration_min ?? 60} min{s.buffer_min ? ` +${s.buffer_min} buffer` : ""} · seña {s.deposit_amount ? money(Number(s.deposit_amount)) : "no"}
                    {servicePriceLabel(s) ? ` · ${servicePriceLabel(s)}` : ""}{s.commission_pct != null ? ` · ${Number(s.commission_pct)}%` : ""}
                    {s.require_deposit ? ` · ⏰ seña obligatoria (${s.deposit_hours ?? 24}h)` : ""}
                  </span>
                </span>
                <button type="button" onClick={() => toggleFeatured(s)} className={`flex-shrink-0 ${s.featured_today === true ? "text-sun" : "text-muted-foreground hover:text-foreground"}`} title={s.featured_today === true ? "Quitar de Hoy" : "Oferta del día"}>
                  {s.featured_today === true ? "★" : "☆"}
                </button>
                <button type="button" onClick={() => openEdit(s)} className="text-muted-foreground hover:text-foreground flex-shrink-0" title="Editar servicio">
                  ✏️
                </button>
                <button type="button" onClick={() => toggle(s)} className="text-muted-foreground hover:text-foreground flex-shrink-0" title={s.active === false ? "Activar" : "Pausar"}>
                  {s.active === false ? "▶️" : "⏸️"}
                </button>
                <button type="button" onClick={() => remove(s.id)} className="text-red-600 hover:text-red-700 flex-shrink-0" title="Borrar">
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={formMode === "create" ? "Nuevo servicio" : "Editar servicio"}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={saveForm} disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 px-6 py-4">
          {msg && <p className="text-xs text-red-600">{msg}</p>}
          {/* Datos */}
          <div>
            <Label className="text-xs">Nombre del servicio</Label>
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Ej: Kapping gel" className="mt-1 h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Descripción (opcional, se ve en la carta)</Label>
            <Textarea value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Ej: Baño de gel que endurece y dura 3 semanas" className="mt-1 text-sm" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Rubro (opcional, agrupa la carta)</Label>
              <Input value={form.category} onChange={(e) => patch({ category: e.target.value })} placeholder="Ej: Uñas" list="estetica-service-cats" className="mt-1 h-9 text-sm" />
            </div>
            {locations.length > 0 && (
              <div>
                <Label className="text-xs">Sede</Label>
                <select
                  value={form.locationId}
                  onChange={(e) => patch({ locationId: e.target.value })}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">Todas las sedes</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <datalist id="estetica-service-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {/* Agenda */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Duración (min)</Label>
              <Input value={form.duration} onChange={(e) => patch({ duration: e.target.value })} inputMode="numeric" placeholder="60" className="mt-1 h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Buffer (min)</Label>
              <Input value={form.buffer} onChange={(e) => patch({ buffer: e.target.value })} inputMode="numeric" placeholder="0" className="mt-1 h-9 text-sm" />
            </div>
          </div>
          {/* Precio + seña + comisión */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <Label className="text-xs">Precio</Label>
            <div className="flex gap-1">
              <button type="button" onClick={() => patch({ priceMode: "fijo" })} className={`px-2 py-1 rounded-md border text-[11px] font-medium ${form.priceMode === "fijo" ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground"}`}>Fijo</button>
              <button type="button" onClick={() => patch({ priceMode: "desde" })} className={`px-2 py-1 rounded-md border text-[11px] font-medium ${form.priceMode === "desde" ? "border-primary text-primary bg-primary/5" : "border-border text-muted-foreground"}`}>Desde</button>
            </div>
            {form.priceMode === "fijo" ? (
              <Input value={form.price} onChange={(e) => patch({ price: e.target.value })} inputMode="decimal" placeholder="Vacío = sin precio" className="h-9 text-sm" />
            ) : (
              <div className="flex gap-1">
                <Input value={form.priceFrom} onChange={(e) => patch({ priceFrom: e.target.value })} inputMode="decimal" placeholder="Desde ($)" className="h-9 text-sm min-w-0" />
                <Input value={form.priceTo} onChange={(e) => patch({ priceTo: e.target.value })} inputMode="decimal" placeholder="Hasta (opcional)" className="h-9 text-sm min-w-0" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Seña por servicio ($, opcional)</Label>
                <Input value={form.deposit} onChange={(e) => patch({ deposit: e.target.value })} inputMode="decimal" placeholder={canChargeDeposits ? "Vacío = sin seña" : "Conectá MP para cobrar señas"} className="mt-1 h-9 text-sm" disabled={!canChargeDeposits} />
                {!canChargeDeposits && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    La seña online se cobra con Mercado Pago o Stripe: conectá tu cuenta en <strong>Pagos</strong> para poder configurarla.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Comisión % (vacío = la del profesional)</Label>
                <Input value={form.commission} onChange={(e) => patch({ commission: e.target.value })} inputMode="decimal" placeholder="Ej: 40" className="mt-1 h-9 text-sm" />
              </div>
            </div>
          </div>
          {/* Reserva */}
          <div className="rounded-md border border-border p-2 space-y-2">
            <label className={`flex items-center gap-2 text-xs ${canChargeDeposits ? "cursor-pointer" : "opacity-60"}`}>
              <input type="checkbox" checked={form.requireDeposit} onChange={(e) => patch({ requireDeposit: e.target.checked })} className="h-4 w-4" disabled={!canChargeDeposits} />
              ⏰ Exigir seña para reservar (si no paga, no reserva)
            </label>
            {!canChargeDeposits && (
              <p className="text-[11px] text-muted-foreground">
                Disponible al conectar Mercado Pago o Stripe en <strong>Pagos</strong>.
              </p>
            )}
            {form.requireDeposit && (
              <div>
                <Label className="text-xs">Horas para pagar (vacío = 24)</Label>
                <Input value={form.depositHours} onChange={(e) => patch({ depositHours: e.target.value })} inputMode="numeric" placeholder="24" className="mt-1 h-9 text-sm" />
              </div>
            )}
          </div>
          {/* Foto */}
          <div>
            <Label className="text-xs">Foto (opcional, se ve en la carta)</Label>
            <div className="flex items-center gap-2 mt-1">
              {form.imageUrl ? (
                <>
                  <img src={form.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-border" />
                  <button type="button" onClick={() => patch({ imageUrl: "" })} className="text-xs text-red-600 hover:underline">Quitar</button>
                </>
              ) : (
                <label className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted">
                  {uploadingPhoto ? "Subiendo..." : "📷 Subir foto"}
                  <input
                    type="file" accept="image/*" className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setUploadingPhoto(true);
                      const url = await uploadServicePhoto(f);
                      setUploadingPhoto(false);
                      if (url) patch({ imageUrl: url });
                      else setMsg("No se pudo subir la foto");
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
          {/* Estado */}
          <div className="rounded-md border border-border p-2 space-y-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={(e) => patch({ active: e.target.checked })} className="h-4 w-4" />
              Activo (si lo pausás, sale de la carta y no se puede reservar)
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={form.featured} onChange={(e) => patch({ featured: e.target.checked })} className="h-4 w-4" />
              ⭐ Oferta del día (una sola por comercio; flota en la carta y aparece en el home)
            </label>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

type Staff = {
  id: string;
  name: string;
  phone: string | null;
  commission_pct: number | null;
  active: boolean | null;
};

/** ABM de profesionales del centro (agenda por profesional, v1 sin comisiones). */
export function EsteticaStaffManager({ onChanged }: { onChanged?: () => void }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState("");
  const [commission, setCommission] = useState("");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploadingStaffPhoto, setUploadingStaffPhoto] = useState(false);
  const [staffLocationId, setStaffLocationId] = useState("");
  const [staffLocations, setStaffLocations] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCommission, setEditCommission] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editPhoto, setEditPhoto] = useState("");

  async function uploadStaffPhoto(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "services");
    try {
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      return typeof data.url === "string" ? data.url : null;
    } catch {
      return null;
    }
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/estetica-staff");
      const data = await res.json();
      if (data.migrationMissing) setMissing(true);
      setStaff(data.staff || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
    try {
      const res = await fetch("/api/vendor/estetica-locations");
      const data = await res.json();
      setStaffLocations((data.locations || []).filter((l: any) => l.active !== false).map((l: any) => ({ id: String(l.id), name: String(l.name ?? "") })));
    } catch { /* sin sedes */ }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) {
      setMsg("Poné un nombre");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/estetica-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), commission_pct: commission === "" ? null : Number(commission), location_id: staffLocationId || undefined, photo_url: photoUrl || undefined, bio: bio.trim() || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setName("");
      setCommission("");
      setBio("");
      setPhotoUrl("");
      setStaffLocationId("");
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  async function saveCommission(id: string) {
    try {
      const res = await fetch(`/api/vendor/estetica-staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commission_pct: editCommission === "" ? null : Number(editCommission),
          bio: editBio.trim() || null,
          photo_url: editPhoto || null,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setEditingId(null);
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    }
  }

  async function toggle(s: Staff) {
    try {
      await fetch(`/api/vendor/estetica-staff/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !(s.active !== false) }),
      });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar este profesional? Sus turnos viejos se conservan.")) return;
    try {
      await fetch(`/api/vendor/estetica-staff/${id}`, { method: "DELETE" });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  if (missing) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Falta aplicar la migración <code>migrate-estetica.sql</code> en la base para gestionar profesionales.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">💇 Profesionales</p>
        <p className="text-xs text-muted-foreground">
          La clienta puede elegir con quién reservar. El control de solape es por profesional.
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : staff.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Si trabajás sola no hace falta cargar a nadie: los turnos entran igual.
        </p>
      ) : (
        <div className="space-y-1.5">
          {staff.map((s) => (
            <div key={s.id} className="rounded-lg bg-muted px-2.5 py-2 text-xs">
              <div className="flex items-center gap-2">
                {(s as any).photo_url && (
                  <img src={String((s as any).photo_url)} alt="" className="h-9 w-9 rounded-full object-cover border border-border flex-shrink-0" />
                )}
                <span className={`flex-1 min-w-0 font-medium truncate ${s.active === false ? "line-through opacity-60" : ""}`}>
                  {s.name}{s.commission_pct != null ? ` · ${Number(s.commission_pct)}%` : ""}
                </span>
                <button type="button" onClick={() => { setEditingId(editingId === s.id ? null : s.id); setEditCommission(s.commission_pct != null ? String(s.commission_pct) : ""); setEditBio(typeof (s as any).bio === "string" ? (s as any).bio : ""); setEditPhoto(typeof (s as any).photo_url === "string" ? (s as any).photo_url : ""); }} className="text-muted-foreground hover:text-foreground flex-shrink-0" title="Editar">
                  ✏️
                </button>
                <button type="button" onClick={() => toggle(s)} className="text-muted-foreground hover:text-foreground flex-shrink-0" title={s.active === false ? "Activar" : "Pausar"}>
                  {s.active === false ? "▶️" : "⏸️"}
                </button>
                <button type="button" onClick={() => remove(s.id)} className="text-red-600 hover:text-red-700 flex-shrink-0" title="Borrar">
                  🗑️
                </button>
              </div>
              {editingId === s.id && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Input value={editCommission} onChange={(e) => setEditCommission(e.target.value)} inputMode="decimal" placeholder="Comisión % (vacío = sin comisión)" className="h-9 text-sm bg-background" />
                    <Button size="sm" onClick={() => saveCommission(s.id)}>Guardar</Button>
                  </div>
                  <Input value={editBio} onChange={(e) => setEditBio(e.target.value)} placeholder="Bio (ej: especialista en lifting)" className="h-9 text-sm bg-background" />
                  <div className="flex items-center gap-2">
                    {editPhoto ? (
                      <>
                        <img src={editPhoto} alt="" className="h-9 w-9 rounded-full object-cover border border-border" />
                        <button type="button" onClick={() => setEditPhoto("")} className="text-xs text-red-600 hover:underline">Quitar</button>
                      </>
                    ) : (
                      <label className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted">
                        📷 Foto
                        <input
                          type="file" accept="image/*" className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = await uploadStaffPhoto(f);
                            if (url) setEditPhoto(url);
                            else setMsg("No se pudo subir la foto");
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Camila" className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Comisión % (opcional)</Label>
          <Input value={commission} onChange={(e) => setCommission(e.target.value)} inputMode="decimal" placeholder="Ej: 40" className="mt-1 h-9 text-sm" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Bio (opcional, se ve en la carta)</Label>
          <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Ej: especialista en lifting" className="mt-1 h-9 text-sm" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Foto (opcional)</Label>
          <div className="flex items-center gap-2 mt-1">
            {photoUrl ? (
              <>
                <img src={photoUrl} alt="" className="h-9 w-9 rounded-full object-cover border border-border" />
                <button type="button" onClick={() => setPhotoUrl("")} className="text-xs text-red-600 hover:underline">Quitar</button>
              </>
            ) : (
              <label className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted">
                {uploadingStaffPhoto ? "Subiendo..." : "📷 Subir foto"}
                <input
                  type="file" accept="image/*" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setUploadingStaffPhoto(true);
                    const url = await uploadStaffPhoto(f);
                    setUploadingStaffPhoto(false);
                    if (url) setPhotoUrl(url);
                    else setMsg("No se pudo subir la foto");
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </div>
        {staffLocations.length > 0 && (
          <div className="col-span-2">
            <Label className="text-xs">Sede (opcional)</Label>
            <select
              value={staffLocationId}
              onChange={(e) => setStaffLocationId(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">Todas las sedes</option>
              {staffLocations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      <Button size="sm" className="w-full" onClick={create} disabled={saving}>
        {saving ? "Guardando..." : "＋ Agregar profesional"}
      </Button>
    </Card>
  );
}

/** Política de cancelación del centro (texto + horas límite). */
export function EsteticaCancelPolicy({
  policy,
  hours,
  onPolicy,
  onHours,
}: {
  policy: string;
  hours: string;
  onPolicy: (v: string) => void;
  onHours: (v: string) => void;
}) {
  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">📝 Política de cancelación</p>
        <p className="text-xs text-muted-foreground">
          Se muestra en el micrositio antes de reservar. Ej: "Cancelá con 24 h de anticipación".
        </p>
      </div>
      <div>
        <Label className="text-xs">Texto de la política (opcional)</Label>
        <Textarea
          value={policy}
          onChange={(e) => onPolicy(e.target.value)}
          placeholder="Ej: Cancelá con 24 h de anticipación..."
          rows={2}
          className="mt-1 text-sm"
        />
      </div>
      <div>
        <Label className="text-xs">Anticipación mínima (horas)</Label>
        <Input value={hours} onChange={(e) => onHours(e.target.value)} inputMode="numeric" placeholder="24" className="mt-1 h-9 text-sm" />
      </div>
    </Card>
  );
}
type Pack = {
  id: string;
  name: string;
  sessions_total: number | null;
  price: number | null;
  active: boolean | null;
};

type Credit = {
  id: string;
  remaining: number;
  customer_phone: string;
  pack_id: string;
  pack_name: string;
  sessions_total: number | null;
};

/** Packs de sesiones (v1: venta manual + contador por clienta). */
export function EsteticaPacksManager({ onChanged }: { onChanged?: () => void }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState("8");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // Venta / consulta de saldo por teléfono.
  const [phone, setPhone] = useState("");
  const [sellPackId, setSellPackId] = useState("");
  const [credits, setCredits] = useState<Credit[]>([]);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [creditsMsg, setCreditsMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/service-packs");
      const data = await res.json();
      if (data.migrationMissing) setMissing(true);
      setPacks(data.packs || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim() || !(Number(sessions) > 0)) {
      setMsg("Poné nombre y cantidad de sesiones");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/service-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sessions_total: Number(sessions),
          price: price === "" ? null : Number(price),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setName("");
      setSessions("8");
      setPrice("");
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(p: Pack) {
    try {
      await fetch(`/api/vendor/service-packs/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !(p.active !== false) }),
      });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar este pack? Se pierden los saldos pendientes.")) return;
    try {
      await fetch(`/api/vendor/service-packs/${id}`, { method: "DELETE" });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  async function lookupCredits() {
    if (!phone.trim()) {
      setCreditsMsg("Ingresá el teléfono de la clienta");
      return;
    }
    setCreditsLoading(true);
    setCreditsMsg("");
    try {
      const res = await fetch(`/api/vendor/service-packs/credits?phone=${encodeURIComponent(phone.trim())}`);
      const data = await res.json();
      if (data.migrationMissing) {
        setCreditsMsg("Falta aplicar la migración migrate-estetica.sql");
        return;
      }
      setCredits(data.credits || []);
      if ((data.credits || []).length === 0) setCreditsMsg("Sin sesiones pendientes para ese teléfono.");
    } catch {
      setCreditsMsg("Error de conexión");
    } finally {
      setCreditsLoading(false);
    }
  }

  async function sell() {
    if (!phone.trim() || !sellPackId) {
      setCreditsMsg("Elegí pack y teléfono para vender");
      return;
    }
    setCreditsLoading(true);
    setCreditsMsg("");
    try {
      const res = await fetch("/api/vendor/service-packs/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sell", pack_id: sellPackId, customer_phone: phone.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        setCreditsMsg(data.error);
        return;
      }
      setCreditsMsg("Pack vendido: sesiones sumadas ✅ (cobralo por caja o MP aparte)");
      await lookupCredits();
    } catch {
      setCreditsMsg("Error de conexión");
    } finally {
      setCreditsLoading(false);
    }
  }

  async function useOne(packId?: string) {
    if (!phone.trim()) return;
    setCreditsLoading(true);
    try {
      const res = await fetch("/api/vendor/service-packs/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "use", customer_phone: phone.trim(), pack_id: packId || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setCreditsMsg(data.error);
        return;
      }
      await lookupCredits();
    } catch {
      setCreditsMsg("Error de conexión");
    } finally {
      setCreditsLoading(false);
    }
  }

  if (missing) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Falta aplicar la migración <code>migrate-estetica.sql</code> en la base para gestionar packs.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">🎟️ Packs de sesiones</p>
        <p className="text-xs text-muted-foreground">
          Ej: Depilación definitiva x8, Facial x4. Vendés el pack y cada turno descuenta 1 sesión.
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : packs.length > 0 && (
        <div className="space-y-1.5">
          {packs.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
              <span className={`flex-1 min-w-0 font-medium truncate ${p.active === false ? "line-through opacity-60" : ""}`}>
                {p.name} · {p.sessions_total} ses.{p.price ? ` · $${Number(p.price).toLocaleString("es-AR")}` : ""}
              </span>
              <button type="button" onClick={() => toggle(p)} className="text-muted-foreground hover:text-foreground flex-shrink-0" title={p.active === false ? "Activar" : "Pausar"}>
                {p.active === false ? "▶️" : "⏸️"}
              </button>
              <button type="button" onClick={() => remove(p.id)} className="text-red-600 hover:text-red-700 flex-shrink-0" title="Borrar">
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-3">
          <Label className="text-xs">Nombre del pack</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Depilación x8" className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Sesiones</Label>
          <Input value={sessions} onChange={(e) => setSessions(e.target.value)} inputMode="numeric" className="mt-1 h-9 text-sm" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Precio ($, opcional)</Label>
          <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="mt-1 h-9 text-sm" />
        </div>
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      <Button size="sm" className="w-full" onClick={create} disabled={saving}>
        {saving ? "Guardando..." : "＋ Agregar pack"}
      </Button>
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-medium">Vender / consultar saldo</p>
        <div className="grid grid-cols-2 gap-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Tel. clienta" className="h-9 text-sm" />
          <select
            value={sellPackId}
            onChange={(e) => setSellPackId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="">Elegir pack...</option>
            {packs.filter((p) => p.active !== false).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={lookupCredits} disabled={creditsLoading}>
            Ver saldo
          </Button>
          <Button size="sm" className="flex-1" onClick={sell} disabled={creditsLoading}>
            Vender pack
          </Button>
        </div>
        {creditsMsg && <p className="text-xs text-muted-foreground">{creditsMsg}</p>}
        {credits.length > 0 && (
          <div className="space-y-1.5">
            {credits.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
                <span className="flex-1 min-w-0 font-medium truncate">
                  {c.pack_name}: <strong>{c.remaining}</strong> de {c.sessions_total} restantes
                </span>
                <button type="button" onClick={() => useOne(c.pack_id)} className="rounded-md bg-primary text-primary-foreground px-2 py-1 font-medium flex-shrink-0" title="Descontar 1 sesión">
                  Usar 1
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Días bloqueados de la agenda (feriados, vacaciones): sin turnos online ni aviso en manual. */
export function EsteticaBlocksManager() {
  const [blocks, setBlocks] = useState<{ id: string; date: string; staff_id: string | null; staff_name: string | null; reason: string | null }[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [missing, setMissing] = useState(false);
  const [date, setDate] = useState("");
  const [staffId, setStaffId] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [bRes, sRes] = await Promise.all([
        fetch("/api/vendor/estetica-blocks"),
        fetch("/api/vendor/estetica-staff"),
      ]);
      if (bRes.status === 503) {
        setMissing(true);
        return;
      }
      const bData = await bRes.json().catch(() => ({}));
      setBlocks(bData.blocks || []);
      const sData = await sRes.json().catch(() => ({}));
      setStaff((sData.staff || []).filter((s: any) => s.active !== false));
    } catch {
      setMsg("Error de conexión");
    }
  }

  useEffect(() => { load(); }, []);

  if (missing) return null;

  async function add() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setMsg("Elegí una fecha válida");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/estetica-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, staff_id: staffId || null, reason: reason.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo guardar");
      setDate("");
      setReason("");
      setStaffId("");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await fetch(`/api/vendor/estetica-blocks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      load();
    } catch {
      setMsg("No se pudo eliminar");
    }
  }

  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">🚫 Días bloqueados</p>
        <p className="text-xs text-muted-foreground">
          Feriados o vacaciones: ese día no se ofrecen turnos online
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-xs">Fecha</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-xs">Quién</Label>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Todo el centro</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label className="text-xs">Motivo (opcional)</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: Feriado, vacaciones" maxLength={120} className="mt-1 h-9 text-sm" />
      </div>
      <Button size="sm" className="w-full" onClick={add} disabled={saving}>
        {saving ? "Guardando..." : "Bloquear día"}
      </Button>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      {blocks.length > 0 && (
        <div className="space-y-1.5">
          {blocks.map((b) => (
            <div key={b.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
              <span className="flex-1 min-w-0">
                <span className="block font-medium">{fmtDate(b.date)} · {b.staff_name || "Todo el centro"}</span>
                {b.reason && <span className="block text-muted-foreground truncate">{b.reason}</span>}
              </span>
              <button type="button" onClick={() => remove(b.id)} className="flex-shrink-0 text-muted-foreground hover:text-red-600" title="Desbloquear">×</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Reporte de comisiones por profesional (turnos confirmados del rango). */
export function EsteticaCommissionsReport() {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<{ staffId: string | null; staffName: string; turnos: number; total: number; comision: number }[]>([]);
  const [totals, setTotals] = useState({ turnos: 0, total: 0, comision: 0 });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const qs = new URLSearchParams();
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) qs.set("from", from);
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) qs.set("to", to);
      const res = await fetch(`/api/vendor/estetica-staff/report?${qs.toString()}`);
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        setRows([]);
        return;
      }
      setRows(data.rows || []);
      setTotals(data.totals || { turnos: 0, total: 0, comision: 0 });
    } catch {
      setMsg("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const downloadQs = () => {
    const p = new URLSearchParams();
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) p.set("from", from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) p.set("to", to);
    return p.toString();
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">💰 Comisiones</p>
        <p className="text-xs text-muted-foreground">
          Turnos confirmados × precio y % vigentes al reservar. Solo reporte: la plata la arreglás como siempre.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Hasta (vacío = todo)</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 text-sm" />
        </div>
      </div>
      <Button size="sm" className="w-full" onClick={load} disabled={loading}>
        {loading ? "Cargando..." : "Ver comisiones"}
      </Button>
      {rows.length > 0 && (
        <div className="flex gap-2">
          <a href={`/api/vendor/estetica-staff/report?${downloadQs()}&format=xlsx`} className="flex-1 rounded-md border border-input px-2 py-1.5 text-center text-xs font-medium hover:bg-muted">
            📊 Excel
          </a>
          <a href={`/api/vendor/estetica-staff/report?${downloadQs()}&format=csv`} className="flex-1 rounded-md border border-input px-2 py-1.5 text-center text-xs font-medium hover:bg-muted">
            📄 CSV
          </a>
        </div>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      {!loading && !msg && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">Sin turnos confirmados en el rango.</p>
      )}
      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.staffId || "none"} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
              <span className="flex-1 min-w-0">
                <span className="block font-medium truncate">{r.staffName}</span>
                <span className="block text-muted-foreground">{r.turnos} turno{r.turnos === 1 ? "" : "s"} · ${r.total.toLocaleString("es-AR")}</span>
              </span>
              <span className="font-bold text-green-700 flex-shrink-0">${r.comision.toLocaleString("es-AR")}</span>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-lg border border-border px-2.5 py-2 text-xs font-bold">
            <span>Total ({totals.turnos} turnos · ${totals.total.toLocaleString("es-AR")})</span>
            <span className="text-green-700">${totals.comision.toLocaleString("es-AR")}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

type Giftcard = {  id: string;
  code: string;
  amount: number | null;
  balance: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
};

/** Giftcards (v1: emisión con saldo + canje manual con historial). */
export function EsteticaGiftcardsManager({ onChanged }: { onChanged?: () => void }) {
  const [cards, setCards] = useState<Giftcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [amount, setAmount] = useState("");
  const [buyer, setBuyer] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastCode, setLastCode] = useState<string | null>(null);
  // Canje.
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeemNote, setRedeemNote] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/giftcards");
      const data = await res.json();
      if (data.migrationMissing) setMissing(true);
      setCards(data.giftcards || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function sell() {
    if (!(Number(amount) > 0)) {
      setMsg("Poné un monto mayor a 0");
      return;
    }
    setSaving(true);
    setMsg("");
    setLastCode(null);
    try {
      const res = await fetch("/api/vendor/giftcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sell", amount: Number(amount), customer_name: buyer.trim() || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setLastCode(String(data.giftcard?.code || ""));
      setAmount("");
      setBuyer("");
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  async function redeem() {
    if (!redeemCode.trim() || !(Number(redeemAmount) > 0)) {
      setMsg("Faltan código y monto a canjear");
      return;
    }
    setRedeeming(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/giftcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "redeem",
          code: redeemCode.trim(),
          amount: Number(redeemAmount),
          note: redeemNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setMsg(`Canjeado ✅ Saldo restante: $${Number(data.giftcard?.balance || 0).toLocaleString("es-AR")}`);
      setRedeemCode("");
      setRedeemAmount("");
      setRedeemNote("");
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setRedeeming(false);
    }
  }

  async function voidCard(id: string) {
    if (!confirm("¿Anular esta tarjeta? El saldo se pierde.")) return;
    try {
      await fetch("/api/vendor/giftcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", id }),
      });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  if (missing) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Falta aplicar la migración <code>migrate-estetica-giftcards.sql</code> en la base para giftcards.
      </Card>
    );
  }

  const statusLabel = (c: Giftcard) =>
    c.status === "redeemed" ? "Agotada" : c.status === "void" ? "Anulada" : "Activa";

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">🎁 Giftcards</p>
        <p className="text-xs text-muted-foreground">
          Emitís un código con saldo (lo cobrás por caja o MP aparte) y lo canjeás en turnos, packs o productos.
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : cards.length > 0 && (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {cards.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
              <span className="flex-1 min-w-0">
                <span className="block font-mono font-bold truncate">{c.code}</span>
                <span className="block text-muted-foreground">
                  Saldo ${Number(c.balance || 0).toLocaleString("es-AR")} de ${Number(c.amount || 0).toLocaleString("es-AR")}
                  {c.customer_name ? ` · ${c.customer_name}` : ""} · {statusLabel(c)}
                </span>
              </span>
              {c.status === "active" && (
                <button type="button" onClick={() => voidCard(c.id)} className="text-red-600 hover:text-red-700 flex-shrink-0" title="Anular">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-medium">Emitir tarjeta</p>
        <div className="grid grid-cols-2 gap-2">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Monto $" className="h-9 text-sm" />
          <Input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Para quién (opcional)" className="h-9 text-sm" />
        </div>
        <Button size="sm" className="w-full" onClick={sell} disabled={saving}>
          {saving ? "Generando..." : "🎁 Emitir giftcard"}
        </Button>
        {lastCode && (
          <p className="text-xs text-center rounded-lg bg-green-50 border border-green-200 text-green-800 px-3 py-2">
            Código <strong className="font-mono">{lastCode}</strong> — pasáselo a la clienta por WhatsApp
          </p>
        )}
      </div>
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-medium">Canjear</p>
        <div className="grid grid-cols-2 gap-2">
          <Input value={redeemCode} onChange={(e) => setRedeemCode(e.target.value.toUpperCase())} placeholder="Código EST-XXXXXX" className="h-9 text-sm font-mono" />
          <Input value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value)} inputMode="decimal" placeholder="Monto $" className="h-9 text-sm" />
        </div>
        <Input value={redeemNote} onChange={(e) => setRedeemNote(e.target.value)} placeholder="Detalle (ej: turno 12/10, pack Depi)" className="h-9 text-sm" />
        <Button size="sm" variant="outline" className="w-full" onClick={redeem} disabled={redeeming}>
          {redeeming ? "Canjeando..." : "Canjear saldo"}
        </Button>
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </Card>
  );
}

type EsteticaLocation = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean | null;
};

/** Sedes del centro (multi-sede light: entidades + asignación). */
export function EsteticaLocationsManager({ onChanged }: { onChanged?: () => void }) {
  const [locations, setLocations] = useState<EsteticaLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/estetica-locations");
      const data = await res.json();
      if (data.migrationMissing) setMissing(true);
      setLocations(data.locations || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) {
      setMsg("Poné un nombre a la sede");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/estetica-locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), address: address.trim() || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setName("");
      setAddress("");
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(l: EsteticaLocation) {
    try {
      await fetch(`/api/vendor/estetica-locations/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !(l.active !== false) }),
      });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar esta sede? Servicios, profesionales y turnos quedan sin sede.")) return;
    try {
      await fetch(`/api/vendor/estetica-locations/${id}`, { method: "DELETE" });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  if (missing) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Falta aplicar la migración <code>migrate-estetica-locations.sql</code> en la base para gestionar sedes.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">📍 Sedes</p>
        <p className="text-xs text-muted-foreground">
          Si tenés más de un local, la clienta elige dónde reservar. Con una sola sede no hace falta cargar nada.
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : locations.length > 0 && (
        <div className="space-y-1.5">
          {locations.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
              <span className={`flex-1 min-w-0 ${l.active === false ? "opacity-60" : ""}`}>
                <span className="block font-medium truncate">{l.name}</span>
                {l.address && <span className="block text-muted-foreground truncate">{l.address}</span>}
              </span>
              <button type="button" onClick={() => toggle(l)} className="text-muted-foreground hover:text-foreground flex-shrink-0" title={l.active === false ? "Activar" : "Pausar"}>
                {l.active === false ? "▶️" : "⏸️"}
              </button>
              <button type="button" onClick={() => remove(l.id)} className="text-red-600 hover:text-red-700 flex-shrink-0" title="Borrar">
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej: Centro)" className="h-9 text-sm" />
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Dirección (opcional)" className="h-9 text-sm" />
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      <Button size="sm" className="w-full" onClick={create} disabled={saving}>
        {saving ? "Guardando..." : "＋ Agregar sede"}
      </Button>
    </Card>
  );
}

export type WaitEntry = {
  id: string;
  customer_name: string;
  customer_phone: string;
  service_id: string | null;
  staff_id: string | null;
  service_label: string | null;
  staff_label: string | null;
  booking_date: string;
  booking_time: string | null;
  notes: string | null;
};

/** Lista de espera (estética): quién quiere el hueco si se libera. */
export function EsteticaWaitlistManager({
  onSchedule,
}: {
  onSchedule: (w: WaitEntry) => void;
}) {
  const [waiting, setWaiting] = useState<WaitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/vendor/waitlist?date=${today}`);
      const data = await res.json().catch(() => ({}));
      if (data.migrationMissing) setMissing(true);
      const all: WaitEntry[] = data.waiting || [];
      // Próximos 8 días (la de hoy + semana).
      const max = new Date();
      max.setDate(max.getDate() + 8);
      const maxIso = max.toISOString().slice(0, 10);
      setWaiting(all.filter((w) => w.booking_date >= today && w.booking_date <= maxIso));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(id: string) {
    try {
      await fetch(`/api/vendor/waitlist/${id}`, { method: "DELETE" });
      await load();
    } catch { /* noop */ }
  }

  if (missing) return null;
  if (loading) return <p className="text-xs text-muted-foreground">Cargando espera...</p>;
  if (waiting.length === 0) return null;

  return (
    <Card className="p-3 border-amber-200 bg-amber-50">
      <p className="font-medium text-sm mb-2">🔔 Lista de espera ({waiting.length})</p>
      <div className="space-y-1.5">
        {waiting.map((w) => (
          <div key={w.id} className="flex items-center gap-2 rounded-lg bg-background px-2.5 py-2 text-xs">
            <span className="flex-1 min-w-0">
              <span className="block font-medium truncate">{w.customer_name} · {w.booking_date}{w.booking_time ? ` ${String(w.booking_time).slice(0, 5)}` : ""}</span>
              <span className="block text-muted-foreground truncate">
                {[w.service_label, w.staff_label].filter(Boolean).join(" · ") || w.customer_phone}
              </span>
            </span>
            <a
              href={`https://wa.me/${String(w.customer_phone).replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hola ${w.customer_name}! Se liberó un hueco el ${w.booking_date}. ¿Lo querés?`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-600 font-medium flex-shrink-0 hover:underline"
            >
              📲
            </a>
            <button
              type="button"
              onClick={() => onSchedule(w)}
              className="rounded-md bg-primary text-primary-foreground px-2 py-1 font-medium flex-shrink-0"
              title="Agendar turno con estos datos"
            >
              Agendar
            </button>
            <button type="button" onClick={() => remove(w.id)} className="text-muted-foreground hover:text-red-600 flex-shrink-0" title="Quitar">
              ✕
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

