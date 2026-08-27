"use client";

import { useRouter } from "next/navigation";

export function PlanLock({ title, description, cta = "Ver planes" }: { title: string; description?: string; cta?: string }) {
  const router = useRouter();
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
      <div className="text-3xl mb-3">🔒</div>
      <p className="font-display font-semibold">{title}</p>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>}
      <button
        onClick={() => router.push("/planes")}
        className="mt-4 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
      >
        {cta}
      </button>
    </div>
  );
}