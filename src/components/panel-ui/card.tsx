import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Tarjetas del spec: `default` 12px con sombra corta, `interactive` 16px
 * que marca el borde en teal al pasar el puntero (tarjetas de catálogo).
 */
const cardVariants = cva("ts-card", {
  variants: {
    variant: {
      default: "rounded-lg shadow-[var(--ts-shadow-card)]",
      interactive:
        "ts-card-hover rounded-2xl p-4 cursor-pointer hover:-translate-y-0.5",
      flat: "rounded-lg shadow-none",
    },
    padding: {
      none: "",
      sm: "p-3",
      md: "p-4",
      lg: "p-6",
    },
  },
  defaultVariants: { variant: "default", padding: "md" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, padding, className }))}
      {...props}
    />
  )
);
Card.displayName = "Card";

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("ts-subtitle", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ts-body text-muted-foreground", className)} {...props} />;
}

export { Card, cardVariants };
