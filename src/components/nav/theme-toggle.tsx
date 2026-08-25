"use client";

import { useTheme } from "@/components/ui/theme-provider";

export function ThemeToggle() {
  const { theme, setTheme, resolved } = useTheme();

  const options: { value: typeof theme; icon: string; label: string }[] = [
    { value: "light", icon: "☀️", label: "Claro" },
    { value: "dark", icon: "🌙", label: "Oscuro" },
    { value: "system", icon: "💻", label: "Sistema" },
  ];

  const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const nextOption = options.find((o) => o.value === nextTheme)!;

  return (
    <button
      onClick={() => setTheme(nextTheme)}
      className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-primary/10 transition-colors text-lg"
      title={`Cambiar a ${nextOption.label}`}
    >
      {resolved === "dark" ? "🌙" : "☀️"}
    </button>
  );
}
