import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, queryMany } from "@/lib/db";
import { parseBankEmail } from "@/lib/bank-parsers";
import { normalizeName } from "@/lib/bank-parsers/utils";

// Rate limiting simple en memoria
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests por minuto
const RATE_WINDOW = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Limpiar el body: si viene raw (con headers MIME), extraer solo el texto
  let rawText = body.text || body.plain || "";
  // Si el texto contiene headers MIME, extraer solo el body
  if (rawText.includes("Content-Type:") || rawText.includes("MIME-Version:")) {
    const parts = rawText.split(/\r?\n\r?\n/);
    if (parts.length > 1) {
      rawText = parts.slice(1).join("\n\n");
    }
  }
  // Limpiar quoted-printable
  rawText = rawText.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_match: string, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  const email = {
    from: body.from || body.sender || "",
    subject: body.subject || "",
    text: rawText,
    html: body.html || "",
    to: body.to || body.recipient || "",
    date: body.date || new Date().toISOString(),
  };

  // Parsear el email
  const deposit = parseBankEmail(email);
  if (!deposit) {
    // No se reconoció el banco, guardar en log y retornar OK
    console.log("[bank-email] Email no reconocido:", email.from, email.subject);
    return NextResponse.json({ ok: true, parsed: false });
  }

  // Determinar el vendor por el email destino (pagos+<slug>@portal659.com.ar)
  const toAddr = (email.to || "").toLowerCase();
  let vendorId: number | null = null;

  // Extraer slug del email destino
  const slugMatch = toAddr.match(/pagos\+([a-z0-9-]+)@/);
  if (slugMatch) {
    const vendor = await queryOne<{ id: number }>(
      "SELECT id FROM vendors WHERE slug = $1",
      [slugMatch[1]]
    );
    vendorId = vendor?.id ?? null;
  }

  // Si no se encontró por slug, buscar por bank_conciliation habilitado
  // (fallback: el email se reenvía a conciliacion@portal659.com.ar sin slug)
  if (!vendorId) {
    // Buscar vendors con conciliación habilitada que tengan este banco
    // Por ahora, guardar sin vendor (se asigna manualmente)
    console.log("[bank-email] No se pudo determinar vendor para:", toAddr);
  }

  // Guardar el depósito
  try {
    const result = await queryOne<{ id: number }>(
      `INSERT INTO bank_deposits (vendor_id, bank, amount, sender_name, operation_id, received_at, raw_subject, raw_body, match_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unmatched')
       ON CONFLICT (bank, operation_id) DO NOTHING
       RETURNING id`,
      [
        vendorId,
        deposit.bank,
        deposit.amount,
        deposit.sender_name,
        deposit.operation_id,
        deposit.received_at,
        email.subject,
        (email.text || "").slice(0, 5000),
      ]
    );

    if (!result) {
      // Duplicado (operation_id ya existe)
      return NextResponse.json({ ok: true, duplicate: true });
    }

    // Ejecutar matching si hay vendor
    if (vendorId) {
      await runMatching(vendorId, result.id, deposit);
    }

    return NextResponse.json({ ok: true, parsed: true, depositId: result.id });
  } catch (err) {
    console.error("[bank-email] Error guardando depósito:", err);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

async function runMatching(vendorId: number, depositId: number, deposit: any) {
  // Buscar pedidos pendientes de pago por transferencia en los últimos 7 días
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

  // Filtrar por monto exacto
  const amountMatches = candidates.filter(
    (o: any) => Math.abs(Number(o.total) - deposit.amount) < 0.01
  );

  if (amountMatches.length === 0) {
    // Sin match
    await query(
      "UPDATE bank_deposits SET match_confidence = 'unmatched' WHERE id = $1",
      [depositId]
    );
    return;
  }

  const depositSenderNorm = normalizeName(deposit.sender_name);

  // Verificar si el remitente coincide con algún candidato
  const senderMatches = amountMatches.filter((o: any) => {
    const orderNameNorm = normalizeName(o.customer_name);
    return orderNameNorm && depositSenderNorm && orderNameNorm === depositSenderNorm;
  });

  if (amountMatches.length === 1 && senderMatches.length === 1) {
    // Match exacto: un solo candidato y remitente coincide
    const order = amountMatches[0];
    await query(
      "UPDATE bank_deposits SET matched_order_id = $1, match_confidence = 'exact' WHERE id = $2",
      [order.id, depositId]
    );
    await query(
      "UPDATE orders SET payment_status = 'paid', paid_at = now() WHERE id = $1",
      [order.id]
    );
    // Notificación se envía desde el frontend o un job separado
  } else if (amountMatches.length === 1) {
    // Un solo candidato por monto, pero remitente no coincide
    await query(
      "UPDATE bank_deposits SET matched_order_id = $1, match_confidence = 'probable' WHERE id = $2",
      [amountMatches[0].id, depositId]
    );
  } else {
    // Varios candidatos
    await query(
      "UPDATE bank_deposits SET match_confidence = 'probable' WHERE id = $1",
      [depositId]
    );
  }
}