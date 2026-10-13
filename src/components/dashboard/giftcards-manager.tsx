"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { fmtVence, buildGiftcardWaText, giftcardCardUrl, giftcardWaLink } from "@/lib/gift-card-share";

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

type Denomination = { id: string; amount: number; active: boolean; image_url?: string | null; description?: string | null };

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
  storeName = "el local",
}: {
  onChanged?: () => void;
  codeHint?: string;
  redeemHint?: string;
  showDenominations?: boolean;
  storeName?: string;
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
  // Personalizar por monto: foto + descripción de la tarjeta.
  const [customId, setCustomId] = useState<string | null>(null);
  const [customDesc, setCustomDesc] = useState("");
  const [customBusy, setCustomBusy] = useState(false);

  async function uploadDenPhoto(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "offers");
      const res = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      return typeof data.url === "string" && data.url ? data.url : null;
    } catch {
      return null;
    }
  }

  async function saveCustomPhoto(d: Denomination, file: File) {
    setCustomBusy(true);
    try {
      const url = await uploadDenPhoto(file);
      if (!url) {
        setMsg("No se pudo subir la foto");
        return;
      }
      const res = await fetch("/api/vendor/giftcard-denominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "customize", id: d.id, image_url: url }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setMsg(data.error);
        return;
      }
      await loadDens();
      onChanged?.();
    } finally {
      setCustomBusy(false);
    }
  }

  async function saveCustomDesc(d: Denomination) {
    setCustomBusy(true);
    try {
      const res = await fetch("/api/vendor/giftcard-denominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "customize", id: d.id, description: customDesc }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setCustomId(null);
      setCustomDesc("");
      await loadDens();
      onChanged?.();
    } finally {
      setCustomBusy(false);
    }
  }
  // Ficha expandible por tarjeta: historial + reenvío por WhatsApp.
  const [openId, setOpenId] = useState<string | null>(null);
  const [movesById, setMovesById] = useState<Record<string, any[]>>({});
  const [movesBusy, setMovesBusy] = useState(false);

  async function toggleCard(c: Giftcard) {
    if (openId === c.id) {
      setOpenId(null);
      return;
    }
    setOpenId(c.id);
    if (movesById[c.id]) return;
    setMovesBusy(true);
    try {
      const res = await fetch(`/api/vendor/giftcard-moves?giftcardId=${encodeURIComponent(c.id)}`);
      const data = await res.json();
      if (Array.isArray(data.moves)) {
        setMovesById((prev) => ({ ...prev, [c.id]: data.moves }));
      }
    } catch {
      /* noop */
    } finally {
      setMovesBusy(false);
    }
  }

  async function resendCard(c: Giftcard) {
    const text = buildGiftcardWaText({
      storeName,
      amount: Math.round(Number(c.amount) || 0),
      code: String(c.code || ""),
      expiresAt: c.expires_at,
      cardUrl: giftcardCardUrl(window.location.origin, String(c.code || "")),
    });
    fetch("/api/vendor/giftcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_sent", id: c.id }),
    })
      .then(() => load())
      .catch(() => {});
    const digits = String(c.customer_phone || "").replace(/[^0-9]/g, "");
    window.open(giftcardWaLink(digits, text), "_blank");
  }

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
          {cards.map((c) => {
            const open = openId === c.id;
            const moves = movesById[c.id] || [];
            return (
              <div key={c.id} className="rounded-lg bg-muted px-2.5 py-2 text-xs">
                <button
                  type="button"
                  onClick={() => toggleCard(c)}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-mono font-bold truncate">{c.code}</span>
                    <span className="block text-muted-foreground">
                      Saldo ${Number(c.balance || 0).toLocaleString("es-AR")} de ${Number(c.amount || 0).toLocaleString("es-AR")}
                      {c.customer_name ? ` · ${c.customer_name}` : ""} · {statusLabel(c)}{venceLabel(c)}
                      {(c as any).sent_at ? " · Enviada ✓" : " · Sin enviar"}
                    </span>
                  </span>
                  <span className="text-muted-foreground flex-shrink-0">{open ? "▲" : "▼"}</span>
                  {c.status === "active" && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); voidCard(c.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); voidCard(c.id); } }}
                      className="text-red-600 hover:text-red-700 flex-shrink-0"
                      title="Anular"
                    >
                      ✕
                    </span>
                  )}
                </button>
                {open && (
                  <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                    {movesBusy && moves.length === 0 ? (
                      <p className="text-muted-foreground">Cargando historial...</p>
                    ) : moves.length > 0 ? (
                      moves.map((m: any) => (
                        <div key={String(m.id)} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {String(m.kind) === "issue" ? "Emitida" : String(m.kind) === "redeem" ? "Canje" : "Ajuste"}
                            {m.note ? ` · ${String(m.note)}` : ""}
                          </span>
                          <span className="tabular-nums font-medium">
                            {String(m.kind) === "redeem" ? "−" : "+"}${Math.round(Number(m.amount) || 0).toLocaleString("es-AR")}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">Sin movimientos todavía.</p>
                    )}
                    <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => resendCard(c)}>
                      Enviar por WhatsApp
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
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
                <div className="space-y-1.5">
                  {dens.map((d) => (
                    <div key={d.id} className="rounded-lg border border-border px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        {d.image_url ? (
                          <img src={d.image_url} alt="" className="h-9 w-9 rounded-md object-cover flex-shrink-0" />
                        ) : (
                          <div className="h-9 w-9 rounded-md bg-violet-100 flex items-center justify-center flex-shrink-0 text-base">🎁</div>
                        )}
                        <span
                          className={`flex-1 min-w-0 text-xs font-medium ${d.active ? "" : "opacity-50"}`}
                        >
                          ${Number(d.amount).toLocaleString("es-AR")}
                          {!d.active && " (pausado)"}
                        </span>
                        <button type="button" onClick={() => toggleDen(d)} className="underline text-xs" title={d.active ? "Pausar" : "Activar"}>
                          {d.active ? "pausar" : "activar"}
                        </button>
                        <button type="button" onClick={() => deleteDen(d.id)} className="text-red-600 text-xs" title="Borrar">
                          ✕
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <label className="text-[11px] text-primary underline cursor-pointer">
                          {d.image_url ? "Cambiar foto" : "Agregar foto"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={customBusy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) saveCustomPhoto(d, f);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="text-[11px] text-primary underline"
                          onClick={() => {
                            setCustomId(customId === d.id ? null : d.id);
                            setCustomDesc(d.description || "");
                          }}
                        >
                          {customId === d.id ? "Cerrar texto" : d.description ? "Editar texto" : "Agregar texto"}
                        </button>
                      </div>
                      {customId === d.id && (
                        <div className="mt-1.5 flex gap-1.5">
                          <Input
                            value={customDesc}
                            onChange={(e) => setCustomDesc(e.target.value)}
                            placeholder="Texto de la tarjeta (opcional)"
                            className="h-8 text-xs flex-1"
                            maxLength={500}
                          />
                          <Button size="sm" className="h-8 text-xs" onClick={() => saveCustomDesc(d)} disabled={customBusy}>
                            Guardar
                          </Button>
                        </div>
                      )}
                    </div>
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
