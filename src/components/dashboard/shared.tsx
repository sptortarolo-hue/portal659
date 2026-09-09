"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

/** Hace un fetch a una API y devuelve ok + mensaje de error (si lo hay). */
export async function apiJson(url: string, init?: RequestInit): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, error: data?.error };
  } catch {
    return { ok: false, error: "Error de red" };
  }
}
import { QuantityInput } from "@/components/ui/quantity-input";
import { ImageCropModal } from "@/components/ui/image-crop-modal";

type Offer = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  available: boolean;
  featured_today: boolean;
  image_url: string | null;
  stock: number | null;
  stock_low_threshold: number | null;
  stock_control?: boolean;
  promo_price: number | null;
  requires_prep?: boolean;
};

type Modifier = {
  id: string;
  product_id: string;
  group_name: string;
  options: { label: string; price_mod: number }[];
  required: boolean;
  max_selections: number;
  position: number;
};

type MenuCategory = { id: string; name: string; position: number };

type SharedProps = {
  vendor: any;
  offers: Offer[];
  categories: MenuCategory[];
  msg: string;
  setMsg: (m: string) => void;
  reload: () => void;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
  uploading: boolean;
};

type OfferFormProps = {
  categories: MenuCategory[];
  editingId: string | null;
  offName: string;
  setOffName: (v: string) => void;
  offDesc: string;
  setOffDesc: (v: string) => void;
  offPrice: string;
  setOffPrice: (v: string) => void;
  offCategory: string;
  setOffCategory: (v: string) => void;
  offFile: File | null;
  setOffFile: (f: File | null) => void;
  offPreview: string | null;
  setOffPreview: (v: string | null) => void;
  saving: boolean;
  onCrop?: (target: "offer") => void;
  showStock?: boolean;
  offStock?: number;
  setOffStock?: (v: number) => void;
  offStockControl?: boolean;
  setOffStockControl?: (v: boolean) => void;
  offPromoPrice?: string;
  setOffPromoPrice?: (v: string) => void;
  offStockLowThreshold?: number;
  setOffStockLowThreshold?: (v: number) => void;
  showPrep?: boolean;
  offRequiresPrep?: boolean;
  setOffRequiresPrep?: (v: boolean) => void;
  onSubmit: () => void;
  onClose?: () => void;
};

export function OfferForm({
  categories,
  editingId,
  offName, setOffName,
  offDesc, setOffDesc,
  offPrice, setOffPrice,
  offCategory, setOffCategory,
  offFile, setOffFile,
  offPreview, setOffPreview,
  saving, onSubmit, onCrop,
  showStock,
  offStock = 0, setOffStock,
  offStockControl = false, setOffStockControl,
  offPromoPrice = "", setOffPromoPrice,
  offStockLowThreshold = 5, setOffStockLowThreshold,
  showPrep = false,
  offRequiresPrep = true, setOffRequiresPrep,
  onClose,
}: OfferFormProps) {
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{editingId ? "Editar plato" : "Nuevo plato"}</h3>
        {onClose && (
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>✕</Button>
        )}
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nombre</Label><Input value={offName} onChange={(e) => setOffName(e.target.value)} required onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} /></div>
          <div><Label>Precio ($)</Label><Input type="number" step="0.01" value={offPrice} onChange={(e) => setOffPrice(e.target.value)} required onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} /></div>
        </div>
        {showStock && setOffPromoPrice && (
          <div><Label>Precio promo ($)</Label><Input type="number" step="0.01" value={offPromoPrice} onChange={(e) => setOffPromoPrice(e.target.value)} placeholder="Precio de oferta" /></div>
        )}
        <div><Label>Categoría</Label><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={offCategory} onChange={(e) => setOffCategory(e.target.value)}>{categories.length === 0 && <option value="otras">otras</option>}{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></div>
        {showPrep && setOffRequiresPrep && (
          <div className="flex items-center justify-between">
            <div>
              <Label>Requiere elaboración</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Si lo apagás (bebidas, packs ya hechos), un pedido de solo estos ítems no entra a cocina ni imprime comanda
              </p>
            </div>
            <Switch
              checked={offRequiresPrep}
              onCheckedChange={setOffRequiresPrep}
            />
          </div>
        )}
        {showStock && setOffStockControl && (
          <div className="flex items-center justify-between">
            <div>
              <Label>Control de stock</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Muestra y controla las unidades disponibles de este producto
              </p>
            </div>
            <Switch
              checked={offStockControl}
              onCheckedChange={setOffStockControl}
            />
          </div>
        )}
        {showStock && offStockControl && setOffStock && setOffStockLowThreshold && (
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Stock</Label><QuantityInput value={offStock} onChange={setOffStock} min={0} /></div>
            <div><Label>Umbral bajo stock</Label><Input type="number" min={0} value={offStockLowThreshold} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) setOffStockLowThreshold(v); }} /></div>
          </div>
        )}
        <div><Label>Foto</Label><Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; if (f && onCrop) { const src = URL.createObjectURL(f); setOffFile(f); setOffPreview(src); } else if (f) { setOffFile(f); setOffPreview(URL.createObjectURL(f)); } }} />{offPreview && <img src={offPreview} alt="Preview" className="mt-2 h-20 w-full object-cover rounded-lg" />}</div>
        <div><Label>Descripción</Label><Textarea value={offDesc} onChange={(e) => setOffDesc(e.target.value)} /></div>
        <Button type="button" onClick={() => onSubmit()} disabled={saving} className="w-full">{saving ? "Guardando..." : editingId ? "Guardar" : "Agregar"}</Button>
      </div>
    </Card>
  );
}

export function OfferList({ offers, onEdit, onToggleFeatured, onToggleAvailable, onDelete, editingId, editForm, onEditModifiers }: {
  offers: Offer[];
  onEdit: (o: Offer) => void;
  onToggleFeatured: (o: Offer) => void;
  onToggleAvailable: (o: Offer) => void;
  onDelete: (o: Offer) => void;
  editingId?: string | null;
  editForm?: ReactNode;
  onEditModifiers?: (o: Offer) => void;
}) {
  const editAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editingId || !editForm) return;
    const t = setTimeout(() => {
      editAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
    return () => clearTimeout(t);
  }, [editingId, editForm]);

  return (
    <div className="space-y-3">
      {offers.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">Todavía no cargaste platos.</p>
      ) : (
        offers.map((offer) => (
          <div key={offer.id}>
            <Card className="p-3">
              <div className="flex items-center gap-3">
                {offer.image_url ? (
                  <img src={offer.image_url} alt={offer.name} className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center flex-shrink-0"><span className="font-bold text-primary/60">{offer.name.charAt(0)}</span></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate">{offer.name}</span>
                    {offer.featured_today && <Badge className="bg-sun/20 text-ink text-[10px] px-1.5 py-0">Hoy</Badge>}
                    {!offer.available && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Pausado</Badge>}
                    {offer.stock !== null && offer.stock <= (offer.stock_low_threshold || 5) && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        {offer.stock === 0 ? "Sin stock" : `Stock: ${offer.stock}`}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {offer.promo_price ? (
                      <><span className="line-through">${Number(offer.price).toLocaleString("es-AR")}</span> <span className="text-primary font-medium">${Number(offer.promo_price).toLocaleString("es-AR")}</span></>
                    ) : (
                      <>${Number(offer.price).toLocaleString("es-AR")}</>
                    )}
                    {offer.category && ` · ${offer.category}`}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => onEdit(offer)}>Editar</Button>
                  <Button variant="outline" size="sm" onClick={() => onToggleFeatured(offer)}>{offer.featured_today ? "Quitar" : "Destacar"}</Button>
                  <Button variant="outline" size="sm" onClick={() => onToggleAvailable(offer)}>{offer.available ? "Pausar" : "Activar"}</Button>
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={() => onDelete(offer)}>Eliminar</Button>
                </div>
                <div className="sm:hidden flex-shrink-0">
                  <DropdownMenu
                    trigger={<span className="text-xl">⋯</span>}
                    items={[
                      { label: "Editar", icon: "✏️", onClick: () => onEdit(offer) },
                      { label: "Modificadores", icon: "⚙️", onClick: () => onEditModifiers ? onEditModifiers(offer) : onEdit(offer) },
                      { label: offer.featured_today ? "Quitar de Hoy" : "Destacar Hoy", icon: "⭐", onClick: () => onToggleFeatured(offer) },
                      { label: offer.available ? "Pausar" : "Activar", icon: offer.available ? "⏸️" : "▶️", onClick: () => onToggleAvailable(offer) },
                      { label: "Eliminar", icon: "🗑️", onClick: () => onDelete(offer), destructive: true },
                    ]}
                  />
                </div>
              </div>
            </Card>
            {editingId === offer.id && editForm && (
              <div ref={editAnchorRef} className="mt-2">
                {editForm}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export function CategoryManager({ categories, onAdd, onRename, onDelete, onMove }: {
  categories: MenuCategory[];
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (cat: MenuCategory) => void;
  onMove: (cat: MenuCategory, dir: -1 | 1) => void;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const addCategory = () => {
    if (newName.trim()) {
      onAdd(newName.trim());
      setNewName("");
    }
  };

  return (
    <CollapsibleSection icon="📂" title={`Categorías (${categories.length})`}>
      <div className="flex gap-2 mb-3">
        <Input
          placeholder="Nueva categoría"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
        />
        <Button type="button" size="sm" disabled={!newName.trim()} onClick={addCategory}>+</Button>
      </div>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">Creá categorías para organizar tu menú.</p>
      ) : (
        <ul className="space-y-2">
          {categories.map((cat, i) => (
            <li key={cat.id} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2">
              {editingId === cat.id ? (
                <>
                  <Input className="h-8 flex-1" value={editingName} onChange={(e) => setEditingName(e.target.value)} autoFocus />
                  <Button type="button" size="sm" variant="outline" onClick={() => { onRename(cat.id, editingName); setEditingId(null); }}>OK</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>✕</Button>
                </>
              ) : (
                <>
                  <span className="font-medium flex-1 min-w-0 truncate">{cat.name}</span>
                  <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => onMove(cat, -1)}>↑</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={i === categories.length - 1} onClick={() => onMove(cat, 1)}>↓</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }}>✏️</Button>
                  <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => onDelete(cat)}>🗑️</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

export function LivePreview({ storeName, storePreview, vendor, logoPreview, description, hours, address, paymentMethods, whatsapp, isService }: {
  storeName: string;
  storePreview: string | null;
  vendor: any;
  logoPreview: string | null;
  description: string;
  hours: string;
  address: string;
  paymentMethods: string[];
  whatsapp: string;
  isService: boolean;
}) {
  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-card">
      {storePreview || vendor.image_url ? (
        <div className="h-28 w-full"><img src={storePreview || vendor.image_url || ""} alt="" className="w-full h-full object-cover" /></div>
      ) : (
        <div className="h-28 w-full bg-gradient-to-br from-secondary to-accent flex items-center justify-center"><span className="font-display text-4xl font-bold text-primary/30">{(storeName || vendor.store_name || "?").charAt(0)}</span></div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-3 mb-2">
          {logoPreview || vendor.logo_url ? (
            <img src={logoPreview || vendor.logo_url || ""} alt="" className="h-10 w-10 rounded-full object-cover border-2 border-white shadow -mt-8 relative" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center border-2 border-white shadow -mt-8 relative"><span className="font-bold text-primary text-sm">{(storeName || vendor.store_name || "?").charAt(0)}</span></div>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{storeName || vendor.store_name}</p>
            <p className="text-[10px] text-muted-foreground">Vista previa de tu micrositio</p>
          </div>
        </div>
        {description && <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{description}</p>}
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {hours && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">🕐 {hours}</span>}
          {address && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">📍 {address}</span>}
          {paymentMethods.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">💳 {paymentMethods.join(", ")}</span>}
        </div>
        {whatsapp && (
          <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-whatsapp/10 text-whatsapp px-3 py-1.5 text-xs font-medium">
            📱 WhatsApp {isService ? "de consulta" : "de pedidos"}
          </div>
        )}
      </div>
    </div>
  );
}

export function TransferConfig({
  vendor,
  saveVendor,
}: {
  vendor: any;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [alias, setAlias] = useState<string>(vendor?.transfer_alias || "");
  const [cbu, setCbu] = useState<string>(vendor?.transfer_cbu || "");
  const [holder, setHolder] = useState<string>(vendor?.transfer_holder || "");
  const [block, setBlock] = useState<boolean>(!!vendor?.block_unpaid_orders);

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div>
        <Label>Alias (CBU)</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Lo ves en tu home banking. Ej: super.mi.barrio
        </p>
        <Input
          className="mt-1"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          onBlur={() => saveVendor({ transfer_alias: alias || null })}
        />
      </div>
      <div>
        <Label>CBU</Label>
        <Input
          className="mt-1"
          value={cbu}
          onChange={(e) => setCbu(e.target.value)}
          onBlur={() => saveVendor({ transfer_cbu: cbu || null })}
          placeholder="0000000000000000000000"
        />
      </div>
      <div>
        <Label>Titular de la cuenta</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Nombre y apellido o razón social a nombre del cual se hace la transferencia
        </p>
        <Input
          className="mt-1"
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          onBlur={() => saveVendor({ transfer_holder: holder || null })}
        />
      </div>
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div>
          <Label>Bloquear hasta confirmar pago</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            No deja avanzar (aceptar/preparar) un pedido pendiente hasta marcar el pago como recibido
          </p>
        </div>
        <Switch
          checked={block}
          onCheckedChange={(v) => {
            setBlock(v);
            saveVendor({ block_unpaid_orders: v });
          }}
        />
      </div>
    </div>
  );
}

export function DeliveryFeeConfig({
  vendor,
  saveVendor,
}: {
  vendor: any;
  saveVendor: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [fee, setFee] = useState<string>(vendor?.delivery_fee != null ? String(vendor.delivery_fee) : "");
  const [freeMin, setFreeMin] = useState<string>(vendor?.free_delivery_min != null ? String(vendor.free_delivery_min) : "");

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Costo de envío ($)</Label>
          <Input
            className="mt-1"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            onBlur={() => saveVendor({ delivery_fee: fee === "" ? null : Number(fee) })}
          />
        </div>
        <div>
          <Label>Envío gratis desde ($)</Label>
          <Input
            className="mt-1"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="—"
            value={freeMin}
            onChange={(e) => setFreeMin(e.target.value)}
            onBlur={() => saveVendor({ free_delivery_min: freeMin === "" ? null : Number(freeMin) })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Si el pedido a domicilio supera el monto de &quot;Envío gratis desde&quot;, no se cobra el costo de envío.
      </p>
    </div>
  );
}
