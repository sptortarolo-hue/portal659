"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";

const TIPO_OPTIONS = [
  { value: "gastronomia", label: "Gastronomía (rotisería, pizzas, comida casera)" },
  { value: "comercio", label: "Comercio del barrio (almacén, verdulería, carnicería, kiosco)" },
  { value: "servicio", label: "Servicio u oficio (electricista, plomero, jardinería)" },
  { value: "moda", label: "Ropa y accesorios (indumentaria, calzado, bijouterie)" },
  { value: "salud", label: "Salud y bienestar (farmacia, peluquería, estética, veterinaria)" },
  { value: "varios", label: "Varios (librería, ferretería, limpieza, floristería)" },
  { value: "mascotas", label: "Mascotas (pet shop, peluquería canina, veterinaria)" },
  { value: "comprador", label: "Solo quiero pedir" },
] as const;

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
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
      body: JSON.stringify({ email, password, name, tipo }),
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
        <h1 className="font-display text-4xl font-semibold mt-4">Crear cuenta</h1>
        <p className="text-muted-foreground mt-2">
          Sumate al centro comercial de tu barrio
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Nombre completo</Label>
          <Input
            id="name"
            type="text"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          {loading ? "Creando cuenta..." : "Crear cuenta"}
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
