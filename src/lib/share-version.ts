/**
 * Versión de la tarjeta/imagen de un comercio.
 *
 * WhatsApp cachea la preview de un link POR URL (no la refresca en cada
 * envío): si el comercio cambia la foto del local, la preview seguía
 * mostrando la tarjeta vieja (la que se generó sin foto, o con la foto
 * anterior). Con un fingerprint de la foto en la URL:
 *  - la `og:image` del micrositio cambia (/og/tienda/{slug}.jpg?v=...) → el
 *    crawler baja la tarjeta nueva;
 *  - el link que se comparte lleva `?v=...` → WhatsApp lo trata como una
 *    URL nueva y vuelve a leer la página.
 *
 * Es un hash simple (djb2), NO criptográfico: sólo sirve de huella para
 * cambiar cuando cambia la foto. Sin imports de node → usable en el panel
 * (cliente) y en el servidor.
 */
export function shareVersionFor(
  imageUrl?: string | null,
  logoUrl?: string | null
): string {
  const s = `${imageUrl || ""}|${logoUrl || ""}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).slice(0, 8);
}
