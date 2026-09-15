"use client";

import { useEffect, useState, useCallback } from "react";
import DataTable, { Column } from "@/components/admin/data-table";
import DeleteConfirmModal from "@/components/admin/delete-confirm-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2 } from "lucide-react";

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

const ROLE_LABELS: Record<string, string> = { vendor: "Vendedor", buyer: "Comprador" };

export default function AdminUsuariosPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserData | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserData | null>(null);
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "", whatsapp: "", role: "vendor", vertical: "gastronomia" });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users?per_page=200");
      const data = await res.json();
      if (!data.error) {
        setUsers(data.users);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function openNew() {
    setEditing(null);
    setForm({ email: "", password: "", firstName: "", lastName: "", whatsapp: "", role: "vendor", vertical: "gastronomia" });
    setShowForm(true);
  }

  function openEdit(u: UserData) {
    setEditing(u);
    setForm({ email: u.email, password: "", firstName: u.firstName, lastName: u.lastName, whatsapp: u.whatsapp, role: u.role, vertical: u.vertical });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: editing.id, firstName: form.firstName, lastName: form.lastName, whatsapp: form.whatsapp, role: form.role, vertical: form.vertical }),
      });
    } else {
      await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }
    setShowForm(false);
    fetchUsers();
  }

  async function handleDelete() {
    if (!deleteUser) return;
    await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: deleteUser.id }),
    });
    setDeleteUser(null);
    fetchUsers();
  }

  const columns: Column<UserData>[] = [
    {
      key: "firstName",
      label: "Usuario",
      sortable: true,
      render: (u) => (
        <div>
          <p className="font-medium text-sm">{u.firstName} {u.lastName}</p>
          <p className="text-xs text-muted-foreground">{u.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      label: "Rol",
      sortable: true,
      render: (u) => (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${u.role === "vendor" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
          {ROLE_LABELS[u.role] || u.role}
        </span>
      ),
    },
    {
      key: "vertical",
      label: "Vertical",
      render: (u) => <span className="text-sm capitalize">{u.vertical || "-"}</span>,
    },
    {
      key: "email_confirmed",
      label: "Email",
      render: (u) => (
        <span className={`text-[10px] ${u.email_confirmed ? "text-green-600" : "text-red-600"}`}>
          {u.email_confirmed ? "Verificado" : "Sin verificar"}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "Registro",
      sortable: true,
      render: (u) => <span className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString("es-AR")}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Usuarios</h1>
        <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-1" /> Nuevo usuario</Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={users}
          searchPlaceholder="Buscar usuario..."
          searchKeys={["firstName", "lastName", "email"]}
          pageSize={15}
          emptyMessage="No hay usuarios"
          actions={(u) => (
            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => openEdit(u)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button onClick={() => setDeleteUser(u)} className="p-1.5 rounded-md hover:bg-red-50 transition-colors">
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </button>
            </div>
          )}
        />
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl font-semibold mb-4">{editing ? "Editar usuario" : "Nuevo usuario"}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Nombre</Label>
                  <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
                </div>
                <div>
                  <Label>Apellido</Label>
                  <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
                </div>
              </div>
              {!editing && (
                <>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Contraseña</Label>
                    <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
                  </div>
                </>
              )}
              <div>
                <Label>WhatsApp</Label>
                <Input type="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Rol</Label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    <option value="vendor">Vendedor</option>
                    <option value="buyer">Comprador</option>
                  </select>
                </div>
                <div>
                  <Label>Vertical</Label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })}>
                    <option value="gastronomia">Gastronomía</option>
                    <option value="comercio">Comercio</option>
                    <option value="servicio">Servicio</option>
                    <option value="moda">Moda</option>
                    <option value="salud">Salud</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
                <Button type="submit" className="flex-1">{editing ? "Guardar" : "Crear"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        open={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
        title="Eliminar usuario"
        message={`¿Eliminar a "${deleteUser?.firstName} ${deleteUser?.lastName}"? Esta acción no se puede deshacer.`}
      />
    </div>
  );
}
