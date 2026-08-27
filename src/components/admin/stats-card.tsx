import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color?: string;
  change?: string;
}

export default function StatsCard({ label, value, icon: Icon, color = "text-primary", change }: StatsCardProps) {
  return (
    <div className="border border-border rounded-xl p-4 bg-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {change && <p className="text-xs text-muted-foreground mt-1">{change}</p>}
    </div>
  );
}
