"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  MAX_BANK_ACCOUNTS,
  bankAccountLabel,
  type VendorBankAccount,
} from "@/lib/bank-accounts";

type FormState = { label: string; alias: string; cbu: string; holder: string };

const blankForm: FormState = { label: "", alias: "", cbu: "", holder: "" };

function formFromAccount(a: VendorBankAccount): FormState {
  return { label: a.label || "", alias: a.alias || "", cbu: a.cbu || "", holder: a.holder || "" };
}

/**
 * ABM de cuentas para transferencias (Config → medios de cobro, todos los
 * verticales). Hasta 3 activas, una principal. La baja es LÓGICA: los
 * cobros históricos siguen desglosando por esa cuenta en los informes.
 * Tolerante a migración sin aplicar: avisa y deja de ofrecer el ABM (el
 * sistema sigue con la cuenta única de siempre).
 */
export function BankAccountsManager() {
  const [accounts, setAccounts] = useState<VendorBankAccount[] | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VendorBankAccount | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/bank-accounts");
      const data = await res.json().catch(() => ({}));
      if (data?.migration || data?.code === "migration_pending") {
        setMigrationPending(true);
        setAccounts([]);
        return;
      }
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
    } catch {
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeCount = (accounts || []).filter((a) => a.active).length;

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm);
    setErr(null);
    setFormOpen(true);
  };
  const openEdit = (a: VendorBankAccount) => {
    setEditing(a);
    setForm(formFromAccount(a));
    setErr(null);
    setFormOpen(true);
  };

  async function saveForm() {
    setErr(null);
    const payload = {
      label: form.label.trim(),
      alias: form.alias.trim() || undefined,
      cbu: form.cbu.trim() || undefined,
      holder: form.holder.trim() || undefined,
    };
    setBusy("form");
    try {
      const res = await fetch(editing ? `/api/vendor/bank-accounts/${editing.id}` : "/api/vendor/bank-accounts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || "No se pudo guardar");
        return;
      }
      setFormOpen(false);
      await load();
    } catch {
      setErr("Error de red");
    } finally {
      setBusy(null);
    }
  }

  async function setDefault(a: VendorBankAccount) {
    setBusy(a.id);
    setErr(null);
    try {
      const res = await fetch(`/api/vendor/bank-accounts/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_default" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data?.error || "No se pudo marcar");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(a: VendorBankAccount) {
    setBusy(a.id);
    setErr(null);
    try {
      if (a.active) {
        if (typeof window !== "undefined" && !window.confirm(`¿Desactivar "${bankAccountLabel(a)}"? Los cobros ya registrados siguen apareciendo en los informes.`)) {
          setBusy(null);
          return;
        }
        const res = await fetch(`/api/vendor/bank-accounts/${a.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setErr(data?.error || "No se pudo desactivar");
      } else {
        const res = await fetch(`/api/vendor/bank-accounts/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setErr(data?.error || "No se pudo reactivar");
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (accounts === null) {
    return <p className="text-xs text-muted-foreground">Cargando cuentas…</p>;
  }

  if (migrationPending) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        ⚠️ Para usar varias cuentas falta aplicar la migración <code>migrate-bank-accounts.sql</code> en la base.
        Mientras tanto se usa la cuenta única de siempre.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {accounts.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Todavía no cargaste ninguna cuenta. Con una sola alcanza; con 2 o 3 podés elegir a cuál
          entra cada transferencia y ver el desglose en Caja y Estadísticas.
        </p>
      )}

      {accounts.map((a) => (
        <div
          key={a.id}
          className={`rounded-xl border p-2.5 space-y-1 ${
            a.active ? "border-border" : "border-dashed border-border opacity-60"
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold min-w-0 break-words">🏦 {bankAccountLabel(a)}</span>
            {a.is_default && a.active && (
              <span className="rounded-full bg-sun px-2 py-0.5 text-[10px] font-bold text-ink">Principal</span>
            )}
            {!a.active && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">Inactiva</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground break-all">
            {[a.alias && `Alias: ${a.alias}`, a.cbu && `CBU: ${a.cbu}`, a.holder && `Titular: ${a.holder}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            {a.active && !a.is_default && (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy === a.id} onClick={() => setDefault(a)}>
                ⭐ Marcar principal
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy === a.id} onClick={() => openEdit(a)}>
              ✏️ Editar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy === a.id} onClick={() => toggleActive(a)}>
              {a.active ? "Desactivar" : "Reactivar"}
            </Button>
          </div>
        </div>
      ))}

      <div className="pt-1">
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={activeCount >= MAX_BANK_ACCOUNTS} onClick={openCreate}>
          ＋ Sumar cuenta
        </Button>
        {activeCount >= MAX_BANK_ACCOUNTS && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Máximo {MAX_BANK_ACCOUNTS} cuentas activas. Desactivá una para cargar otra.
          </p>
        )}
      </div>

      {err && <p className="text-xs text-red-600">{err}</p>}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Editar cuenta" : "Nueva cuenta"}
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setFormOpen(false)} disabled={busy === "form"}>
              Cancelar
            </Button>
            <Button size="sm" className="flex-1" onClick={saveForm} disabled={busy === "form"}>
              {busy === "form" ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <Label>Nombre de la cuenta</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Corto y reconocible: es lo que ves al cobrar y en los informes.
            </p>
            <Input
              className="mt-1"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Ej: MP personal, Banco Nación, Cuenta del local"
              maxLength={40}
            />
          </div>
          <div>
            <Label>Alias</Label>
            <Input
              className="mt-1"
              value={form.alias}
              onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
              placeholder="Ej: super.mi.barrio"
              maxLength={60}
            />
          </div>
          <div>
            <Label>CBU / CVU</Label>
            <Input
              className="mt-1"
              value={form.cbu}
              onChange={(e) => setForm((f) => ({ ...f, cbu: e.target.value.replace(/[^\d]/g, "") }))}
              placeholder="0000000000000000000000"
              inputMode="numeric"
              maxLength={22}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Alias y/o CBU: con uno alcanza.</p>
          </div>
          <div>
            <Label>Titular</Label>
            <Input
              className="mt-1"
              value={form.holder}
              onChange={(e) => setForm((f) => ({ ...f, holder: e.target.value }))}
              placeholder="Nombre y apellido o razón social"
              maxLength={80}
            />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
