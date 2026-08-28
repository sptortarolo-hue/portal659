"use client";

import { useEffect, useState } from "react";
import { ShareButton } from "@/components/ui/share-button";

type VendorShareButtonProps = {
  slug: string;
  storeName: string;
};

export function VendorShareButton({ slug, storeName }: VendorShareButtonProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    setUrl(`${window.location.origin}/tienda/${slug}`);
  }, [slug]);

  return (
    <ShareButton
      url={url}
      title={storeName}
      text={`Mirá ${storeName} en Portal 659`}
    />
  );
}