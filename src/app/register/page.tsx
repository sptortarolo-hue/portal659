"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Logo } from "@/components/brand/logo";
import { checkArgPhone, toE164Plus } from "@/lib/phone";

const TIPO_OPTIONS = [
  { value: "gastronomia", label: "Gastronomía (rotisería, pizzas, comida casera)" },
  { value: "comercio", label: "Comercio del barrio (almacén, verdulería, carnicería, kiosco, librería, ferretería, floristería, pet shop, veterinaria)" },
  { value: "servicio", label: "Servicio u oficio (electricista, plomero, jardinería)" },
  { value: "moda", label: "Ropa y accesorios (indumentaria, calzado, bijouterie)" },
  { value: "salud", label: "Salud y bienestar (farmacia, peluquería, estética)" },
  { value: "otro", label: "Otro" },
] as const;

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tipo, setTipo] = useState("gastronomia");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, firstName, lastName, whatsapp, tipo }),
    });

    const data = await res.json();

    if (data.error) {
      setMessage(data.error);
    } else {
      setMessage("Cuenta creada. Revisá tu email para confirmar el registro.");
      setTimeout(() => router.push("/login"), 3000);
    }

    setLoading(false);
  }

  return (
    <main className="container mx-auto px-4 py-20 max-w-md">
      <div className="flex flex-col items-center mb-8">
        <Logo markClassName="h-14 w-14 text-primary" />
        <h1 className="font-display text-4xl font-semibold mt-4">Creá tu comercio gratis</h1>
        <p className="text-muted-foreground mt-2">
          Registrate y armá tu vidriera en Portal 659 en minutos
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
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input
            id="whatsapp"
            type="tel"
            placeholder="Ej: 11 5555 1234"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            required
          />
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
          <Input
            id="password"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        <div>
          <Label htmlFor="tipo">¿Qué tipo de emprendimiento tenés?</Label>
          <select
            id="tipo"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            {TIPO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {message && (
          <p
            className={`text-sm ${
              message.includes("Revisá") || message.includes("creada")
                ? "text-green-600"
                : "text-red-600"
            }`}
          >
            {message}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creando tu comercio..." : "Crear mi comercio gratis"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-4">
        ¿Ya tenés cuenta?{" "}
        <Link
          href="/login"
          className="text-primary underline hover:no-underline"
        >
          Iniciar sesión
        </Link>
      </p>
    </main>
  );
}
