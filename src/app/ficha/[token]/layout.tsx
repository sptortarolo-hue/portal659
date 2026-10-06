import type { Metadata } from "next";

// Ficha clínica con datos personales por token: nunca debe indexarse.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function FichaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
