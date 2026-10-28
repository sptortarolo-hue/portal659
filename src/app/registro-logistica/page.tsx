"use client";

import { useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Logo } from "@/components/brand/logo";
import { checkArgPhone, toE164Plus } from "@/lib/phone";

function RegistroLogisticaForm() {
  const router = useRouter();

  const [kind, setKind] = useState<"individuo" | "flota">("individuo");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [coverage, setCoverage] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phoneMsg, setPhoneMsg] = useState("");
  const [phoneOk, setPhoneOk] = useState(false);

  function updatePhone(raw: string) {
    setPhone(raw);
    if (!raw) {
      setPhoneMsg("");
      setPhoneOk(false);
      return;
    }
    const res = checkArgPhone(raw);
    if (res.ok) {
      setPhoneMsg(`Se usará ${res.formatted} para los avisos y el ingreso`);
      setPhoneOk(true);
    } else if (res.invalid) {
      setPhoneMsg(res.message);
      setPhoneOk(false);
    } else {
      setPhoneMsg("");
      setPhoneOk(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      setLoading(false);
      return;
    }
    const e164 = toE164Plus(phone);
    if (!e164) {
      setError("Ingresá un WhatsApp válido (celular)");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/register-carrier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        name,
        businessName: kind === "flota" ? businessName : undefined,
        email,
        whatsapp: e164,
        password,
        coverage,
        vehicle,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      setError(data.error || "No se pudo registrar la logística");
      setLoading(false);
      return;
    }

    window.dispatchEvent(new Event("auth-changed"));
    router.push("/envios?nueva=1");
  }

  return (
    <main className="container mx-auto px-4 py-14 max-w-md">
      <div className="flex flex-col items-center mb-6">
        <Logo markClassName="h-14 w-14 text-primary" />
        <h1 className="font-display text-3xl font-semibold mt-4 text-center">Sumá tu logística</h1>
        <p className="text-muted-foreground mt-2 text-center text-sm">
          Recibí los envíos extendidos de los comercios del barrio. Vos definís tu tarifa y el local te paga al retirar.{" "}
          <Link href="/logisticas" className="underline">Ver cómo funciona</Link>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { key: "individuo", label: "🏍️ Soy individual", hint: "Reparto por mi cuenta" },
              { key: "flota", label: "🚐 Tengo una flota", hint: "Con repartidores a cargo" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setKind(opt.key)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                kind === opt.key
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted"
              }`}
            >
              <p className="text-sm font-bold">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground">{opt.hint}</p>
            </button>
          ))}
        </div>

        <div>
          <Label htmlFor="name">{kind === "flota" ? "Tu nombre (contacto)" : "Tu nombre"}</Label>
          <Input id="name" type="text" placeholder="Juan Gómez" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </div>

        {kind === "flota" && (
          <div>
            <Label htmlFor="businessName">Nombre de la logística</Label>
            <Input id="businessName" type="text" placeholder="Ej: Mensajería del Barrio" value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={120} />
          </div>
        )}

        <div>
          <Label htmlFor="phone">WhatsApp</Label>
          <Input
            id="phone"
            type="tel"
            placeholder="11 5555 1234"
            value={phone}
            onChange={(e) => updatePhone(e.target.value)}
            className={
              phone && phoneOk === false && phone.length >= 10
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
        </div>

        <div>
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="coverage">Zona de cobertura</Label>
            <Input id="coverage" type="text" placeholder="La Plata, Berisso" value={coverage} onChange={(e) => setCoverage(e.target.value)} maxLength={300} />
          </div>
          <div>
            <Label htmlFor="vehicle">Vehículo</Label>
            <Input id="vehicle" type="text" placeholder="Moto / Auto" value={vehicle} onChange={(e) => setVehicle(e.target.value)} maxLength={60} />
          </div>
        </div>

        <div>
          <Label htmlFor="password">Contraseña</Label>
          <PasswordInput id="password" placeholder="Mínimo 6 caracteres" value={password} onChange={setPassword} required minLength={6} autoComplete="new-password" />
        </div>
        <div>
          <Label htmlFor="confirm">Repetí tu contraseña</Label>
          <PasswordInput id="confirm" placeholder="Repetí tu contraseña" value={confirm} onChange={setConfirm} required minLength={6} autoComplete="new-password" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" className="w-full h-11" disabled={loading}>
          {loading ? "Enviando solicitud..." : "Registrar mi logística"}
        </Button>

        <p className="text-[11px] text-muted-foreground text-center">
          Al registrarte aceptás que el equipo de Portal 659 revise tu solicitud antes de activarte.
          El cobro de cada envío lo acordás con cada comercio.
        </p>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-4">
        ¿Ya tenés cuenta de logística?{" "}
        <Link href="/login?next=/envios" className="text-primary underline hover:no-underline">
          Iniciar sesión
        </Link>
      </p>
    </main>
  );
}

export default function RegistroLogisticaPage() {
  return (
    <Suspense fallback={null}>
      <RegistroLogisticaForm />
    </Suspense>
  );
}
