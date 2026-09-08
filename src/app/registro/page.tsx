"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Logo } from "@/components/brand/logo";
import { checkArgPhone, toE164Plus } from "@/lib/phone";

function RegistroForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
      setPhoneMsg(`Se usará ${res.formatted} para iniciar sesión`);
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

    const res = await fetch("/api/auth/register-buyer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, firstName, lastName, whatsapp: e164 }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      setError(data.error || "No se pudo crear la cuenta");
      setLoading(false);
      return;
    }

    window.dispatchEvent(new Event("auth-changed"));
    const safeNext = next && next.startsWith("/") ? next : "/";
    router.push(safeNext);
  }

  return (
    <main className="container mx-auto px-4 py-20 max-w-md">
      <div className="flex flex-col items-center mb-8">
        <Logo markClassName="h-14 w-14 text-primary" />
        <h1 className="font-display text-4xl font-semibold mt-4">Creá tu cuenta</h1>
        <p className="text-muted-foreground mt-2 text-center">
          Guardá favoritos, tus datos de contacto e historial de pedidos en Portal 659
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="firstName">Nombre</Label>
            <Input
              id="firstName"
              type="text"
              placeholder="Tu nombre"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="lastName">Apellido</Label>
            <Input
              id="lastName"
              type="text"
              placeholder="Tu apellido"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
        </div>
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
          <Input
            id="email"
            type="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="password">Contraseña</Label>
          <PasswordInput
            id="password"
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={setPassword}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>
        <div>
          <Label htmlFor="confirm">Repetí tu contraseña</Label>
          <PasswordInput
            id="confirm"
            placeholder="Repetí tu contraseña"
            value={confirm}
            onChange={setConfirm}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creando cuenta..." : "Crear mi cuenta"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-4">
        ¿Ya tenés cuenta?{" "}
        <Link href={next && next.startsWith("/") ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-primary underline hover:no-underline">
          Iniciar sesión
        </Link>
      </p>
    </main>
  );
}

export default function RegistroPage() {
  return (
    <Suspense fallback={null}>
      <RegistroForm />
    </Suspense>
  );
}