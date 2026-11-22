import { queryMany } from "@/lib/db";
import { normalizeName } from "@/lib/bank-parsers/utils";

export interface MatchResult {
  confidence: "exact" | "probable" | "unmatched";
  orderId: number | null;
  candidates: Array<{ id: number; total: number; customer_name: string | null; created_at: string }>;
}

export async function matchDeposit(
  vendorId: number,
  amount: number,
  senderName: string | null
): Promise<MatchResult> {
  const candidates = await queryMany<any>(
    `SELECT id, total, customer_name, customer_phone, created_at
     FROM orders
     WHERE vendor_id = $1
       AND payment_method = 'transferencia'
       AND payment_status = 'pending'
       AND created_at > now() - interval '7 days'
     ORDER BY created_at DESC`,
    [vendorId]
  );

  const amountMatches = candidates.filter(
    (o: any) => Math.abs(Number(o.total) - amount) < 0.01
  );

  if (amountMatches.length === 0) {
    return { confidence: "unmatched", orderId: null, candidates: [] };
  }

  const depositSenderNorm = normalizeName(senderName);
  const senderMatches = amountMatches.filter((o: any) => {
    const orderNameNorm = normalizeName(o.customer_name);
    return orderNameNorm && depositSenderNorm && orderNameNorm === depositSenderNorm;
  });

  if (amountMatches.length === 1 && senderMatches.length === 1) {
    return {
      confidence: "exact",
      orderId: amountMatches[0].id,
      candidates: amountMatches.map((o: any) => ({
        id: o.id,
        total: Number(o.total),
        customer_name: o.customer_name,
        created_at: o.created_at,
      })),
    };
  }

  return {
    confidence: "probable",
    orderId: amountMatches.length === 1 ? amountMatches[0].id : null,
    candidates: amountMatches.map((o: any) => ({
      id: o.id,
      total: Number(o.total),
      customer_name: o.customer_name,
      created_at: o.created_at,
    })),
  };
}