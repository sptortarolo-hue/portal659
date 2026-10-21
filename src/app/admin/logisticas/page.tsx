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
  const [tab, setTab] = useState<"carriers" | "zones" | "operators">("carriers");
  const [busy, setBusy] = useState(false);

  // Forms.
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cNotes, setCNotes] = useState("");

  const [zName, setZName] = useState("");
  const [zDesc, setZDesc] = useState("");
  const [zPrice, setZPrice] = useState("");
  const [zEta, setZEta] = useState("2");
  const [zCarrier, setZCarrier] = useState("");

  const [oEmail, setOEmail] = useState("");
  const [oCarrier, setOCarrier] = useState("");
  const [oName, setOName] = useState("");

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

        <div className="grid grid-cols-3 gap-1.5">
          {[
            { k: "carriers", l: "🤝 Logísticas" },
            { k: "zones", l: "🗺️ Zonas" },
            { k: "operators", l: "👤 Operadores" },
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
              </div>
              <Button
                size="sm"
                disabled={busy || !cName.trim()}
                onClick={async () => {
                  const ok = await save("/api/admin/carriers", "POST", { name: cName.trim(), phone: cPhone.trim(), email: cEmail.trim(), notes: cNotes.trim() }, "Logística creada");
                  if (ok) { setCName(""); setCPhone(""); setCEmail(""); setCNotes(""); }
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
                <div className="grid grid-cols-3 gap-2">
                  <Input className="h-8 text-xs" placeholder="Teléfono" defaultValue={c.phone || ""} key={`${c.id}-p`} onBlur={(e) => (e.target.value || null) !== (c.phone || null) && save("/api/admin/carriers", "PATCH", { ...c, phone: e.target.value }, "Actualizada")} />
                  <Input className="h-8 text-xs" placeholder="Email" defaultValue={c.email || ""} key={`${c.id}-e`} onBlur={(e) => (e.target.value || null) !== (c.email || null) && save("/api/admin/carriers", "PATCH", { ...c, email: e.target.value }, "Actualizada")} />
                  <Input className="h-8 text-xs" placeholder="Notas" defaultValue={c.notes || ""} key={`${c.id}-n`} onBlur={(e) => (e.target.value || null) !== (c.notes || null) && save("/api/admin/carriers", "PATCH", { ...c, notes: e.target.value }, "Actualizada")} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {Number(c.shipments_count) || 0} envíos · {Number(c.zones_count) || 0} zonas activas
                </p>
              </div>
            ))}
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
                  <Input className="h-8 text-xs" type="number" inputMode="decimal" placeholder="$" defaultValue={z.price != null ? String(z.price) : ""} key={`${z.id}-p`} onBlur={(e) => Number(e.target.value) !== Number(z.price) && save("/api/admin/ship-zones", "PATCH", { ...z, price: Number(e.target.value) }, "Actualizada")} />
                  <Input className="h-8 text-xs" type="number" inputMode="numeric" placeholder="ETA" defaultValue={z.eta_days != null ? String(z.eta_days) : ""} key={`${z.id}-e`} onBlur={(e) => Number(e.target.value) !== Number(z.eta_days) && save("/api/admin/ship-zones", "PATCH", { ...z, etaDays: Number(e.target.value) }, "Actualizada")} />
                  <Input className="h-8 text-xs" placeholder="Orden" defaultValue={z.position != null ? String(z.position) : ""} key={`${z.id}-o`} onBlur={(e) => Number(e.target.value) !== Number(z.position) && save("/api/admin/ship-zones", "PATCH", { ...z, position: Number(e.target.value) }, "Actualizada")} />
                  <select className="h-8 text-xs rounded-md border border-input bg-background px-1" defaultValue={z.carrier_id || ""} onBlur={(e) => (e.target.value || null) !== (z.carrier_id || null) && save("/api/admin/ship-zones", "PATCH", { ...z, carrierId: e.target.value || null }, "Actualizada")}>
                    <option value="">— Logística</option>
                    {carriers.filter((c: any) => c.active).map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {z.carrier_name ? `Entrega ${z.carrier_name}` : "Sin logística asignada"}
                  {z.description ? ` · ${z.description}` : ""}
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
      </div>
    </main>
  );
}
