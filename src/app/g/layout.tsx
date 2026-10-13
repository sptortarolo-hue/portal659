import type { Metadata } from "next";

// Las fichas de giftcard se abren por conocimiento del código: nunca se indexan.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function GiftcardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
