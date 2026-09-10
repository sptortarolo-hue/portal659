"use client";

function SkeletonPulse({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className || ""}`} />;
}

export function OrdersSkeleton() {
  return (
    <div className="space-y-3">
      <SkeletonPulse className="h-10 w-full rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border-2 border-border bg-card p-3.5 space-y-2.5">
            <div className="flex items-start justify-between">
              <div className="space-y-1.5 flex-1">
                <SkeletonPulse className="h-4 w-28" />
                <div className="flex gap-1.5">
                  <SkeletonPulse className="h-4 w-16 rounded-full" />
                  <SkeletonPulse className="h-4 w-12 rounded-full" />
                </div>
              </div>
              <div className="space-y-1 text-right">
                <SkeletonPulse className="h-4 w-16" />
                <SkeletonPulse className="h-3 w-10" />
              </div>
            </div>
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, j) => (
                <SkeletonPulse key={j} className="h-1.5 flex-1 rounded-full" />
              ))}
            </div>
            <div className="space-y-1">
              <SkeletonPulse className="h-3 w-full" />
              <SkeletonPulse className="h-3 w-3/4" />
            </div>
            <div className="flex justify-between">
              <SkeletonPulse className="h-3 w-20" />
              <SkeletonPulse className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KdsSkeleton() {
  return (
    <div className="hidden sm:grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", alignItems: "start" }}>
      {["Nuevos", "Preparando", "Listos"].map((col) => (
        <div key={col} className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <SkeletonPulse className="h-5 w-24" />
            <SkeletonPulse className="h-4 w-8 rounded-full" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border-l-4 border-border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <SkeletonPulse className="h-5 w-12 rounded-full" />
                <SkeletonPulse className="h-4 w-14" />
              </div>
              <div className="space-y-1">
                <SkeletonPulse className="h-3 w-full" />
                <SkeletonPulse className="h-3 w-4/5" />
                <SkeletonPulse className="h-3 w-3/5" />
              </div>
              <SkeletonPulse className="h-8 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function MostradorSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="space-y-3">
        <SkeletonPulse className="h-10 w-full rounded-xl" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonPulse key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-3 xl:grid-cols-4 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-2 space-y-2">
              <SkeletonPulse className="aspect-square w-full rounded-lg" />
              <SkeletonPulse className="h-3 w-3/4" />
              <SkeletonPulse className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden sm:flex rounded-2xl border border-border bg-card p-4 flex-col gap-3">
        <SkeletonPulse className="h-5 w-32" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <SkeletonPulse className="h-3 w-28" />
            <SkeletonPulse className="h-3 w-10" />
          </div>
        ))}
        <SkeletonPulse className="h-px w-full" />
        <SkeletonPulse className="h-5 w-20 ml-auto" />
        <SkeletonPulse className="h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function MesasSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl border-2 border-border bg-card p-4 text-center space-y-2">
          <SkeletonPulse className="h-10 w-10 rounded-full mx-auto" />
          <SkeletonPulse className="h-4 w-16 mx-auto" />
          <SkeletonPulse className="h-3 w-10 mx-auto" />
        </div>
      ))}
    </div>
  );
}

export function ConfigSkeleton() {
  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <SkeletonPulse className="h-24 w-full rounded-2xl" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border p-4 space-y-3">
          <SkeletonPulse className="h-5 w-40" />
          <div className="space-y-2">
            <SkeletonPulse className="h-10 w-full" />
            <SkeletonPulse className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
