export interface EmailInput {
  from: string;
  subject: string;
  text: string;
  html?: string;
  to: string;
  date?: string;
}

export interface BankDeposit {
  bank: string;
  amount: number;
  sender_name: string | null;
  operation_id: string | null;
  received_at: Date;
}

export type BankParser = (email: EmailInput) => BankDeposit | null;