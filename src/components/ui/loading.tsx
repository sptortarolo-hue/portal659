export function PageLoader() {
  return (
    <main className="container mx-auto px-4 py-20 max-w-md text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-skeleton" />
        <div className="space-y-2 w-full">
          <div className="h-4 bg-skeleton rounded w-3/4 mx-auto" />
          <div className="h-3 bg-skeleton rounded w-1/2 mx-auto" />
        </div>
      </div>
    </main>
  );
}

export function CardLoader() {
  return (
    <div className="border border-border rounded-xl p-4 bg-card space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-lg bg-skeleton" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-skeleton rounded w-2/3" />
          <div className="h-3 bg-skeleton rounded w-1/3" />
        </div>
      </div>
    </div>
  );
}

export function ListLoader({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardLoader key={i} />
      ))}
    </div>
  );
}
