import { EmailInput, BankDeposit } from "./types";
import { parseAmount, extractSender, extractOperationId } from "./utils";

export function parseBBVA(email: EmailInput): BankDeposit | null {
  if (!email.from.toLowerCase().includes("bbva")) return null;
  const text = (email.text || "") + " " + (email.subject || "");

  const amountMatch = text.match(/(?:acredit|ingres|transfer)[a-z]*.*?\$\s*([\d.,]+)/i)
    || text.match(/\$\s*([\d.,]+)/);
  if (!amountMatch) return null;

  const amount = parseAmount(amountMatch[1]);
  if (amount <= 0) return null;

  return {
    bank: "bbva",
    amount,
    sender_name: extractSender(text),
    operation_id: extractOperationId(text),
    received_at: email.date ? new Date(email.date) : new Date(),
  };
}