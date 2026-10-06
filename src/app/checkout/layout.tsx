import type { Metadata } from "next";

// Pantalla transaccional con datos del comprador: nunca debe indexarse.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
