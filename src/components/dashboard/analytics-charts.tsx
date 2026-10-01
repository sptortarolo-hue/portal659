"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export const fmtARS = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const fmtInt = (n: number) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const compactARS = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`);

const PRIMARY = "var(--color-primary)";
const BORDER = "var(--color-border)";
const MUTED = "var(--color-muted-foreground)";
const CARD = "var(--color-card)";
const PALETTE = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899", "#64748b"];

const tooltipStyle = {
  backgroundColor: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  fontSize: 12,
} as const;

export type DayPoint = { date: string; count: number; revenue: number };
export type EvoPoint = { label: string; pedidos: number; ventas: number };
export type Slice = { label: string; count: number; revenue: number };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Agrupa la serie diaria según el rango (estilo Fudo/Tiendanube): 7/30d por
 *  día, 90d por semana (lun-dom), 365d por mes. Entrada ordenada ascendente. */
export function bucketizeDaily(days: DayPoint[], range: number): EvoPoint[] {
  if (!days || days.length === 0) return [];
  if (range <= 31) {
    return days.map((d) => ({
      label: `${d.date.slice(8)}/${d.date.slice(5, 7)}`,
      pedidos: d.count,
      ventas: Math.round(d.revenue),
    }));
  }
  if (range <= 120) {
    const weeks = new Map<string, EvoPoint>();
    for (const d of days) {
      const dt = new Date(Number(d.date.slice(0, 4)), Number(d.date.slice(5, 7)) - 1, Number(d.date.slice(8, 10)));
      const monday = new Date(dt);
      monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
      const key = `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
      const cur = weeks.get(key) || {
        label: `sem ${String(monday.getDate()).padStart(2, "0")}/${String(monday.getMonth() + 1).padStart(2, "0")}`,
        pedidos: 0,
        ventas: 0,
      };
      cur.pedidos += d.count;
      cur.ventas += Math.round(d.revenue);
      weeks.set(key, cur);
    }
    return [...weeks.values()];
  }
  const months = new Map<string, EvoPoint>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    const cur = months.get(key) || {
      label: `${MESES[Number(d.date.slice(5, 7)) - 1]} ${d.date.slice(2, 4)}`,
      pedidos: 0,
      ventas: 0,
    };
    cur.pedidos += d.count;
    cur.ventas += Math.round(d.revenue);
    months.set(key, cur);
  }
  return [...months.values()];
}

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-xl p-4 bg-card min-w-0">
      <h3 className="font-medium text-sm">{title}</h3>
      {sub ? <p className="text-xs text-muted-foreground mt-0.5 mb-3">{sub}</p> : <div className="mb-3" />}
      {children}
    </div>
  );
}

/** Evolución de ventas ($) + pedidos (barras) con doble eje. */
export function SalesEvolution({ data, range, periodLabel }: { data: DayPoint[]; range: number; periodLabel: string }) {
  const points = bucketizeDaily(data, range);
  if (!points.some((p) => p.pedidos > 0)) return null;
  return (
    <ChartCard title={`Evolución de ventas ${periodLabel}`} sub="Barras = pedidos · línea = facturación">
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: BORDER }}
              minTickGap={28}
            />
            <YAxis
              yAxisId="left"
              tickFormatter={compactARS}
              tick={{ fill: MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={30}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: any, name: any) =>
                name === "Ventas" ? [fmtARS(Number(value)), name] : [fmtInt(Number(value)), name]
              }
            />
            <Bar yAxisId="right" dataKey="pedidos" name="Pedidos" fill={PRIMARY} opacity={0.3} radius={[4, 4, 0, 0]} />
            <Line yAxisId="left" type="monotone" dataKey="ventas" name="Ventas" stroke={PRIMARY} strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Ventas por hora (0-23): barras de facturación con tooltip de pedidos. */
export function HourlyChart({ hourly }: { hourly: { hour: string; count: number; revenue: number }[] }) {
  if (!hourly || !hourly.some((h) => h.count > 0)) return null;
  const max = Math.max(...hourly.map((h) => h.revenue), 1);
  const rows = hourly.map((h) => ({ ...h, short: `${h.hour}h` }));
  return (
    <ChartCard title="Ventas por hora" sub="Facturación por hora del día en el período">
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
            <XAxis dataKey="short" tick={{ fill: MUTED, fontSize: 11 }} tickLine={false} axisLine={{ stroke: BORDER }} interval={3} />
            <YAxis
              tickFormatter={compactARS}
              tick={{ fill: MUTED, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(l) => `Hora ${l}`}
              formatter={(value: any, _name: any, item: any) => [
                `${item?.payload?.count ?? 0} pedidos · ${fmtARS(Number(value))}`,
                "Ventas",
              ]}
            />
            <Bar dataKey="revenue" name="Ventas" radius={[4, 4, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.hour} fill={r.revenue >= max ? "#10b981" : PRIMARY} opacity={r.revenue >= max ? 1 : 0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Dona con % de participación (estilo Fudo) + leyenda con valores. */
export function ShareDonut({ title, sub, entries }: { title: string; sub?: string; entries: Slice[] }) {
  const total = entries.reduce((s, e) => s + e.revenue, 0);
  if (!entries.length || total <= 0) return null;
  const rows = entries.map((e, i) => ({
    ...e,
    fill: PALETTE[i % PALETTE.length],
    pct: Math.round((e.revenue / total) * 100),
  }));
  return (
    <ChartCard title={title} sub={sub}>
      <div className="relative mx-auto" style={{ height: 190, maxWidth: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="revenue" nameKey="label" innerRadius="64%" outerRadius="88%" paddingAngle={2} strokeWidth={0}>
              {rows.map((r) => (
                <Cell key={r.label} fill={r.fill} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtARS(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-bold tabular-nums">{fmtARS(total)}</span>
          <span className="text-[10px] text-muted-foreground">total</span>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.fill }} />
            <span className="text-muted-foreground truncate flex-1">{r.label}</span>
            <span className="font-semibold tabular-nums text-xs">{r.pct}%</span>
            <span className="font-medium tabular-nums text-xs w-24 text-right">{fmtARS(r.revenue)}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
