"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type CartModifier = {
  group: string;
  label: string;
  price_mod: number;
};

export type CartItem = {
  offerId: string;
  /** Variante elegida (moda): se usa para reservar/reponer stock. */
  variantId?: string;
  name: string;
  price: number;
  qty: number;
  modifiers?: CartModifier[];
  /** La promo de este ítem está excluida del descuento en efectivo. */
  cashExcluded?: boolean;
};

export type CartVendor = {
  id: string;
  slug: string;
  storeName: string;
  whatsapp: string;
  vertical?: string | null;
  deliveryFee?: number | null;
  freeDeliveryMin?: number | null;
  /** % de descuento en efectivo del comercio (visual en checkout). */
  cashDiscountPct?: number | null;
};

type CartState = {
  vendor: CartVendor | null;
  items: CartItem[];
};

type CartContextValue = {
  vendor: CartVendor | null;
  items: CartItem[];
  addItem: (vendor: CartVendor, item: CartItem) => boolean;
  removeItem: (offerId: string, modifiers?: CartModifier[]) => void;
  setQty: (offerId: string, qty: number, modifiers?: CartModifier[]) => void;
  loadOrder: (vendor: CartVendor, items: CartItem[]) => void;
  clear: () => void;
  total: number;
  count: number;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "portal659_cart";

function loadCart(): CartState {
  if (typeof window === "undefined") return { vendor: null, items: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { vendor: null, items: [] };
    const parsed = JSON.parse(raw) as CartState;
    if (parsed && Array.isArray(parsed.items)) {
      return {
        vendor: parsed.vendor
          ? {
              id: parsed.vendor.id,
              slug: parsed.vendor.slug || "",
              storeName: parsed.vendor.storeName || "",
              whatsapp: parsed.vendor.whatsapp || "",
              vertical: parsed.vendor.vertical || null,
              deliveryFee: parsed.vendor.deliveryFee ?? null,
              freeDeliveryMin: parsed.vendor.freeDeliveryMin ?? null,
            }
          : null,
        items: parsed.items,
      };
    }
  } catch { /* noop */ }
  return { vendor: null, items: [] };
}

function saveCart(state: CartState) {
  if (typeof window === "undefined") return;
  try {
    if (state.items.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch { /* noop */ }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadCart());
    setHydrated(true);
  }, []);

  // Si el usuario navega para atrás (botón/gesto del navegador o Android),
  // cerramos el carrito abierto. NO se toca history.pushState/history.back:
  // mutar el historial confunde al App Router de Next y dejaba la app tildada.
  useEffect(() => {
    if (!open) return;
    const onPop = () => setOpen(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open, setOpen]);

  const addItem = useCallback((newVendor: CartVendor, item: CartItem): boolean => {
    let switched = false;
    setState((prev) => {
      const reset = prev.vendor && prev.vendor.id !== newVendor.id;
      if (reset) switched = true;
      const base = reset ? [] : prev.items;
      const modifierKey = JSON.stringify(item.modifiers || []);
      const existing = base.find(
        (i) => i.offerId === item.offerId && JSON.stringify(i.modifiers || []) === modifierKey
      );
      const items = existing
        ? base.map((i) =>
            i.offerId === item.offerId && JSON.stringify(i.modifiers || []) === modifierKey
              ? { ...i, qty: i.qty + 1 }
              : i
          )
        : [...base, item];
      const next = { vendor: newVendor, items };
      saveCart(next);
      return next;
    });
    return switched;
  }, []);

  const removeItem = useCallback((offerId: string, modifiers?: CartModifier[]) => {
    setState((prev) => {
      const modifierKey = JSON.stringify(modifiers || []);
      const next = {
        vendor: prev.vendor,
        items: prev.items.filter(
          (i) => !(i.offerId === offerId && JSON.stringify(i.modifiers || []) === modifierKey)
        ),
      };
      saveCart(next);
      return next;
    });
  }, []);

  const setQty = useCallback((offerId: string, qty: number, modifiers?: CartModifier[]) => {
    setState((prev) => {
      const modifierKey = JSON.stringify(modifiers || []);
      const items = qty <= 0
        ? prev.items.filter(
            (i) => !(i.offerId === offerId && JSON.stringify(i.modifiers || []) === modifierKey)
          )
        : prev.items.map((i) =>
            i.offerId === offerId && JSON.stringify(i.modifiers || []) === modifierKey
              ? { ...i, qty }
              : i
          );
      const next = { vendor: prev.vendor, items };
      saveCart(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setState(EMPTY);
    saveCart(EMPTY);
  }, []);

  const loadOrder = useCallback((vendor: CartVendor, items: CartItem[]) => {
    const next = { vendor, items };
    setState(next);
    saveCart(next);
  }, []);

  const total = useMemo(
    () => state.items.reduce((sum, i) => {
      const modTotal = (i.modifiers || []).reduce((ms, m) => ms + m.price_mod, 0);
      return sum + (i.price + modTotal) * i.qty;
    }, 0),
    [state.items]
  );

  const count = useMemo(
    () => state.items.reduce((sum, i) => sum + i.qty, 0),
    [state.items]
  );

  const value = useMemo(
    () => ({
      vendor: state.vendor,
      items: state.items,
      addItem,
      removeItem,
      setQty,
      loadOrder,
      clear,
      total,
      count,
      open,
      setOpen,
    }),
    [state, addItem, removeItem, setQty, loadOrder, clear, total, count, open]
  );

  if (!hydrated) return <CartContext.Provider value={{ ...value, items: [], vendor: null, total: 0, count: 0 }}>{children}</CartContext.Provider>;

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

const EMPTY: CartState = { vendor: null, items: [] };

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de CartProvider");
  return ctx;
}
