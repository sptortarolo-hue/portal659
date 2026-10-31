import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Input del spec: 8px de radio, borde slate, fondo del panel. Con `icon`
 * el ícono va a la izquierda y el texto se corre (buscador del spec).
 * OJO con el choque de tipos que tenía el borrador: la variante de cva se
 * llama `inputSize` y NO `size`, porque `InputHTMLAttributes.size` es number.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  /** Envolver en el contenedor relativo (para ícono absoluto). */
  wrapClassName?: string;
}

const base =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, wrapClassName, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        className={cn(base, icon && "pl-10", className)}
        {...props}
      />
    );
    if (!icon) return input;
    return (
      <div className={cn("relative", wrapClassName)}>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        {input}
      </div>
    );
  }
);
Input.displayName = "Input";

/** Buscador del spec (ícono lupa a la izquierda, fondo gris claro). */
export function SearchInput({
  className,
  containerClassName,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }) {
  return (
    <div className={cn("ts-search", containerClassName)}>
      <Search className="h-4 w-4 shrink-0" />
      <input
        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        {...props}
      />
    </div>
  );
}

export { Input };
