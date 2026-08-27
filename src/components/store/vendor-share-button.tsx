"use client";

import { ShareButton } from "@/components/ui/share-button";

type VendorShareButtonProps = {
  slug: string;
  storeName: string;
};

export function VendorShareButton({ slug, storeName }: VendorShareButtonProps) {
  const url = `${window.location.origin}/tienda/${slug}`;
  return (
    <ShareButton
      url={url}
      title={storeName}
      text={`Mirá ${storeName} en Portal 659`}
    />
  );
}
