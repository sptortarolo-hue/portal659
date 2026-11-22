import { EmailInput, BankDeposit, BankParser } from "./types";
import { parseGalicia } from "./galicia";
import { parseSantander } from "./santander";
import { parseBBVA } from "./bbva";
import { parseBrubank } from "./brubank";
import { parseUala } from "./uala";
import { parseNaranjaX } from "./naranjax";
import { parseMercadoPago } from "./mercadopago";
import { parseMacro } from "./macro";
import { parseCuentaDNI } from "./cuentadni";
import { parseProvincia } from "./provincia";
import { parseGeneric } from "./generic";

const parsers: BankParser[] = [
  parseGalicia,
  parseSantander,
  parseBBVA,
  parseBrubank,
  parseUala,
  parseNaranjaX,
  parseMercadoPago,
  parseMacro,
  parseCuentaDNI,
  parseProvincia,
  parseGeneric, // fallback siempre al final
];

export function parseBankEmail(email: EmailInput): BankDeposit | null {
  for (const parser of parsers) {
    const result = parser(email);
    if (result) return result;
  }
  return null;
}

export const SUPPORTED_BANKS = [
  { id: "galicia", name: "Banco Galicia" },
  { id: "santander", name: "Santander" },
  { id: "bbva", name: "BBVA" },
  { id: "brubank", name: "Brubank" },
  { id: "uala", name: "Ualá" },
  { id: "naranjax", name: "Naranja X" },
  { id: "mercadopago", name: "Mercado Pago" },
  { id: "macro", name: "Banco Macro" },
  { id: "cuentadni", name: "Cuenta DNI (BNA)" },
  { id: "provincia", name: "Banco Provincia" },
  { id: "generic", name: "Otro banco (genérico)" },
];