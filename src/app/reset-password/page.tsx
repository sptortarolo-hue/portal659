"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const [checking, setChecking] = useState(true);

  const verifyToken = useCallback(async (code: string) => {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      setError("El link de recuperación es inválido o expiró. Solicitá uno nuevo.");
    } else {
      setVerified(true);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      verifyToken(code);
    } else {
      setError("No se encontró el código de recuperación.");
      setChecking(false);
    }
  }, [verifyToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Contraseña actualizada correctamente. Redirigiendo al login...");
      setTimeout(() => {
        window.location.href = "/login";
      }, 2000);
    }

    setLoading(false);
  }

  if (checking) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <p className="text-muted-foreground animate-pulse">Verificando link de recuperación...</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-20 max-w-md">
      <div className="flex flex-col items-center mb-8">
        <Logo markClassName="h-14 w-14 text-primary" />
        <h1 className="font-display text-4xl font-semibold mt-4">Nueva contraseña</h1>
        <p className="text-muted-foreground mt-2">
          Ingresá tu nueva contraseña
        </p>
      </div>

      {!verified ? (
        <div className="text-center space-y-4">
          <p className="text-sm text-red-600">{error}</p>
          <Link href="/recuperar" className="text-primary underline hover:no-underline text-sm">
            Solicitar nuevo link de recuperación
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="password">Nueva contraseña</Label>
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
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Repetí tu contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {message && <p className="text-sm text-green-600">{message}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Actualizando..." : "Actualizar contraseña"}
          </Button>
        </form>
      )}
    </main>
  );
}
