import { EmailInput, BankDeposit } from "./types";
import { parseAmount, extractSender, extractOperationId } from "./utils";

export function parseMercadoPago(email: EmailInput): BankDeposit | null {
  const from = email.from.toLowerCase();
  if (!from.includes("mercadopago") && !from.includes("mercadolibre")) return null;
  const text = (email.text || "") + " " + (email.subject || "");

  // Solo procesar emails de transferencias recibidas, no pagos con tarjeta
  const isTransfer = /transferencia|transferiste|te transfiri/i.test(text);
  if (!isTransfer) return null;

  const amountMatch = text.match(/(?:recibiste|ingres[oó]|acredit)[a-z]*.*?\$\s*([\d.,]+)/i)
    || text.match(/\$\s*([\d.,]+)/);
  if (!amountMatch) return null;

  const amount = parseAmount(amountMatch[1]);
  if (amount <= 0) return null;

  return {
    bank: "mercadopago",
    amount,
    sender_name: extractSender(text),
    operation_id: extractOperationId(text),
    received_at: email.date ? new Date(email.date) : new Date(),
  };
}