import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="32" fill="currentColor" />
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 45 V24 L27 32 L32 42 L37 32 L46 24 V45" />
      </g>
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName ?? "h-8 w-8 text-primary"} />
      <span className="font-display text-2xl font-semibold tracking-tight">
        Se<span className="text-primary">Morfa</span>
      </span>
    </span>
  );
}
