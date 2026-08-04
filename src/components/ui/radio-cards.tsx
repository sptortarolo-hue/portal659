"use client";

export function RadioCards({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string; icon: string; desc?: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-center transition-colors ${
              active
                ? "border-primary bg-primary/5 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/30"
            }`}
          >
            <span className="text-xl">{opt.icon}</span>
            <span className="text-xs font-medium leading-tight">{opt.label}</span>
            {opt.desc && (
              <span className="text-[10px] text-muted-foreground leading-tight">
                {opt.desc}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
