export default function Loading() {
  return (
    <main className="container mx-auto px-4 py-20 max-w-md text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="h-14 w-14 rounded-full bg-primary/20" />
          <div className="absolute inset-0 h-14 w-14 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
        <div className="space-y-2 w-full">
          <div className="h-4 bg-skeleton rounded w-3/4 mx-auto" />
          <div className="h-3 bg-skeleton rounded w-1/2 mx-auto" />
        </div>
      </div>
    </main>
  );
}
