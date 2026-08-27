"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logoP659.png"
      alt="Portal 659"
      width={48}
      height={48}
      className={cn("rounded-lg object-contain", className)}
      priority
    />
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
    <span className={cn("inline-flex items-center", className)}>
      <LogoMark className={markClassName ?? "h-10 w-10"} />
    </span>
  );
}
