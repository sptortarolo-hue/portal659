"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type MeResponse = {
  vendorId?: string;
  vertical?: string;
  effective?: {
    slug: string;
    status: string;
    eligibleForPaid: boolean;
    trialActive: boolean;
    active: boolean;
  };
};

export function PlanesCta({ slug, planName, trial }: { slug: string; planName: string; trial: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/subscriptions/me")
      .then((r) => r.json())
      .then((d) => setMe(d))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const handleStart = async () => {
    setError("");
    if (!me?.vendorId) {
      router.push(`/register`);
      return;
    }
    if (!trial) {
      router.push(`/vendor/dashboard`);
      return;
    }
    setActivating(true);
    const res = await fetch("/api/subscriptions/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planSlug: slug }),
    });
    const data = await res.json();
    setActivating(false);
    if (data.ok) {
      router.push("/vendor/suscripcion");
      return;
    }
    setError(data.error || "No se pudo activar el plan");
  };

  if (loading) {
    return <Button className="w-full" disabled>Cargando...</Button>;
  }

  if (me?.effective?.status === "trial" || me?.effective?.status === "active") {
    return (
      <Button className="w-full" variant="outline" onClick={() => router.push("/vendor/suscripcion")}>
        Ver mi suscripción
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" onClick={handleStart} disabled={activating}>
        {activating ? "Activando..." : trial ? `Probar ${planName}` : "Empezar gratis"}
      </Button>
      {error && <p className="text-[11px] text-red-500 text-center">{error}</p>}
    </div>
  );
}