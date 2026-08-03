import Link from "next/link";
import { UserMenu } from "./user-menu";

export function Navigation() {
  return (
    <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="font-display text-2xl font-semibold tracking-tight"
        >
          conecta<span className="text-primary">MOS</span>
        </Link>
        <UserMenu />
      </div>
    </nav>
  );
}
