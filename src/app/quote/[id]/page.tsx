"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function QuotePage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email) return;

    setLoading(true);

    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("id", params.id)
      .single();

    if (!product) {
      setMessage("Producto no encontrado");
      setLoading(false);
      return;
    }

    const p = product as any;

    const { error } = await supabase.from("quotes").insert({
      product_id: params.id,
      vendor_id: p.vendor_id,
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      details,
      status: "pending",
    } as any);

    if (error) {
      setMessage("Error al solicitar presupuesto: " + error.message);
    } else {
      setMessage("Presupuesto solicitado. El vendedor te va a contactar.");
      setTimeout(() => router.push("/"), 3000);
    }

    setLoading(false);
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-md">
      <h1 className="text-2xl font-bold mb-6">Solicitar presupuesto</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Tu nombre</Label>
          <Input
            id="name"
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="phone">Teléfono / WhatsApp</Label>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="details">Detalles de tu necesidad</Label>
          <Textarea
            id="details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Contanos qué necesitás..."
          />
        </div>
        {message && (
          <p
            className={`text-sm ${
              message.includes("correctamente") ||
              message.includes("vendedor")
                ? "text-green-600"
                : "text-red-600"
            }`}
          >
            {message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Enviando..." : "Enviar solicitud"}
        </Button>
      </form>
    </main>
  );
}