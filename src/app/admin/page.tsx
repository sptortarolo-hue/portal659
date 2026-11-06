"use client";

import { useEffect, useState, useCallback } from "react";
import StatsCard from "@/components/admin/stats-card";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/panel-ui";
import { Store, Users, ShoppingCart, Package, Star, DollarSign, ShieldCheck, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { VERTICALS } from "@/lib/config";

type AdminStats = {
  totalVendors: number;
  totalOrders: number;
  totalProducts: number;
  totalReviews: number;
  totalRevenue: number;
  avgRating: number | null;
  totalUsers: number;
  ordersByDay: Array<{ date: string; pedidos: number }>;
  ordersByVertical: Array<{ vertical: string; pedidos: number }>;
};

type Order = {
  id: string;
  created_at: string;
  total: number;
  status: string;
  vendor_id: string;
  store_name?: string;
};

type MonitorLite = {
  ready: boolean;
  status?: {
    up: boolean;
    http: number;
    fails: number;
    disk_pct: number;
    telegram_configured?: boolean;
    ts_unix?: number;
  };
};

const VERTICAL_COLORS: Record<string, string> = {
  gastronomia: "#ff6b4a",
  comercio: "#10b981",
  servicio: "#0ea5e9",
  moda: "#8b5cf6",
  salud: "#ec4899",
  estetica: "#f472b6",
  taller: "#f97316",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: "Nuevo",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  sent: "Enviado",
  completed: "Entregado",
  cancelled: "Cancelado",
};

/** Fetch con timeout: un endpoint colgado no puede congelar el panel. */
async function fetchJson(url: string, ms = 8000): Promise<any | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [monitor, setMonitor] = useState<MonitorLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  /** Link de captación: landing pública /comercios (para compartir con comercios). */
  const comerciosUrl = "/comercios";

  async function copyComerciosLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${comerciosUrl}`);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch { /* noop */ }
  }

  const fetchData = useCallback(async () => {
    setError(false);
    try {
      const [adminData, usersData, monitorData] = await Promise.all([
        fetchJson("/api/admin"),
        fetchJson("/api/admin/users?per_page=1"),
        // Semáforo del VPS: si falla, el dashboard no fragata, sólo queda sin pill.
        fetchJson("/api/admin/monitor?lite=1"),
      ]);

      if (monitorData) setMonitor(monitorData);
      if (adminData && !adminData.error) {
        setStats({
          ...adminData.stats,
          totalUsers: usersData?.total || 0,
        });
        setOrders(adminData.orders || []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ordersByDay = stats?.ordersByDay ?? [];
  const ordersByVertical = (stats?.ordersByVertical ?? []).map((d) => ({
    name: VERTICALS.find((v) => v.slug === d.vertical)?.name || d.vertical,
    value: d.pedidos,
  }));

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-72 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const totalUsers = stats?.totalUsers || 0;

  if (error && !stats) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
        <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-center space-y-3">
          <p className="font-semibold text-red-700">No se pudieron cargar los datos</p>
          <p className="text-sm text-muted-foreground">
            El servidor no respondió. Revisá la conexión o reintentá.
          </p>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="rounded-xl bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90 transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold">Dashboard</h1>

      {/* Semáforo del VPS: el estado del sitio a la vista, sin entrar al panel de monitor. */}
      {monitor?.ready && monitor.status && (
        <a
          href="/admin/monitor"
          className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors ${
            monitor.status.up
              ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
              : "border-red-300 bg-red-50 hover:bg-red-100"
          }`}
        >
          <span
            className={`inline-flex h-7 w-7 rounded-full items-center justify-center flex-shrink-0 text-white ${
              monitor.status.up ? "bg-emerald-500" : "bg-red-500"
            }`}
          >
            {monitor.status.up ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${monitor.status.up ? "text-emerald-800" : "text-red-800"}`}>
              {monitor.status.up ? "Sitio arriba" : `Sitio sin responder (HTTP ${monitor.status.http})`}
            </p>
            <p className="text-xs text-muted-foreground">
              Disco {monitor.status.disk_pct}% · {monitor.status.fails} fallo(s) seguidos
              {monitor.status.telegram_configured === false ? " · alertas sin configurar" : ""}
            </p>
          </div>
          <span className="text-xs text-muted-foreground flex-shrink-0 hidden sm:inline">Ver monitor ›</span>
        </a>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatsCard label="Comercios" value={stats?.totalVendors || 0} icon={Store} accent="primary" />
        <StatsCard label="Usuarios" value={totalUsers} icon={Users} accent="info" />
        <StatsCard label="Pedidos" value={stats?.totalOrders || 0} icon={ShoppingCart} accent="neutral" />
        <StatsCard label="Productos" value={stats?.totalProducts || 0} icon={Package} accent="success" />
        <StatsCard label="Reseñas" value={stats?.totalReviews || 0} icon={Star} accent="warning" />
        <StatsCard
          label="Facturación"
          value={`$${(stats?.totalRevenue || 0).toLocaleString("es-AR")}`}
          icon={DollarSign}
          accent="primary"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <SectionHeader title="Pedidos últimos 30 días" />
          <CardContent className="mt-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={ordersByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="pedidos" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <SectionHeader title="Pedidos por vertical" />
          <CardContent className="mt-4">
            {ordersByVertical.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={ordersByVertical}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {ordersByVertical.map((entry) => {
                      const v = VERTICALS.find((v2) => v2.name === entry.name);
                      return <Cell key={entry.name} fill={v?.hex || "var(--color-chart-1)"} />;
                    })}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={ShoppingCart}
                title="Sin datos de pedidos"
                hint="Cuando los comercios empiecen a recibir pedidos, el reparto por vertical aparece acá."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <SectionHeader title="Pedidos recientes" />
        <CardContent className="mt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Comercio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.slice(0, 10).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs">
                      {new Date(o.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell>{o.store_name || "-"}</TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                        {ORDER_STATUS_LABELS[o.status] || o.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      ${Number(o.total).toLocaleString("es-AR")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="ts-subtitle">📣 Difundir Portal 659</p>
            <p className="ts-body text-muted-foreground mt-0.5">
              Mandá este link a comercios que quieras sumar: explica beneficios, planes y lleva al registro.
            </p>
            <p className="ts-body mt-1 font-mono truncate">
              portal659.com.ar{comerciosUrl}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button asChild variant="secondary" size="sm">
              <a href={comerciosUrl} target="_blank" rel="noopener noreferrer">
                Ver página
              </a>
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={copyComerciosLink}>
              {shareCopied ? "¡Copiado!" : "Copiar link"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const url = `${window.location.origin}${comerciosUrl}`;
                const text = `Mirá Portal 659, el centro comercial de tu barrio 🏘️ Tu comercio online con carta y QR, pedidos por WhatsApp y 0% de comisión: ${url}`;
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
              }}
              className="bg-green-500 text-white hover:bg-green-600"
            >
              💬 Por WhatsApp
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
