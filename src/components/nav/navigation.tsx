import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Navigation() {
  return (
    <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">
          conectaMOS
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/products"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Productos
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Iniciar sesión
          </Link>
          <Button asChild size="sm">
            <Link href="/login">Vender</Link>
          </Button>
        </div>
      </div>
    </nav>
  );
}