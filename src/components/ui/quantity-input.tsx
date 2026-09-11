"use client";

type QuantityInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
};

export function QuantityInput({
  value,
  onChange,
  min = 0,
  max = 9999,
  disabled,
}: QuantityInputProps) {
  return (
    <div className="flex items-center gap-1 min-w-0 w-full">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        className="h-8 w-8 shrink-0 rounded-md border border-border bg-background text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
      >
        -
      </button>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        disabled={disabled}
        className="h-8 w-14 max-w-full flex-1 min-w-0 rounded-md border border-border bg-background text-center text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        className="h-8 w-8 shrink-0 rounded-md border border-border bg-background text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
      >
        +
      </button>
    </div>
  );
}
