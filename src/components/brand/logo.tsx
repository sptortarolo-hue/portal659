"use client";

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
      <circle cx="32" cy="22" r="8" fill="#f5b800" />
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
  const isLarge = markClassName?.includes("h-14") ?? false;

  return (
    <span className={cn("inline-flex items-center", isLarge ? "h-auto" : "h-full", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="Portal 659"
        className={cn("object-contain", isLarge ? "h-14 w-auto" : "h-full w-auto")}
      />
    </span>
  );
}