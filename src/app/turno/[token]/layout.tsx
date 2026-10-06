import type { Metadata } from "next";

// Página con datos personales por token: nunca debe indexarse.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function TurnoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
