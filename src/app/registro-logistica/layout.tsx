import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Registrar mi logística | Portal 659 Envíos",
  robots: { index: false, follow: false },
};

export default function RegistroLogisticaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
