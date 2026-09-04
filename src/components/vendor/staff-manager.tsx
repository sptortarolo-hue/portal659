"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type StaffItem = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  status: string;
  phone: string | null;
  invite_code: string | null;
  created_at: string;
};

/**
 * Sección "Equipo / Repartidor":
 * el comercio crea repartidores (nombre + teléfono) → cada uno recibe un
 * código único (token). Se lo envía por WhatsApp con el link de /vincular.
 * Soporta regenerar (nuevo código) y revocar (pierde acceso).
 */
export function StaffManager({ storeName }: { storeName?: string }) {
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/vendor/staff");
      const data = await res.json();
      if (data.staff) setStaff(data.staff);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const waShareUrl = (s: StaffItem) => {
    const tel = (s.phone || "").replace(/\D/g, "");
    const link = `${window.location.origin}/vincular?code=${s.invite_code}`;
    const text = `Hola! ${storeName || "Tu comercio"} te agregó como repartidor de Portal 659. Entrá en este link, poné tu teléfono y elegí tu contraseña: ${link}`;
    return `https://wa.me/${tel}?text=${encodeURIComponent(text)}`;
  };

  async function addStaff() {
    if (!name.trim() || !phone.trim()) {
      setMsg("Completá nombre y teléfono");
      return;
    }
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/vendor/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", name: name.trim(), phone: phone.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setMsg("✅ Repartidor creado — pasale el código por WhatsApp");
      setName("");
      setPhone("");
      await load();
    } else setMsg(`❌ ${data.error || "No se pudo crear"}`);
    setSaving(false);
    setTimeout(() => setMsg(""), 4000);
  }

  async function regenerate(s: StaffItem) {
    setRegenerating(s.id);
    setMsg("");
    const res = await fetch("/api/vendor/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate", id: s.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setMsg("↻ Código regenerado — el anterior dejó de funcionar");
      await load();
    } else setMsg(`❌ ${data.error || "No se pudo regenerar"}`);
    setRegenerating(null);
    setTimeout(() => setMsg(""), 4000);
  }

  async function revoke(s: StaffItem) {
    if (!confirm(`¿Quitar a ${s.full_name || s.phone || "este repartidor"}? Perderá el acceso.`)) return;
    await fetch(`/api/vendor/staff?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
    setStaff((prev) => prev.filter((x) => x.id !== s.id));
    setMsg("✅ Repartidor desvinculado");
    setTimeout(() => setMsg(""), 3000);
  }

  return (
    <div className="space-y-4">
      {msg && <p className="text-xs text-green-600">{msg}</p>}

      {/* Crear repartidor */}
      <div className="rounded-lg border p-3 space-y-2">
        <Label>Agregar repartidor</Label>
        <p className="text-xs text-muted-foreground">
          Cargá su nombre y teléfono. Se genera un código único que le mandás por WhatsApp;
          desde ahí elige su contraseña y queda vinculado.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre"
          />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Teléfono (con 0 y 15)"
            inputMode="tel"
          />
        </div>
        <Button size="sm" type="button" onClick={addStaff} disabled={saving}>
          {saving ? "Creando..." : "+ Crear y generar código"}
        </Button>
      </div>

      {/* Lista */}
      <div>
        <Label>Repartidores ({staff.length})</Label>
        {loading ? (
          <p className="text-xs text-muted-foreground mt-1">Cargando...</p>
        ) : staff.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1">Ninguno todavía.</p>
        ) : (
          <div className="mt-1 space-y-2">
            {staff.map((s) => (
              <div key={s.id} className="rounded-lg border p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {s.full_name || s.phone || "Repartidor"}
                      {s.status === "active" && <span className="ml-2 text-[10px] text-green-600 font-semibold">✓ activo</span>}
                      {s.status === "pending" && <span className="ml-2 text-[10px] text-amber-600 font-semibold">⏳ sin vincular</span>}
                      {s.status === "revoked" && <span className="ml-2 text-[10px] text-red-600 font-semibold">✕ revocado</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{s.phone}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {s.invite_code && (
                      <button
                        type="button"
                        className="text-xs text-primary font-medium"
                        onClick={() => {
                          navigator.clipboard?.writeText(`${window.location.origin}/vincular?code=${s.invite_code}`).catch(() => {});
                          setMsg("✅ Link copiado");
                          setTimeout(() => setMsg(""), 2500);
                        }}
                        title="Copiar link de vinculación"
                      >
                        📋
                      </button>
                    )}
                    {s.status !== "revoked" && (
                      <>
                        <button
                          type="button"
                          className="text-xs text-primary font-medium"
                          onClick={() => window.open(waShareUrl(s), "_blank")}
                          title="Enviar por WhatsApp"
                        >
                          📲
                        </button>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground font-medium"
                          onClick={() => regenerate(s)}
                          disabled={regenerating === s.id}
                          title="Regenerar código"
                        >
                          ↻
                        </button>
                        <button
                          type="button"
                          className="text-xs text-destructive font-medium"
                          onClick={() => revoke(s)}
                          title="Quitar"
                        >
                          Quitar
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {s.invite_code && (
                  <p className="font-mono text-sm tracking-[0.25em] text-center bg-muted rounded py-1 select-all">
                    {s.invite_code}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}