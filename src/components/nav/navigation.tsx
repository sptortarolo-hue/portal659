import Link from "next/link";
import { UserMenu } from "./user-menu";

export function Navigation() {
  return (
    <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">
          conectaMOS
        </Link>
        <UserMenu />
      </div>
    </nav>
  );
}