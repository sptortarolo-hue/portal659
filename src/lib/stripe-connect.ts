/**
 * Stripe Connect — cobros online a la cuenta del comercio (alternativa a MP).
 *
 * Cada comercio conecta su propia cuenta de Stripe vía OAuth (cuentas Standard);
 * las señas se cobran con Checkout Sessions en modo "direct charge" sobre la
 * cuenta conectada: la plata cae directo al comercio, el portal nunca la toca
 * (0% comisión, mismo modelo que MP multi-market).
 *
 * Seguridad:
 *  - Solo se guarda `stripe_account_id` (acct_..., no es secreto) + fecha de
 *    conexión. NO se guardan tokens (los direct charges usan la SECRET del
 *    portal + header `Stripe-Account`).
 *  - El OAuth usa `state` firmado con HMAC (reusa signState/verifyState de
 *    mp-oauth: vendor_id|nonce|ts, 10 min) — evita CSRF y swap de comercios.
 *  - El webhook verifica firma con STRIPE_WEBHOOK_SECRET (stripe.webhooks).
 *  - NUNCA loguear claves ni el body crudo.
 */

import Stripe from "stripe";
import { signState } from "@/lib/mp-oauth";

/**
 * Llave maestra de Stripe (on/off global, espejo de MP_ENABLED).
 * Sin `STRIPE_ENABLED=1`, conexión y cobros Stripe están apagados aunque
 * existan las claves (el portal sigue 100% con MP/transferencia).
 */
export function isStripeEnabled(): boolean {
  return process.env.STRIPE_ENABLED === "1";
}

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) throw new Error("STRIPE_SECRET_KEY no configurada");
  if (!stripeClient) {
    stripeClient = new Stripe(key, { typescript: true });
  }
  return stripeClient;
}

const STRIPE_OAUTH_URL = "https://connect.stripe.com/oauth/authorize";

export function buildStripeConnectUrl(vendorId: string, redirectUri: string): string {
  const clientId = process.env.STRIPE_CLIENT_ID || "";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "read_write",
    redirect_uri: redirectUri,
    state: signState(vendorId),
  });
  return `${STRIPE_OAUTH_URL}?${params.toString()}`;
}

export async function exchangeStripeCode(
  code: string
): Promise<{ ok: boolean; error?: string; accountId?: string }> {
  const clientSecret = process.env.STRIPE_SECRET_KEY || "";
  try {
    const res = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_secret: clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.stripe_user_id) {
      return { ok: false, error: data?.error_description || `Stripe respondió ${res.status}` };
    }
    return { ok: true, accountId: String(data.stripe_user_id) };
  } catch {
    return { ok: false, error: "Error de conexión con Stripe" };
  }
}

export type DepositSessionInput = {
  stripeAccountId: string;
  amount: number;
  title: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Checkout Session de seña en la cuenta del comercio (direct charge).
 * Devuelve la URL de pago para pasarle al cliente por WhatsApp.
 */
export async function createDepositSession(input: DepositSessionInput): Promise<{ ok: boolean; url?: string; sessionId?: string; error?: string }> {
  if (!(input.amount > 0)) return { ok: false, error: "Monto de seña inválido" };
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "ars",
              unit_amount: Math.round(input.amount * 100),
              product_data: { name: input.title.slice(0, 120) },
            },
            quantity: 1,
          },
        ],
        metadata: input.metadata,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { stripeAccount: input.stripeAccountId }
    );
    if (!session.url) return { ok: false, error: "Stripe no devolvió URL de pago" };
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al crear el pago";
    return { ok: false, error: msg };
  }
}

export function verifyWebhookSignature(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET no configurada");
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
