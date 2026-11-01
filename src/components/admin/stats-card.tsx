import { LucideIcon } from "lucide-react";
import { KpiCard, type PanelTone } from "@/components/panel-ui";

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Tono del panel (paleta semántica): primary, info, success, warning… */
  accent?: PanelTone;
  change?: string;
}

/**
 * KPI del admin: es el KpiCard del kit del panel (número grande + ícono
 * en círculo con el color de su estado). Antes era una tarjeta propia con
 * un color de texto por métrica; ahora todas comparten la paleta.
 */
export default function StatsCard({
  label,
  value,
  icon: Icon,
  accent = "primary",
  change,
}: StatsCardProps) {
  return <KpiCard label={label} value={value} sub={change} icon={Icon} accent={accent} />;
}
