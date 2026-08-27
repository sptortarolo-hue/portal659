"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export type PlanBannerData = {
  slug: string;
  status: string;
  name: string | null;
  eligibleForPaid: boolean;
  trialDaysLeft?: number;
  products: number;
  maxProducts: number | null;
  overLimit: boolean;
};

type Props = {
  plan: PlanBannerData;
};

export function PlanBanner({ plan }: Props) {
  const router = useRouter();

  if (plan.slug === "gratuito") {
    if (!plan.eligibleForPaid) return null;
    return (
      <div className="container mx-auto px-4 mt-3">
        <button
          onClick={() => router.push("/planes")}
          className="w-full text-left rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between gap-3 hover:bg-primary/10 transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">Plan Gratuito</p>
            <p className="text-xs text-muted-foreground">
              {plan.overLimit ? "Pasaste el límite de productos. Subí de plan para publicar todos." : "Probá 30 días gratis los planes de pedidos y gestión."}
            </p>
          </div>
          <Badge className="flex-shrink-0 bg-primary text-primary-foreground">Ver planes →</Badge>
        </button>
      </div>
    );
  }

  if (plan.status === "expired") {
    return (
      <div className="container mx-auto px-4 mt-3">
        <button
          onClick={() => router.push("/vendor/suscripcion")}
          className="w-full text-left rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3 flex items-center justify-between gap-3 hover:bg-red-100/60 transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">Tu plan {plan.name} venció</p>
            <p className="text-xs text-muted-foreground">Renová para seguir recibiendo pedidos online.</p>
          </div>
          <Badge className="flex-shrink-0 bg-red-600 text-white">Renovar →</Badge>
        </button>
      </div>
    );
  }

  if (plan.status === "trial") {
    return (
      <div className="container mx-auto px-4 mt-3">
        <button
          onClick={() => router.push("/vendor/suscripcion")}
          className="w-full text-left rounded-xl border border-sun/40 bg-sun/10 px-4 py-3 flex items-center justify-between gap-3 hover:bg-sun/20 transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">Probando {plan.name} · {plan.trialDaysLeft ?? 0} días</p>
            <p className="text-xs text-muted-foreground">{plan.products} de {plan.maxProducts ?? "∞"} productos publicados.</p>
          </div>
          <Badge className="flex-shrink-0 bg-sun text-ink">Suscripción →</Badge>
        </button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 mt-3">
      <button
        onClick={() => router.push("/vendor/suscripcion")}
        className="w-full text-left rounded-xl border border-green-300 bg-green-50 dark:bg-green-950/30 px-4 py-3 flex items-center justify-between gap-3 hover:bg-green-100/60 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-green-700 dark:text-green-400">{plan.name} activo</p>
          {plan.overLimit && (
            <p className="text-xs text-muted-foreground">Subiste el límite de productos: {plan.products} en total.</p>
          )}
        </div>
        <Badge className="flex-shrink-0 bg-green-600 text-white">Suscripción →</Badge>
      </button>
    </div>
  );
}