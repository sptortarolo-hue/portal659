import { EmailInput, BankDeposit } from "./types";
import { parseAmount, extractSender, extractOperationId } from "./utils";

export function parseGalicia(email: EmailInput): BankDeposit | null {
  if (!email.from.toLowerCase().includes("galicia")) return null;
  const text = (email.text || "") + " " + (email.subject || "");

  const amountMatch = text.match(/acredit[aó]d?[ao]?.*?\$\s*([\d.,]+)/i)
    || text.match(/\$\s*([\d.,]+)/);
  if (!amountMatch) return null;

  const amount = parseAmount(amountMatch[1]);
  if (amount <= 0) return null;

  const sender = extractSender(text);
  const opId = extractOperationId(text);

  return {
    bank: "galicia",
    amount,
    sender_name: sender,
    operation_id: opId,
    received_at: email.date ? new Date(email.date) : new Date(),
  };
}