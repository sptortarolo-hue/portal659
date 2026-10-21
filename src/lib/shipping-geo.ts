/**
 * Helpers client-safe de geo/avisos para el panel de logística
 * (Portal 659 Envíos). Sin API keys: Google Maps por links gratis
 * (mismo patrón que el micrositio) y WhatsApp por wa.me.
 */

/** "Cómo llegar" con destino = dirección en texto (Maps directions, gratis). */
export function mapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

/** "Cómo llegar" con destino = coordenadas (pin si la dirección se geocodificó). */
export function mapsDirectionsUrlFromCoords(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

/** Link de ficha del punto en mapa (para compartir/revisar, no navegación). */
export function mapsSearchUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** wa.me con el teléfono en cualquier formato digitalizado (mismo saneo que el resto). */
export function waUrlFromPhone(phone: string | null | undefined, text: string): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Llamada directa. */
export function telUrl(phone: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `tel:${digits}`;
}

/** Push "voy para allá" al comprador (equivalente al aviso de Flex). */
export function buyerVoyText(code: string, vendorName: string | null): string {
  return `Hola! Te escribo por tu paquete ${code}${
    vendorName ? ` de ${vendorName}` : ""
  }: viene en camino hoy 🚚. Compartí referencias si las tenés (portón, timbre) 👍`;
}
