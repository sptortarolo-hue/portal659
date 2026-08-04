import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M32 2C20.4 2 11 11.4 11 23c0 15.6 19.4 36.6 21 39 1.6-2.4 21-23.4 21-39 0-11.6-9.4-21-21-21z"
        fill="currentColor"
      />
      <circle cx="32" cy="22" r="8" fill="#a3e635" />
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
        Portal <span className="text-primary">659</span>
      </span>
    </span>
  );
}
