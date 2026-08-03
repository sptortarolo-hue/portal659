"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type CartItem = {
  offerId: string;
  name: string;
  price: number;
  qty: number;
};

export type CartVendor = {
  id: string;
  slug: string;
  storeName: string;
  whatsapp: string;
};

type CartState = {
  vendor: CartVendor | null;
  items: CartItem[];
};

type CartContextValue = {
  vendor: CartVendor | null;
  items: CartItem[];
  addItem: (vendor: CartVendor, item: CartItem) => void;
  removeItem: (offerId: string) => void;
  setQty: (offerId: string, qty: number) => void;
  clear: () => void;
  total: number;
  count: number;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const EMPTY: CartState = { vendor: null, items: [] };

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);
  const [open, setOpen] = useState(false);

  const addItem = useCallback((newVendor: CartVendor, item: CartItem) => {
    setState((prev) => {
      const reset = prev.vendor && prev.vendor.id !== newVendor.id;
      const base = reset ? [] : prev.items;
      const existing = base.find((i) => i.offerId === item.offerId);
      const items = existing
        ? base.map((i) =>
            i.offerId === item.offerId ? { ...i, qty: i.qty + 1 } : i
          )
        : [...base, item];
      return { vendor: newVendor, items };
    });
    setOpen(true);
  }, []);

  const removeItem = useCallback((offerId: string) => {
    setState((prev) => ({
      vendor: prev.vendor,
      items: prev.items.filter((i) => i.offerId !== offerId),
    }));
  }, []);

  const setQty = useCallback((offerId: string, qty: number) => {
    setState((prev) => ({
      vendor: prev.vendor,
      items:
        qty <= 0
          ? prev.items.filter((i) => i.offerId !== offerId)
          : prev.items.map((i) =>
              i.offerId === offerId ? { ...i, qty } : i
            ),
    }));
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);

  const total = useMemo(
    () => state.items.reduce((sum, i) => sum + i.price * i.qty, 0),
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
      clear,
      total,
      count,
      open,
      setOpen,
    }),
    [state, addItem, removeItem, setQty, clear, total, count, open]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de CartProvider");
  return ctx;
}
