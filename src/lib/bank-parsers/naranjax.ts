import { EmailInput, BankDeposit } from "./types";
import { parseAmount, extractSender, extractOperationId } from "./utils";

export function parseNaranjaX(email: EmailInput): BankDeposit | null {
  const from = email.from.toLowerCase();
  if (!from.includes("naranja")) return null;
  const text = (email.text || "") + " " + (email.subject || "");

  const amountMatch = text.match(/(?:acredit|ingres|transfer)[a-z]*.*?\$\s*([\d.,]+)/i)
    || text.match(/\$\s*([\d.,]+)/);
  if (!amountMatch) return null;

  const amount = parseAmount(amountMatch[1]);
  if (amount <= 0) return null;

  return {
    bank: "naranjax",
    amount,
    sender_name: extractSender(text),
    operation_id: extractOperationId(text),
    received_at: email.date ? new Date(email.date) : new Date(),
  };
}