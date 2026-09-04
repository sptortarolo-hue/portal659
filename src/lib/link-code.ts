import { randomBytes } from "node:crypto";

// Código corto y legible (6 caracteres alfanuméricos en mayúscula) para que el
// repartidor lo teclee desde la app y se vincule al comercio.
export function generateLinkCode(): string {
  const alphabet = "ABCDEFGHJKLMNPRSTUVWXYZ23456789"; // sin I/O/0/1 para evitar confusiones
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}