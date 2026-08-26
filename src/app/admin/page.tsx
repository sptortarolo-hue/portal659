"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AdminGuard from "@/components/admin/admin-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Vendor as DBVendor, Order as DBOrder, Review as DBReview } from "@/types/database";

type VendorData = DBVendor & { is_admin?: boolean };
type OrderData = DBOrder & { vendors?: { store_name: string } | null };
type ReviewData = DBReview & { vendors?: { store_name: string } | null };

type UserData = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  full_name: string;
  whatsapp: string;
  role: string;
  vertical: string;
  email_confirmed: boolean;
  last_sign_in: string | null;
  created_at: string;
};

type AdminStats = {
  totalVendors: number;
  totalOrders: number;
  totalProducts: number;
  totalReviews: number;
  totalRevenue: number;
  avgRating: number | null;
};

type Tab = "overview" | "vendors" | "orders" | "reviews" | "users";

const VERTICAL_COLORS: Record<string, string> = {
  gastronomia: "bg-orange-100 text-orange-700",
  comercio: "bg-emerald-100 text-emerald-700",
  servicio: "bg-sky-100 text-sky-700",
  moda: "bg-violet-100 text-violet-700",
  salud: "bg-pink-100 text-pink-700",
  varios: "bg-amber-100 text-amber-700",
  mascotas: "bg-teal-100 text-teal-700",
};

const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  new: { label: "Nuevo", color: "bg-blue-100 text-blue-700" },
  confirmed: { label: "Confirmado", color: "bg-amber-100 text-amber-700" },
  preparing: { label: "Preparando", color: "bg-orange-100 text-orange-700" },
  ready: { label: "Listo", color: "bg-purple-100 text-purple-700" },
  sent: { label: "Enviado", color: "bg-cyan-100 text-cyan-700" },
  completed: { label: "Entregado", color: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelado", color: "bg-red-100 text-red-700" },
};

const ROLE_LABELS: Record<string, string> = {
  vendor: "Vendedor",
  buyer: "Comprador",
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [vendorData, setVendorData] = useState<{ vendors: VendorData[]; orders: OrderData[]; reviews: ReviewData[]; stats: AdminStats } | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [userForm, setUserForm] = useState({ email: "", password: "", firstName: "", lastName: "", whatsapp: "", role: "vendor", vertical: "gastronomia" });

  const fetchVendorData = useCallback(async () => {
    try {
      const r = await fetch("/api/admin");
      const d = await r.json();
      if (d.error) setError(d.error);
      else setVendorData(d);
    } catch {
      setError("Error al cargar datos");
    }
  }, []);

  const fetchUsers = useCallback(async (q = "") => {
    try {
      const params = new URLSearchParams({ per_page: "100" });
      if (q) params.set("search", q);
      const r = await fetch(`/api/admin/users?${params}`);
      const d = await r.json();
      if (d.error) setError(d.error);
      else {
        setUsers(d.users);
        setUsersTotal(d.total);
      }
    } catch {
      setError("Error al cargar usuarios");
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchVendorData(), fetchUsers()]).then(() => setLoading(false));
  }, [fetchVendorData, fetchUsers]);

  useEffect(() => {
    if (tab === "users") fetchUsers(search);
  }, [tab, search, fetchUsers]);

  async function handleVendorAction(vendorId: string, action: string) {
    await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, action }),
    });
    fetchVendorData();
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userForm),
    });
    const d = await res.json();
    if (d.error) {
      setError(d.error);
    } else {
      setShowUserForm(false);
      setUserForm({ email: "", password: "", firstName: "", lastName: "", whatsapp: "", role: "vendor", vertical: "gastronomia" });
      fetchUsers(search);
    }
  }

  async function handleUpdateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: editingUser.id,
        firstName: userForm.firstName,
        lastName: userForm.lastName,
        whatsapp: userForm.whatsapp,
        role: userForm.role,
        vertical: userForm.vertical,
      }),
    });
    const d = await res.json();
    if (d.error) {
      setError(d.error);
    } else {
      setEditingUser(null);
      setUserForm({ email: "", password: "", firstName: "", lastName: "", whatsapp: "", role: "vendor", vertical: "gastronomia" });
      fetchUsers(search);
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm("¿Eliminar este usuario? Esta acción no se puede deshacer.")) return;
    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const d = await res.json();
    if (d.error) setError(d.error);
    else fetchUsers(search);
  }

  function openEditUser(u: UserData) {
    setEditingUser(u);
    setUserForm({
      email: u.email,
      password: "",
      firstName: u.firstName,
      lastName: u.lastName,
      whatsapp: u.whatsapp,
      role: u.role,
      vertical: u.vertical,
    });
    setShowUserForm(true);
  }

  function openNewUser() {
    setEditingUser(null);
    setUserForm({ email: "", password: "", firstName: "", lastName: "", whatsapp: "", role: "vendor", vertical: "gastronomia" });
    setShowUserForm(true);
  }

  if (loading) return <main className="container mx-auto px-4 py-8 max-w-6xl"><p className="text-muted-foreground animate-pulse">Cargando panel admin...</p></main>;

  const { vendors = [], orders = [], reviews = [], stats } = vendorData || {};

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Resumen" },
    { id: "vendors", label: "Comercios", count: vendors.length },
    { id: "users", label: "Usuarios", count: usersTotal },
    { id: "orders", label: "Pedidos", count: orders.length },
    { id: "reviews", label: "Reseñas", count: reviews.length },
  ];

  const filteredVendors = vendors.filter((v) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return v.store_name?.toLowerCase().includes(q) || v.slug?.toLowerCase().includes(q) || v.neighborhood?.toLowerCase().includes(q);
  });

  const filteredOrders = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return o.customer_name?.toLowerCase().includes(q) || o.vendors?.store_name?.toLowerCase().includes(q);
  });

  const filteredReviews = reviews.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.customer_name?.toLowerCase().includes(q) || r.vendors?.store_name?.toLowerCase().includes(q) || r.comment?.toLowerCase().includes(q);
  });

  return (
    <AdminGuard>
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl font-semibold">Panel Admin</h1>
        {tab === "users" && (
          <Button onClick={openNewUser} size="sm">+ Nuevo usuario</Button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      <nav className="flex gap-1 mb-6 border-b border-border pb-0 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearch(""); }}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t.label}{t.count !== undefined ? ` (${t.count})` : ""}
          </button>
        ))}
      </nav>

      {(tab === "vendors" || tab === "orders" || tab === "reviews" || tab === "users") && (
        <div className="mb-4">
          <Input
            placeholder={`Buscar ${tab === "vendors" ? "comercio" : tab === "users" ? "usuario" : tab === "orders" ? "pedido" : "reseña"}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </div>
      )}

      {tab === "overview" && stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: "Comercios", value: stats.totalVendors, color: "text-primary" },
            { label: "Usuarios", value: usersTotal, color: "text-indigo-600" },
            { label: "Pedidos", value: stats.totalOrders, color: "text-blue-600" },
            { label: "Productos", value: stats.totalProducts, color: "text-emerald-600" },
            { label: "Reseñas", value: stats.totalReviews, color: "text-amber-600" },
            { label: "Facturación", value: `$${stats.totalRevenue.toLocaleString("es-AR")}`, color: "text-green-600" },
          ].map((s) => (
            <div key={s.label} className="border border-border rounded-xl p-4 bg-card text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "vendors" && (
        <div className="space-y-3">
          {filteredVendors.length === 0 && <p className="text-muted-foreground text-center py-8">No hay comercios.</p>}
          {filteredVendors.map((v) => (
            <div key={v.id} className="border border-border rounded-xl p-4 bg-card flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {v.logo_url ? (
                  <img src={v.logo_url} alt="" className="h-10 w-10 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-primary/60 text-sm">{v.store_name?.charAt(0)}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/tienda/${v.slug}`} className="font-medium text-sm hover:underline truncate">{v.store_name}</Link>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${VERTICAL_COLORS[v.vertical] || "bg-muted text-muted-foreground"}`}>
                      {v.vertical}
                    </span>
                    {v.verified && <span className="text-[10px] text-blue-600">&#10003; Verificado</span>}
                    {v.is_admin && <span className="text-[10px] text-amber-600">Admin</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{v.slug} &middot; {v.neighborhood || "Sin barrio"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleVendorAction(v.id, "toggle_verified")}
                  className={`text-xs px-2.5 py-1 rounded-md border ${v.verified ? "border-blue-300 bg-blue-50 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  {v.verified ? "Verificado" : "Verificar"}
                </button>
                <button
                  onClick={() => handleVendorAction(v.id, "toggle_admin")}
                  className={`text-xs px-2.5 py-1 rounded-md border ${v.is_admin ? "border-amber-300 bg-amber-50 text-amber-700" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  {v.is_admin ? "Admin" : "Hacer admin"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-3">
          {users.length === 0 && <p className="text-muted-foreground text-center py-8">No hay usuarios.</p>}
          {users.map((u) => (
            <div key={u.id} className="border border-border rounded-xl p-4 bg-card">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-primary/60 text-sm">{u.firstName?.charAt(0) || u.email?.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{u.firstName} {u.lastName}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${u.role === "vendor" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                      {u.email_confirmed ? (
                        <span className="text-[10px] text-green-600">&#10003; Verificado</span>
                      ) : (
                        <span className="text-[10px] text-red-600">Sin verificar</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email} &middot; {u.whatsapp || "Sin WhatsApp"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openEditUser(u)}
                    className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDeleteUser(u.id)}
                    className="text-xs px-2.5 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "orders" && (
        <div className="space-y-3">
          {filteredOrders.length === 0 && <p className="text-muted-foreground text-center py-8">No hay pedidos.</p>}
          {filteredOrders.map((o) => {
            const st = ORDER_STATUS[o.status] || ORDER_STATUS.new;
            return (
              <div key={o.id} className="border border-border rounded-xl p-4 bg-card">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-sm">{o.vendors?.store_name || "Local"}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {new Date(o.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                    <span className="font-bold text-sm">${Number(o.total).toLocaleString("es-AR")}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {(o.items || []).map((i: { name: string; price: number; qty: number }, idx: number) => (
                    <span key={idx}>{i.qty}x {i.name}{idx < o.items.length - 1 ? " · " : ""}</span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{o.customer_name} &middot; {o.customer_phone}</p>
              </div>
            );
          })}
        </div>
      )}

      {tab === "reviews" && (
        <div className="space-y-3">
          {filteredReviews.length === 0 && <p className="text-muted-foreground text-center py-8">No hay reseñas.</p>}
          {filteredReviews.map((r) => (
            <div key={r.id} className="border border-border rounded-xl p-4 bg-card">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                <span className="font-medium text-sm">{r.customer_name}</span>
                <span className="text-xs text-muted-foreground">en {r.vendors?.store_name}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(r.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                </span>
              </div>
              {r.comment && <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>}
            </div>
          ))}
        </div>
      )}

      {showUserForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowUserForm(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl font-semibold mb-4">
              {editingUser ? "Editar usuario" : "Nuevo usuario"}
            </h2>
            <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="uf-first">Nombre</Label>
                  <Input id="uf-first" value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} required />
                </div>
                <div>
                  <Label htmlFor="uf-last">Apellido</Label>
                  <Input id="uf-last" value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} required />
                </div>
              </div>
              {!editingUser && (
                <>
                  <div>
                    <Label htmlFor="uf-email">Email</Label>
                    <Input id="uf-email" type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
                  </div>
                  <div>
                    <Label htmlFor="uf-pass">Contraseña</Label>
                    <Input id="uf-pass" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} required minLength={6} />
                  </div>
                </>
              )}
              <div>
                <Label htmlFor="uf-wa">WhatsApp</Label>
                <Input id="uf-wa" type="tel" value={userForm.whatsapp} onChange={(e) => setUserForm({ ...userForm, whatsapp: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="uf-role">Rol</Label>
                  <select
                    id="uf-role"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                  >
                    <option value="vendor">Vendedor</option>
                    <option value="buyer">Comprador</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="uf-vert">Vertical</Label>
                  <select
                    id="uf-vert"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={userForm.vertical}
                    onChange={(e) => setUserForm({ ...userForm, vertical: e.target.value })}
                  >
                    <option value="gastronomia">Gastronomía</option>
                    <option value="comercio">Comercio</option>
                    <option value="servicio">Servicio</option>
                    <option value="moda">Moda</option>
                    <option value="salud">Salud</option>
                    <option value="varios">Varios</option>
                    <option value="mascotas">Mascotas</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowUserForm(false)}>Cancelar</Button>
                <Button type="submit" className="flex-1">{editingUser ? "Guardar" : "Crear"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
    </AdminGuard>
  );
}
