"use client";

import { useEffect } from "react";

/**
 * Sincroniza el contexto de preview (?preview=1 o ?preview=<token>) a
 * sessionStorage para que el checkout marque los pedidos como prueba.
 * Solo vive en la pestaña actual (sessionStorage).
 */
export function PreviewSessionSync({
  vendorId,
  token,
}: {
  vendorId: string;
  token: string | null;
}) {
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "portal659-preview",
        JSON.stringify({ vendorId, token: token ?? null })
      );
    } catch {
      /* noop */
    }
  }, [vendorId, token]);

  return null;
}

/** Lee el contexto de preview para un comercio dado (checkout). */
export function readPreviewSession(vendorId: string): { token: string | null } | null {
  try {
    const raw = sessionStorage.getItem("portal659-preview");
    if (!raw) return null;
    const data = JSON.parse(raw) as { vendorId?: string; token?: string | null };
    if (data.vendorId !== vendorId) return null;
    return { token: data.token ?? null };
  } catch {
    return null;
  }
}
