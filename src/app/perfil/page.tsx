"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MeUser = {
  id: string;
  email: string;
  name: string;
  full_name: string | null;
  phone: string;
  whatsapp: string;
  neighborhood: string;
};

export default function PerfilPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    whatsapp: "",
    neighborhood: "",
  });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!data.user) {
          router.replace("/login");
          return;
        }
        const u: MeUser = data.user;
        setEmail(u.email);
        setForm({
          full_name: u.full_name || "",
          phone: u.phone || "",
          whatsapp: u.whatsapp || "",
          neighborhood: u.neighborhood || "",
        });
        setLoading(false);
      })
      .catch(() => {
        setError("No se pudo cargar tu perfil");
        setLoading(false);
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    setError("");
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo guardar");
      } else {
        setMsg("Perfil actualizado");
      }
    } catch {
      setError("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-10 max-w-lg">
        <div className="bg-skeleton h-72 rounded-2xl" />
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8 sm:py-12 max-w-lg">
      <h1 className="font-display text-3xl font-semibold mb-1">Mi perfil</h1>
      <p className="text-sm text-muted-foreground mb-6">Tus datos de cuenta, separados de los datos de tu comercio.</p>

      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <span className="block text-xs font-medium text-foreground mb-0.5">Email</span>
          <span>{email}</span>
        </div>

        <div>
          <Label htmlFor="perfil-nombre">Nombre</Label>
          <Input
            id="perfil-nombre"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="Tu nombre y apellido"
          />
        </div>

        <div>
          <Label htmlFor="perfil-phone">Teléfono</Label>
          <Input
            id="perfil-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="11 2345 6789"
          />
        </div>

        <div>
          <Label htmlFor="perfil-wa">WhatsApp</Label>
          <Input
            id="perfil-wa"
            type="tel"
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            placeholder="Tu número de WhatsApp"
          />
        </div>

        <div>
          <Label htmlFor="perfil-neigh">Barrio</Label>
          <Input
            id="perfil-neigh"
            value={form.neighborhood}
            onChange={(e) => setForm({ ...form, neighborhood: e.target.value })}
            placeholder="Sicardi, Garibaldi, …"
          />
        </div>

        {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-1">
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/">Volver</Link>
          </Button>
        </div>
      </form>

      <div className="bg-card border border-red-200 rounded-2xl p-6 mt-4">
        <h2 className="font-semibold text-sm mb-1">Sesiones</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Si perdiste un dispositivo o ves actividad rara, cerrá la sesión en todos lados de una vez.
        </p>
        <Button
          type="button"
          variant="destructive"
          disabled={loggingOutAll}
          onClick={async () => {
            if (!window.confirm("¿Cerrar sesión en todos los dispositivos? Vas a tener que volver a entrar en cada uno.")) return;
            setLoggingOutAll(true);
            try {
              await fetch("/api/auth/logout-all", { method: "POST" });
            } catch { /* noop */ }
            router.push("/login");
            router.refresh();
          }}
        >
          {loggingOutAll ? "Cerrando…" : "Cerrar sesión en todos los dispositivos"}
        </Button>
      </div>
    </main>
  );
}