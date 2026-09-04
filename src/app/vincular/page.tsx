"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function VincularPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!code.trim()) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/staff/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setMsg(`✅ Vinculado a ${data.vendor?.store_name || "tu comercio"}. Redirigiendo...`);
        setTimeout(() => router.push("/vendor/dashboard"), 800);
      } else {
        setMsg(`❌ ${data.error || "No se pudo vincular"}`);
      }
    } catch {
      setMsg("❌ Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6">
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🛵</div>
          <h1 className="font-display text-xl font-semibold">Unirme como repartidor</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ingresá el código de vinculación que te pasó tu comercio.
          </p>
        </div>

        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Código (ej. AB3DF9)"
          maxLength={6}
          className="text-center font-mono text-lg tracking-[0.3em] uppercase"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <Button className="w-full mt-4" onClick={submit} disabled={loading || !code.trim()}>
          {loading ? "Vinculando..." : "Vincular"}
        </Button>
        {msg && <p className="text-sm mt-3 text-center">{msg}</p>}
      </div>
    </main>
  );
}