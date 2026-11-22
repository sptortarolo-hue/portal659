import { EmailInput, BankDeposit } from "./types";
import { parseAmount, extractSender, extractOperationId } from "./utils";

export function parseGeneric(email: EmailInput): BankDeposit | null {
  const text = (email.text || "") + " " + (email.subject || "");

  const amountMatch = text.match(/\$\s*([\d.,]+)/);
  if (!amountMatch) return null;

  const amount = parseAmount(amountMatch[1]);
  if (amount <= 0) return null;

  return {
    bank: "generic",
    amount,
    sender_name: extractSender(text),
    operation_id: extractOperationId(text),
    received_at: email.date ? new Date(email.date) : new Date(),
  };
}