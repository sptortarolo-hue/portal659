"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * /admin/logisticas — Portal 659 Envíos: alta de logísticas partner, catálogo
 * de zonas extendidas y operadores (login normal + carrier_operators).
 */
export default function LogisticasAdminPage() {
  const [carriers, setCarriers] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"carriers" | "zones" | "operators" | "solicitudes" | "settlement">("carriers");
  const [busy, setBusy] = useState(false);

  // Forms.
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cNotes, setCNotes] = useState("");
  const [cWaPhones, setCWaPhones] = useState("");
  const [cWaInvite, setCWaInvite] = useState("");

  const [zName, setZName] = useState("");
  const [zDesc, setZDesc] = useState("");
  const [zPrice, setZPrice] = useState("");
  const [zEta, setZEta] = useState("2");
  const [zCarrier, setZCarrier] = useState("");

  const [oEmail, setOEmail] = useState("");
  const [oCarrier, setOCarrier] = useState("");
  const [oName, setOName] = useState("");

  // Liquidación.
  const [liCarrier, setLiCarrier] = useState("all");
  const [liFrom, setLiFrom] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const [liTo, setLiTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [liSummary, setLiSummary] = useState<any | null>(null);
  const [liError, setLiError] = useState("");

  const loadSettlement = useCallback(async () => {
    setLiError("");
    try {
      const qs = new URLSearchParams({ carrierId: liCarrier, from: liFrom, to: liTo });
      const res = await fetch(`/api/admin/shipments/settlement?${qs.toString()}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLiSummary(null);
        setLiError(j.error || "No se pudo calcular");
        return;
      }
      setLiSummary(j);
    } catch {
      setLiError("Error de red");
    }
  }, [liCarrier, liFrom, liTo]);

  useEffect(() => {
    if (tab === "settlement") loadSettlement();
  }, [tab, loadSettlement]);

  const load = useCallback(async () => {
    try {
      const [cRes, zRes] = await Promise.all([
        fetch("/api/admin/carriers"),
        fetch("/api/admin/ship-zones"),
      ]);
      if (cRes.status === 403) {
        setError("No autorizado");
        return;
      }
      const cData = await cRes.json().catch(() => ({}));
      const zData = await zRes.json().catch(() => ({}));
      if (cData.error || zData.error) {
        setError(cData.error || zData.error || "Falta la migración de envíos");
      } else {
        setError("");
        setCarriers(Array.isArray(cData?.carriers) ? cData.carriers : []);
        setZones(Array.isArray(zData?.zones) ? zData.zones : []);
        setOperators(Array.isArray(zData?.operators) ? zData.operators : []);
      }
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(url: string, method: string, body: unknown, okMsg: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error || "No se pudo guardar");
        return false;
      }
      setMsg(okMsg);
      await load();
      return true;
    } catch {
      setMsg("Error de red");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function uploadOperator(userMail: string, carrierId: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/ship-zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "operator", email: userMail, carrierId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(j.error || "No se pudo dar de alta el operador");
        return;
      }
      setMsg("Operador dado de alta");
      await load();
    } catch {
      setMsg("Error de red");
    } finally {
      setBusy(false);
    }
  }

  if (error && error === "No autorizado") {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">← Admin</Link>
          <h1 className="text-lg font-bold">🚚 Portal 659 Envíos</h1>
        </div>
        <div className="rounded-xl border border-border bg-background p-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground flex-1 min-w-0">
            Invitá logísticas por WhatsApp: compartí el link de registro.
          </p>
          <a
            href={`https://wa.me/?text=${encodeURIComponent("Sumate a Portal 659 Envíos y repartí para los comercios de tu barrio. Registrate acá: " + (typeof window !== "undefined" ? window.location.origin : "https://www.portal659.com.ar") + "/registro-logistica")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"
          >
            📲 Compartir por WhatsApp
          </a>
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {[
            { k: "carriers", l: "🤝 Logísticas" },
            { k: "zones", l: "🗺️ Zonas" },
            { k: "operators", l: "👤 Operadores" },
            { k: "solicitudes", l: "📥 Solicitudes" },
            { k: "settlement", l: "🧾 Liquidación" },
          ].map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k as any)}
              className={`rounded-lg py-1.5 px-2 text-xs font-medium border transition-colors ${
                tab === t.k ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
        )}
        {msg && (
          <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">{msg}</div>
        )}

        {/* Carriers */}
        {tab === "carriers" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-background p-3 space-y-2">
              <p className="text-sm font-semibold">Nueva logística partner</p>
              <div className="grid grid-cols-2 gap-2">
                <Input className="h-9 text-sm" placeholder="Nombre*" value={cName} onChange={(e) => setCName(e.target.value)} maxLength={120} />
                <Input className="h-9 text-sm" placeholder="Teléfono" value={cPhone} onChange={(e) => setCPhone(e.target.value)} maxLength={40} />
                <Input className="h-9 text-sm" placeholder="Email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} maxLength={120} />
                <Input className="h-9 text-sm" placeholder="Notas" value={cNotes} onChange={(e) => setCNotes(e.target.value)} maxLength={500} />
                <Input className="h-9 text-sm" placeholder="Teléfonos WA (coma)" value={cWaPhones} onChange={(e) => setCWaPhones(e.target.value)} maxLength={400} />
                <Input className="h-9 text-sm" placeholder="Link de grupo WA" value={cWaInvite} onChange={(e) => setCWaInvite(e.target.value)} maxLength={500} />
              </div>
              <Button
                size="sm"
                disabled={busy || !cName.trim()}
                onClick={async () => {
                  const ok = await save("/api/admin/carriers", "POST", { name: cName.trim(), phone: cPhone.trim(), email: cEmail.trim(), notes: cNotes.trim(), wa_phones: cWaPhones.trim(), wa_invite_url: cWaInvite.trim() }, "Logística creada");
                  if (ok) { setCName(""); setCPhone(""); setCEmail(""); setCNotes(""); setCWaPhones(""); setCWaInvite(""); }
                }}
              >
                Crear
              </Button>
            </div>
            {carriers.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-background p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Input
                    className="h-9 text-sm font-bold"
                    defaultValue={c.name}
                    key={`${c.id}-${c.name}`}
                    onBlur={(e) => e.target.value !== c.name && save("/api/admin/carriers", "PATCH", { ...c, name: e.target.value }, "Actualizada")}
                    maxLength={120}
                  />
                  <Switch
                    checked={c.active}
                    onCheckedChange={(v) => save("/api/admin/carriers", "PATCH", { ...c, active: v }, "Actualizada")}
                  />
                </div>
                {c.self_registered && (
                  <span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    📥 Autoregistrada {c.active ? "· activa" : "· pendiente de aprobación"}
                  </span>
                )}
                {c.contact_name && (
                  <p className="text-[11px] text-muted-foreground">Contacto: {c.contact_name}</p>
                )}
                {c.coverage && (
                  <p className="text-[11px] text-muted-foreground">Cobertura: {c.coverage}</p>
                )}
                {c.vehicle && (
                  <p className="text-[11px] text-muted-foreground">Vehículo: {c.vehicle}</p>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Input className="h-8 text-xs" placeholder="Teléfono" defaultValue={c.phone || ""} key={`${c.id}-p`} onBlur={(e) => (e.target.value || null) !== (c.phone || null) && save("/api/admin/carriers", "PATCH", { ...c, phone: e.target.value }, "Actualizada")} />
                  <Input className="h-8 text-xs" placeholder="Email" defaultValue={c.email || ""} key={`${c.id}-e`} onBlur={(e) => (e.target.value || null) !== (c.email || null) && save("/api/admin/carriers", "PATCH", { ...c, email: e.target.value }, "Actualizada")} />
                  <Input className="h-8 text-xs" placeholder="Notas" defaultValue={c.notes || ""} key={`${c.id}-n`} onBlur={(e) => (e.target.value || null) !== (c.notes || null) && save("/api/admin/carriers", "PATCH", { ...c, notes: e.target.value }, "Actualizada")} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input className="h-8 text-xs" placeholder="Teléfonos WA (coma)" defaultValue={c.wa_phones || ""} key={`${c.id}-wp`} onBlur={(e) => (e.target.value || null) !== (c.wa_phones || null) && save("/api/admin/carriers", "PATCH", { ...c, wa_phones: e.target.value }, "Actualizada")} />
                  <Input className="h-8 text-xs" placeholder="Link de grupo WA" defaultValue={c.wa_invite_url || ""} key={`${c.id}-wi`} onBlur={(e) => (e.target.value || null) !== (c.wa_invite_url || null) && save("/api/admin/carriers", "PATCH", { ...c, wa_invite_url: e.target.value }, "Actualizada")} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {Number(c.shipments_count) || 0} envíos · {Number(c.zones_count) || 0} zonas activas
                  {" · "}WA: teléfonos de despacho separados por coma y/o link de invitación al grupo (así avisa el comercio).
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Solicitudes de autoregistro pendientes */}
        {tab === "solicitudes" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Logísticas registradas por sí mismas (autoregistro). Aprobá para activarlas y que empiecen a recibir encargos;
              rechazá si no corresponden.
            </p>
            {carriers.filter((c: any) => c.self_registered && !c.active).length === 0 ? (
              <div className="rounded-xl border border-border bg-background p-6 text-center">
                <p className="text-sm text-muted-foreground">No hay solicitudes pendientes 🎉</p>
              </div>
            ) : (
              carriers
                .filter((c: any) => c.self_registered && !c.active)
                .map((c: any) => (
                  <div key={c.id} className="rounded-xl border border-border bg-background p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{c.name}</p>
                        {c.contact_name && <p className="text-[11px] text-muted-foreground">Contacto: {c.contact_name}</p>}
                        {c.phone && <p className="text-[11px] text-muted-foreground">WhatsApp: {c.phone}</p>}
                        {c.email && <p className="text-[11px] text-muted-foreground">Email: {c.email}</p>}
                        {c.coverage && <p className="text-[11px] text-muted-foreground">Cobertura: {c.coverage}</p>}
                        {c.vehicle && <p className="text-[11px] text-muted-foreground">Vehículo: {c.vehicle}</p>}
                        {c.notes && <p className="text-[11px] text-muted-foreground">Notas: {c.notes}</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          const ok = await save("/api/admin/carriers", "POST", { action: "approve", id: c.id }, "Logística aprobada");
                          if (ok) await load();
                        }}
                      >
                        ✅ Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={async () => {
                          const note = window.prompt("Motivo del rechazo (opcional):") || "";
                          const ok = await save("/api/admin/carriers", "POST", { action: "reject", id: c.id, note }, "Solicitud rechazada");
                          if (ok) await load();
                        }}
                      >
                        ❌ Rechazar
                      </Button>
                    </div>
                  </div>
                ))
            )}
          </div>
        )}

        {/* Zonas */}
        {tab === "zones" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-background p-3 space-y-2">
              <p className="text-sm font-semibold">Nueva zona extendida</p>
              <div className="grid grid-cols-2 gap-2">
                <Input className="h-9 text-sm" placeholder="Nombre (ej: Ferreyra)*" value={zName} onChange={(e) => setZName(e.target.value)} maxLength={120} />
                <Input className="h-9 text-sm" placeholder="Descripción" value={zDesc} onChange={(e) => setZDesc(e.target.value)} maxLength={300} />
                <Input className="h-9 text-sm" placeholder="Precio $" type="number" inputMode="decimal" min="1" value={zPrice} onChange={(e) => setZPrice(e.target.value)} />
                <Input className="h-9 text-sm" placeholder="ETA días" type="number" inputMode="numeric" min="1" value={zEta} onChange={(e) => setZEta(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Logística</Label>
                <select
                  className="mt-0.5 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={zCarrier}
                  onChange={(e) => setZCarrier(e.target.value)}
                >
                  <option value="">—</option>
                  {carriers.filter((c: any) => c.active).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <Button
                size="sm"
                disabled={busy || !zName.trim() || !Number(zPrice)}
                onClick={async () => {
                  const ok = await save(
                    "/api/admin/ship-zones",
                    "POST",
                    { kind: "zone", name: zName.trim(), description: zDesc.trim(), price: Number(zPrice), etaDays: Number(zEta), carrierId: zCarrier || null },
                    "Zona creada"
                  );
                  if (ok) { setZName(""); setZDesc(""); setZPrice(""); setZEta("2"); setZCarrier(""); }
                }}
              >
                Crear
              </Button>
            </div>
            {zones.map((z) => (
              <div key={z.id} className="rounded-xl border border-border bg-background p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Input
                    className="h-9 text-sm font-bold"
                    defaultValue={z.name}
                    key={`${z.id}-${z.name}`}
                    onBlur={(e) => e.target.value !== z.name && save("/api/admin/ship-zones", "PATCH", { ...z, name: e.target.value }, "Actualizada")}
                    maxLength={120}
                  />
                  <Switch checked={z.active} onCheckedChange={(v) => save("/api/admin/ship-zones", "PATCH", { ...z, active: v }, "Actualizada")} />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Input className="h-8 text-xs" type="number" inputMode="decimal" placeholder="Precio $" defaultValue={z.price != null ? String(z.price) : ""} key={`${z.id}-p`} onBlur={(e) => Number(e.target.value) !== Number(z.price) && save("/api/admin/ship-zones", "PATCH", { ...z, price: Number(e.target.value) }, "Actualizada")} />
                  <Input className="h-8 text-xs" type="number" inputMode="numeric" placeholder="ETA" defaultValue={z.eta_days != null ? String(z.eta_days) : ""} key={`${z.id}-e`} onBlur={(e) => Number(e.target.value) !== Number(z.eta_days) && save("/api/admin/ship-zones", "PATCH", { ...z, etaDays: Number(e.target.value) }, "Actualizada")} />
                  <Input className="h-8 text-xs" placeholder="Orden" defaultValue={z.position != null ? String(z.position) : ""} key={`${z.id}-o`} onBlur={(e) => Number(e.target.value) !== Number(z.position) && save("/api/admin/ship-zones", "PATCH", { ...z, position: Number(e.target.value) }, "Actualizada")} />
                  <select className="h-8 text-xs rounded-md border border-input bg-background px-1" defaultValue={z.carrier_id || ""} onBlur={(e) => (e.target.value || null) !== (z.carrier_id || null) && save("/api/admin/ship-zones", "PATCH", { ...z, carrierId: e.target.value || null }, "Actualizada")}>
                    <option value="">— Logística</option>
                    {carriers.filter((c: any) => c.active).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">Tarifa de la logística al local ($):</span>
                  <Input
                    className="h-8 text-xs flex-1"
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    defaultValue={z.carrier_fee != null ? String(z.carrier_fee) : ""}
                    key={`${z.id}-cf`}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 0) return;
                      save("/api/admin/ship-zones", "PATCH", { kind: "zone_rate", id: z.id, fee: v }, "Tarifa actualizada");
                    }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {z.carrier_name ? `Entrega ${z.carrier_name}` : "Sin logística asignada"}
                  {z.description ? ` · ${z.description}` : ""}
                  {" · "}El comprador paga ${Math.round(Number(z.price) || 0).toLocaleString("es-AR")} de envío.
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Operadores */}
        {tab === "operators" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-background p-3 space-y-2">
              <p className="text-sm font-semibold">Dar de alta un operador</p>
              <p className="text-xs text-muted-foreground">El usuario ya tiene que tener cuenta en el portal (para registrarse primero).</p>
              <div className="grid grid-cols-3 gap-2">
                <Input className="h-9 text-sm" placeholder="Email del usuario*" value={oEmail} onChange={(e) => setOEmail(e.target.value)} />
                <Input className="h-9 text-sm" placeholder="Alias (opcional)" value={oName} onChange={(e) => setOName(e.target.value)} />
                <select className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={oCarrier} onChange={(e) => setOCarrier(e.target.value)}>
                  <option value="">Logística…</option>
                  {carriers.filter((c: any) => c.active).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <Button
                size="sm"
                disabled={busy || !oEmail.trim() || !oCarrier}
                onClick={() => uploadOperator(oEmail.trim(), oCarrier)}
              >
                Dar de alta
              </Button>
            </div>
            {operators.length === 0 ? (
              <p className="text-xs text-muted-foreground">No hay operadores dados de alta.</p>
            ) : (
              operators.map((o: any) => (
                <div key={o.id} className="rounded-xl border border-border bg-background px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{o.operator_name || o.operator_email || o.profile_id}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {o.carrier_name}{o.operator_email ? ` · ${o.operator_email}` : ""}
                    </p>
                  </div>
                  <Switch checked={o.active} onCheckedChange={(v) => save("/api/admin/ship-zones", "PATCH", { kind: "operator", id: o.id, active: v }, "Actualizado")} />
                </div>
              ))
            )}
          </div>
        )}
        {/* Liquidación */}
        {tab === "settlement" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-background p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={liCarrier}
                  onChange={(e) => setLiCarrier(e.target.value)}
                >
                  <option value="all">Todas las logísticas</option>
                  {carriers.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <Input className="h-9 text-sm" type="date" value={liFrom} onChange={(e) => setLiFrom(e.target.value)} />
                <Input className="h-9 text-sm" type="date" value={liTo} onChange={(e) => setLiTo(e.target.value)} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                El monto es lo cobrado al comprador como envío. La tarifa que le pagás a la logística (por envío
                entregado, acordada aparte) sale de este listado a fin de mes.
              </p>
            </div>

            {liError && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{liError}</div>
            )}

            {liSummary && (
              <>
                <div className="rounded-xl border border-border bg-background p-3 space-y-1.5">
                  <p className="text-sm font-semibold">
                    {liSummary.rows?.length || 0} envíos
                    {liSummary.rows?.length ? ` · ${liSummary.carrier === "all" ? "todas las logísticas" : ""}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries((liSummary.totals || {}) as Record<string, unknown>)
                      .filter(([k]) => !["envios"].includes(k))
                      .map(([k, v]) => (
                        <span key={k} className="inline-block rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px]">
                          {k}: <strong>{String(v)}</strong>
                        </span>
                      ))}
                  </div>
                </div>

                {liSummary.rows?.length > 0 && (
                  <div className="rounded-xl border border-border bg-background divide-y divide-border">
                    {liSummary.rows.map((r: any) => (
                      <div key={r.code} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{r.code} · {r.comercio}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {r.fecha} · {r.carrier} · {r.zona} · {r.estado}{r.pod === "Sí" ? " · 📷 POD" : ""}
                          </p>
                        </div>
                        <span className="text-sm font-semibold shrink-0">${r.fee}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <a
                    className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    href={`/api/admin/shipments/settlement?carrierId=${encodeURIComponent(liCarrier)}&from=${encodeURIComponent(liFrom)}&to=${encodeURIComponent(liTo)}&format=xlsx`}
                  >
                    ⬇ Descargar XLSX
                  </a>
                  <a
                    className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted/50"
                    href={`/api/admin/shipments/settlement?carrierId=${encodeURIComponent(liCarrier)}&from=${encodeURIComponent(liFrom)}&to=${encodeURIComponent(liTo)}&format=csv`}
                  >
                    ⬇ CSV
                  </a>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
