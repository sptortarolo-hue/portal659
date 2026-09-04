"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type StaffItem = { id: string; full_name: string | null; email: string | null; role: string; created_at: string };

/**
 * Sección "Equipo / Repartidor": el comercio genera un código de vinculación y
 * el repartidor lo ingresa desde la app (modo links by-code). Acá se listan y
 * desvinculan.
 */
export function StaffManager() {
  const [staff, setStaff] = useState<StaffItem[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/vendor/staff");
      const data = await res.json();
      if (data.staff) setStaff(data.staff);
      if (data.linkCode) setCode(data.linkCode);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function generateCode() {
    setMsg("");
    const res = await fetch("/api/vendor/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "code" }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.linkCode) {
      setCode(data.linkCode);
      setMsg("✅ Nuevo código generado — pasáselo a tu repartidor");
    } else setMsg(`❌ ${data.error || "No se pudo generar"}`);
    setTimeout(() => setMsg(""), 3000);
  }

  async function removeStaff(id: string) {
    await fetch(`/api/vendor/staff?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setStaff((prev) => prev.filter((s) => s.id !== id));
    setMsg("✅ Repartidor desvinculado");
    setTimeout(() => setMsg(""), 2500);
  }

  return (
    <div className="space-y-3">
      {msg && <p className="text-xs text-green-600">{msg}</p>}

      <div className="rounded-lg border p-3 space-y-2">
        <Label>Vinculación por código</Label>
        <p className="text-xs text-muted-foreground">
          Generá un código y pasáselo a tu repartidor para que se una desde la app
          (busca "unirme como repartidor"). Vos podés regenerar el código cuando quieras.
        </p>
        {code ? (
          <p className="font-mono text-lg text-center tracking-[0.3em] bg-muted rounded-lg py-2 select-all">
            {code}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Todavía no generaste un código.</p>
        )}
        <Button size="sm" type="button" onClick={generateCode}>
          {code ? "↻ Regenerar código" : "+ Generar código"}
        </Button>
      </div>

      <div>
        <Label>Repartidores vinculados ({staff.length})</Label>
        {loading ? (
          <p className="text-xs text-muted-foreground mt-1">Cargando...</p>
        ) : staff.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-1">Ninguno todavía.</p>
        ) : (
          <div className="mt-1 space-y-1.5">
            {staff.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border px-2 py-1.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.full_name || s.email || "Repartidor"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {s.email} · desde {new Date(s.created_at).toLocaleDateString("es-AR")}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs text-destructive font-medium flex-shrink-0"
                  onClick={() => removeStaff(s.id)}
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}