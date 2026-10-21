import type { Metadata } from "next";

// Página pública pero con código de rastreo (datos operativos): noindex.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
