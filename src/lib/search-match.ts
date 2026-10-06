/**
 * Matching de clientes "a medida que escribís": insensible a tildes y
 * mayúsculas, por tokens (cada palabra debe aparecer en nombre, dirección o
 * teléfono). Sin dependencias de servidor: se usa en API y en cliente.
 */

export function normSearch(s: unknown): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function searchTokens(q: string): string[] {
  return normSearch(q)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function tokenDigits(t: string): string {
  return t.replace(/[^\d]/g, "");
}

/**
 * ¿El cliente matchea la búsqueda? Cada token debe aparecer en nombre,
 * dirección o (si tiene ≥2 dígitos) en el teléfono. Query vacía = true.
 */
export function customerMatches(
  c: { name?: string | null; phone?: string | null; address?: string | null },
  q: string
): boolean {
  const tokens = searchTokens(q);
  if (tokens.length === 0) return true;
  const nameHay = normSearch(`${c.name || ""} ${c.address || ""}`);
  const phoneDigits = String(c.phone || "").replace(/[^\d]/g, "");
  return tokens.every((t) => {
    const td = tokenDigits(t);
    if (td.length >= 2 && phoneDigits.includes(td)) return true;
    if (nameHay.includes(t)) return true;
    return false;
  });
}
