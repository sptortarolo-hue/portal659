"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function BookingPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !time) return;

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

    const { error } = await supabase.from("bookings").insert({
      product_id: params.id,
      vendor_id: p.vendor_id,
      customer_id:
        (await supabase.auth.getUser()).data.user?.id ?? "",
      booking_date: date,
      booking_time: time,
      notes,
      status: "pending",
    } as any);

    if (error) {
      setMessage("Error al reservar: " + error.message);
    } else {
      setMessage("Turno reservado correctamente");
      router.push("/");
    }

    setLoading(false);
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-md">
      <h1 className="text-2xl font-bold mb-6">Reservar turno</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="date">Fecha</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="time">Hora</Label>
          <Input
            id="time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="notes">Notas</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Detalles de tu solicitud..."
          />
        </div>
        {message && (
          <p
            className={`text-sm ${
              message.includes("correctamente")
                ? "text-green-600"
                : "text-red-600"
            }`}
          >
            {message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Reservando..." : "Confirmar turno"}
        </Button>
      </form>
    </main>
  );
}