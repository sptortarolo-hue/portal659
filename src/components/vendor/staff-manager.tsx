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
  username: string | null;
  display_name: string | null;
  staff_level: string | null;
};

const LEVEL_LABEL: Record<string, string> = { admin: "Encargado", empleado: "Empleado" };

/**
 * Sección "Equipo":
 * - Repartidores: el comercio los crea (nombre + teléfono) → código único
 *   que se envía por WhatsApp con el link de /vincular. Regenerar/revocar.
 * - Usuarios del local (solo dueño): nombre + nivel (Encargado/Empleado) +
 *   contraseña. Entran por /login ("Soy del equipo") con
 *   comercio + usuario + contraseña, sin email.
 */
export function StaffManager({ storeName, showCouriers = true }: { storeName?: string; showCouriers?: boolean }) {
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [usersUnsupported, setUsersUnsupported] = useState(false);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  // Form de usuario del local.
  const [uName, setUName] = useState("");
  const [uUser, setUUser] = useState("");
  const [uLevel, setULevel] = useState("empleado");
  const [uPass, setUPass] = useState("");
  const [uSaving, setUSaving] = useState(false);
  const [changingPass, setChangingPass] = useState<string | null>(null);
  const [newPass, setNewPass] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/vendor/staff");
      const data = await res.json();
      if (data.staff) setStaff(data.staff);
      setCanManageUsers(data.canManageUsers === true);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const couriers = staff.filter((s) => s.role !== "staff");
  const users = staff.filter((s) => s.role === "staff" && s.status !== "revoked");

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

  async function addUser() {
    if (uName.trim().length < 2) {
      setMsg("❌ Ingresá el nombre de la persona");
      return;
    }
    if (!/^[a-z0-9._-]{3,20}$/.test(uUser.trim().toLowerCase())) {
      setMsg("❌ Usuario inválido: 3 a 20 caracteres (letras, números, . _ -)");
      return;
    }
    if (uPass.length < 6) {
      setMsg("❌ La contraseña debe tener al menos 6 caracteres");
      return;
    }
    setUSaving(true);
    setMsg("");
    const res = await fetch("/api/vendor/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_user", name: uName.trim(), username: uUser.trim().toLowerCase(), level: uLevel, password: uPass }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setMsg(data.reactivated ? "✅ Usuario reactivado con la nueva contraseña" : "✅ Usuario creado — ya puede entrar por Iniciar sesión → Soy del equipo");
      setUName("");
      setUUser("");
      setUPass("");
      setULevel("empleado");
      await load();
    } else {
      setMsg(`❌ ${data.error || "No se pudo crear"}`);
      if (data.code === "migration_missing") setUsersUnsupported(true);
    }
    setUSaving(false);
    setTimeout(() => setMsg(""), 5000);
  }

  async function savePassword(s: StaffItem) {
    if (newPass.length < 6) {
      setMsg("❌ La contraseña debe tener al menos 6 caracteres");
      return;
    }
    const res = await fetch("/api/vendor/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_password", id: s.id, password: newPass }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setMsg("✅ Contraseña actualizada (se cerraron sus otras sesiones)");
      setChangingPass(null);
      setNewPass("");
    } else setMsg(`❌ ${data.error || "No se pudo actualizar"}`);
    setTimeout(() => setMsg(""), 4000);
  }

  async function setLevel(s: StaffItem, level: string) {
    const res = await fetch("/api/vendor/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_level", id: s.id, level }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setMsg("✅ Nivel actualizado");
      await load();
    } else setMsg(`❌ ${data.error || "No se pudo actualizar"}`);
    setTimeout(() => setMsg(""), 4000);
  }

  async function revokeUser(s: StaffItem) {
    if (!confirm(`¿Quitar a ${s.display_name || s.username}? Perderá el acceso.`)) return;
    const res = await fetch(`/api/vendor/staff?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      setStaff((prev) => prev.filter((x) => x.id !== s.id));
      setMsg("✅ Usuario desvinculado");
    } else setMsg(`❌ ${data.error || "No se pudo quitar"}`);
    setTimeout(() => setMsg(""), 3000);
  }

  return (
    <div className="space-y-4">
      {msg && <p className="text-xs text-green-600">{msg}</p>}

      {/* Usuarios del local: solo los ve/gestiona el dueño. */}
      {canManageUsers && !usersUnsupported && (
        <div className="rounded-lg border p-3 space-y-2">
          <Label>Usuarios del local ({users.length})</Label>
          <p className="text-xs text-muted-foreground">
            Cargá nombre, nivel y contraseña. Entran por Iniciar sesión →{" "}
            <strong>Soy del equipo</strong> con el nombre de tu comercio + su usuario + su contraseña (sin email).
            El <strong>Encargado</strong> opera y edita la config; el <strong>Empleado</strong> opera
            (pedidos, mostrador, caja con cierre Z) sin tocar la config.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Nombre (ej: María)" />
            <Input value={uUser} onChange={(e) => setUUser(e.target.value.toLowerCase().replace(/\s/g, ""))} placeholder="Usuario (ej: caja1)" autoCapitalize="none" />
            <select
              value={uLevel}
              onChange={(e) => setULevel(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="empleado">Empleado</option>
              <option value="admin">Encargado</option>
            </select>
            <Input value={uPass} onChange={(e) => setUPass(e.target.value)} placeholder="Contraseña (mín. 6)" type="password" />
          </div>
          <Button size="sm" type="button" onClick={addUser} disabled={uSaving}>
            {uSaving ? "Creando..." : "+ Crear usuario"}
          </Button>

          {users.length > 0 && (
            <div className="mt-1 space-y-2">
              {users.map((s) => (
                <div key={s.id} className="rounded-lg border p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {s.display_name || s.username}
                        <span className="ml-2 text-[10px] font-semibold text-primary">
                          {LEVEL_LABEL[s.staff_level || ""] || s.staff_level}
                        </span>
                        {s.status === "active" && <span className="ml-2 text-[10px] text-green-600 font-semibold">✓ activo</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">usuario: {s.username}</p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-destructive font-medium flex-shrink-0"
                      onClick={() => revokeUser(s)}
                      title="Quitar acceso"
                    >
                      Quitar
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={s.staff_level || "empleado"}
                      onChange={(e) => setLevel(s, e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"
                      title="Nivel de usuario"
                    >
                      <option value="empleado">Empleado</option>
                      <option value="admin">Encargado</option>
                    </select>
                    {changingPass === s.id ? (
                      <span className="flex items-center gap-1 flex-1">
                        <Input
                          value={newPass}
                          onChange={(e) => setNewPass(e.target.value)}
                          placeholder="Nueva contraseña"
                          type="password"
                          className="h-8 text-xs"
                        />
                        <button type="button" className="text-xs text-primary font-medium" onClick={() => savePassword(s)}>
                          Guardar
                        </button>
                        <button type="button" className="text-xs text-muted-foreground" onClick={() => { setChangingPass(null); setNewPass(""); }}>
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="text-xs text-primary font-medium" onClick={() => { setChangingPass(s.id); setNewPass(""); }}>
                        Cambiar contraseña
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Crear repartidor */}
      {showCouriers && (
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
            placeholder="Ej: 221 555 1234 (sin 0 ni 15)"
            inputMode="tel"
          />
        </div>
        <Button size="sm" type="button" onClick={addStaff} disabled={saving}>
          {saving ? "Creando..." : "+ Crear y generar código"}
        </Button>
      </div>
      )}

      {/* Lista */}
      {showCouriers && (
      <div>
        <Label>Repartidores ({couriers.length})</Label>
        {loading ? (
          <p className="text-xs text-muted-foreground mt-1">Cargando...</p>
        ) : couriers.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1">Ninguno todavía.</p>
        ) : (
          <div className="mt-1 space-y-2">
            {couriers.map((s) => (
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
      )}
    </div>
  );
}