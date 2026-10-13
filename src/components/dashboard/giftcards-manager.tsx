"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

type Giftcard = {
  id: string;
  code: string;
  amount: number | null;
  balance: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
};

type Denomination = { id: string; amount: number; active: boolean };

/** YYYY-MM-DD (o con hora) → DD/MM/AAAA para mostrar vigencia. */
function fmtVence(iso: string | null | undefined): string {
  const d = String(iso || "").slice(0, 10);
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

/**
 * Giftcards compartidas (estética, comercio, moda): emisión con saldo +
 * canje manual con historial + montos fijos para la venta online.
 * La venta manual acepta monto abierto; la online exige montos de la lista
 * (comercio/moda) o monto abierto (estética legacy sin lista).
 */
export function GiftcardsManager({
  onChanged,
  codeHint = "EST-XXXXXX",
  redeemHint = "Detalle (ej: pedido, turno)",
  showDenominations = false,
}: {
  onChanged?: () => void;
  codeHint?: string;
  redeemHint?: string;
  showDenominations?: boolean;
}) {
  const [cards, setCards] = useState<Giftcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [amount, setAmount] = useState("");
  const [buyer, setBuyer] = useState("");
  const [expires, setExpires] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastCode, setLastCode] = useState<string | null>(null);
  // Canje.
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeemNote, setRedeemNote] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  // Montos fijos (venta online).
  const [dens, setDens] = useState<Denomination[]>([]);
  const [denMissing, setDenMissing] = useState(false);
  const [newDen, setNewDen] = useState("");
  const [denSaving, setDenSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/giftcards");
      const data = await res.json();
      if (data.migrationMissing) setMissing(true);
      setCards(data.giftcards || []);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  async function loadDens() {
    if (!showDenominations) return;
    try {
      const res = await fetch("/api/vendor/giftcard-denominations");
      const data = await res.json();
      if (data.migrationMissing) setDenMissing(true);
      setDens(Array.isArray(data.denominations) ? data.denominations : []);
    } catch {
      /* noop */
    }
  }

  useEffect(() => {
    load();
    loadDens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sell() {
    if (!(Number(amount) > 0)) {
      setMsg("Poné un monto mayor a 0");
      return;
    }
    setSaving(true);
    setMsg("");
    setLastCode(null);
    try {
      const res = await fetch("/api/vendor/giftcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sell", amount: Number(amount), customer_name: buyer.trim() || undefined, expires_at: expires || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setLastCode(String(data.giftcard?.code || ""));
      setAmount("");
      setBuyer("");
      setExpires("");
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  async function redeem() {
    if (!redeemCode.trim() || !(Number(redeemAmount) > 0)) {
      setMsg("Faltan código y monto a canjear");
      return;
    }
    setRedeeming(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/giftcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "redeem",
          code: redeemCode.trim(),
          amount: Number(redeemAmount),
          note: redeemNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setMsg(`Canjeado ✅ Saldo restante: $${Number(data.giftcard?.balance || 0).toLocaleString("es-AR")}`);
      setRedeemCode("");
      setRedeemAmount("");
      setRedeemNote("");
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setRedeeming(false);
    }
  }

  async function voidCard(id: string) {
    if (!confirm("¿Anular esta tarjeta? El saldo se pierde.")) return;
    try {
      await fetch("/api/vendor/giftcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", id }),
      });
      await load();
      onChanged?.();
    } catch { /* noop */ }
  }

  async function addDen() {
    if (!(Number(newDen) > 0)) {
      setMsg("Poné un monto válido");
      return;
    }
    setDenSaving(true);
    try {
      const res = await fetch("/api/vendor/giftcard-denominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(newDen) }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setNewDen("");
      await loadDens();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setDenSaving(false);
    }
  }

  async function toggleDen(d: Denomination) {
    try {
      await fetch("/api/vendor/giftcard-denominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", id: d.id, active: !d.active }),
      });
      await loadDens();
      onChanged?.();
    } catch { /* noop */ }
  }

  async function deleteDen(id: string) {
    if (!confirm("¿Borrar este monto de la lista?")) return;
    try {
      await fetch("/api/vendor/giftcard-denominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      await loadDens();
      onChanged?.();
    } catch { /* noop */ }
  }

  if (missing) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Falta aplicar la migración <code>migrate-estetica-giftcards.sql</code> en la base para giftcards.
      </Card>
    );
  }

  const statusLabel = (c: Giftcard) =>
    c.status === "redeemed" ? "Agotada" : c.status === "void" ? "Anulada" : "Activa";

  const venceLabel = (c: Giftcard) =>
    c.expires_at ? ` · Vence ${fmtVence(c.expires_at)}` : " · Sin vencimiento";

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">🎁 Tarjetas de regalo</p>
        <p className="text-xs text-muted-foreground">
          Emitís un código con saldo (lo cobrás por caja o MP aparte) y lo canjeás en pedidos o en el local.
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : cards.length > 0 && (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {cards.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
              <span className="flex-1 min-w-0">
                <span className="block font-mono font-bold truncate">{c.code}</span>
                <span className="block text-muted-foreground">
                  Saldo ${Number(c.balance || 0).toLocaleString("es-AR")} de ${Number(c.amount || 0).toLocaleString("es-AR")}
                  {c.customer_name ? ` · ${c.customer_name}` : ""} · {statusLabel(c)}{venceLabel(c)}
                </span>
              </span>
              {c.status === "active" && (
                <button type="button" onClick={() => voidCard(c.id)} className="text-red-600 hover:text-red-700 flex-shrink-0" title="Anular">
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-medium">Emitir tarjeta</p>
        <div className="grid grid-cols-2 gap-2">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Monto $" className="h-9 text-sm" />
          <Input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Para quién (opcional)" className="h-9 text-sm" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Vence (opcional)</label>
          <Input value={expires} onChange={(e) => setExpires(e.target.value)} type="date" className="h-9 text-sm mt-0.5" />
        </div>
        <Button size="sm" className="w-full" onClick={sell} disabled={saving}>
          {saving ? "Generando..." : "🎁 Emitir giftcard"}
        </Button>
        {lastCode && (
          <p className="text-xs text-center rounded-lg bg-green-50 border border-green-200 text-green-800 px-3 py-2">
            Código <strong className="font-mono">{lastCode}</strong> — pasáselo por WhatsApp
          </p>
        )}
      </div>
      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-medium">Canjear</p>
        <div className="grid grid-cols-2 gap-2">
          <Input value={redeemCode} onChange={(e) => setRedeemCode(e.target.value.toUpperCase())} placeholder={`Código ${codeHint}`} className="h-9 text-sm font-mono" />
          <Input value={redeemAmount} onChange={(e) => setRedeemAmount(e.target.value)} inputMode="decimal" placeholder="Monto $" className="h-9 text-sm" />
        </div>
        <Input value={redeemNote} onChange={(e) => setRedeemNote(e.target.value)} placeholder={redeemHint} className="h-9 text-sm" />
        <Button size="sm" variant="outline" className="w-full" onClick={redeem} disabled={redeeming}>
          {redeeming ? "Canjeando..." : "Canjear saldo"}
        </Button>
      </div>
      {showDenominations && (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs font-medium">Montos para ofrecer</p>
          <p className="text-xs text-muted-foreground">
            Estos montos aparecen como tarjetas en tu catálogo (se venden como productos, sin MP aparte).
          </p>
          {denMissing ? (
            <p className="text-xs text-muted-foreground">
              Falta aplicar la migración <code>migrate-giftcard-denominations.sql</code> en la base.
            </p>
          ) : (
            <>
              {dens.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {dens.map((d) => (
                    <span
                      key={d.id}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${d.active ? "border-border bg-muted" : "border-dashed opacity-50"}`}
                    >
                      ${Number(d.amount).toLocaleString("es-AR")}
                      <button type="button" onClick={() => toggleDen(d)} className="underline" title={d.active ? "Pausar" : "Activar"}>
                        {d.active ? "pausar" : "activar"}
                      </button>
                      <button type="button" onClick={() => deleteDen(d.id)} className="text-red-600" title="Borrar">
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input value={newDen} onChange={(e) => setNewDen(e.target.value)} inputMode="decimal" placeholder="Nuevo monto $" className="h-9 text-sm flex-1" />
                <Button size="sm" onClick={addDen} disabled={denSaving}>
                  {denSaving ? "..." : "Agregar"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </Card>
  );
}
