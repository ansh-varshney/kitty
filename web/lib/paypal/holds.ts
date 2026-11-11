import { randomUUID } from "node:crypto";
import {
  CheckoutPaymentIntent,
  PaypalExperienceUserAction,
  PaypalWalletContextShippingPreference,
  type Order,
} from "@paypal/paypal-server-sdk";
import { orders, payments } from "./sdk";
import { usd, type Cents } from "../money";

/**
 * Holds = PayPal authorizations (PRD §B9 "Paw in", §C1). Kitty never captures more than
 * the authorized amount (FR-SEC-3). Every call carries an idempotency key (FR-PP-1).
 */

export type HoldRef = { orderId: string; authorizationId?: string; status?: string; expiresAt?: string };

/** PayPal's published sandbox test card (developer.paypal.com card testing page). Demo World only. */
export const SANDBOX_TEST_CARD = { number: "4012888888881881", expiry: "2030-12", securityCode: "123", name: "Kitty Demo" };

function firstAuthorization(order: Order) {
  return order.purchaseUnits?.[0]?.payments?.authorizations?.[0];
}

/**
 * Wallet hold: creates an AUTHORIZE order; the member approves it on PayPal (payer-action link),
 * then we call authorizeHold() when they come back.
 */
export async function createWalletHold(opts: {
  cents: Cents;
  referenceId: string;
  customId: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ orderId: string; approveUrl: string }> {
  const { result } = await orders().createOrder({
    paypalRequestId: randomUUID(),
    body: {
      intent: CheckoutPaymentIntent.Authorize,
      purchaseUnits: [
        { referenceId: opts.referenceId, customId: opts.customId, description: opts.description, amount: usd(opts.cents) },
      ],
      paymentSource: {
        paypal: {
          experienceContext: {
            brandName: "Kitty",
            shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
            userAction: PaypalExperienceUserAction.Continue,
            returnUrl: opts.returnUrl,
            cancelUrl: opts.cancelUrl,
          },
        },
      },
    },
  });
  const approveUrl = result.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!result.id || !approveUrl) throw new Error("PayPal did not return an approval link");
  return { orderId: result.id, approveUrl };
}

/** After the member approves on PayPal: turn the approved order into a hold. */
export async function authorizeHold(orderId: string): Promise<HoldRef> {
  const { result } = await orders().authorizeOrder({ id: orderId, paypalRequestId: randomUUID() });
  const auth = firstAuthorization(result);
  return { orderId, authorizationId: auth?.id, status: auth?.status, expiresAt: auth?.expirationTime };
}

/**
 * Server-side card hold with a PayPal sandbox test card: no popup. Used only for Demo World's
 * simulated friends (PRD FR-DEMO-4). Requires card processing on the sandbox app.
 */
export async function createTestCardHold(opts: { cents: Cents; referenceId: string; customId: string }): Promise<HoldRef> {
  const { result } = await orders().createOrder({
    paypalRequestId: randomUUID(),
    body: {
      intent: CheckoutPaymentIntent.Authorize,
      purchaseUnits: [{ referenceId: opts.referenceId, customId: opts.customId, amount: usd(opts.cents) }],
      paymentSource: { card: SANDBOX_TEST_CARD },
    },
  });
  const existing = firstAuthorization(result);
  if (existing?.id) {
    return { orderId: result.id!, authorizationId: existing.id, status: existing.status, expiresAt: existing.expirationTime };
  }
  return authorizeHold(result.id!);
}

/** Charge part (or all) of a hold. finalCapture releases whatever is left. */
export async function captureHold(authorizationId: string, cents: Cents, finalCapture = true) {
  const { result } = await payments().captureAuthorizedPayment({
    authorizationId,
    paypalRequestId: randomUUID(),
    body: { amount: usd(cents), finalCapture },
  });
  return { captureId: result.id!, status: result.status };
}

/** Release a hold that won't be used. */
export async function voidHold(authorizationId: string) {
  await payments().voidPayment({ authorizationId, paypalRequestId: randomUUID() });
  const { result } = await payments().getAuthorizedPayment({ authorizationId });
  return { status: result.status };
}

/**
 * One-off payment (Treat Jar top-up, paying back a leftover, overruns): CAPTURE order.
 * Real users approve on PayPal; demo users pay server-side with the sandbox test card.
 */
export async function createCheckout(opts: { cents: number; customId: string; description: string; returnUrl: string; cancelUrl: string }) {
  const { result } = await orders().createOrder({
    paypalRequestId: randomUUID(),
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [{ customId: opts.customId, description: opts.description, amount: usd(opts.cents) }],
      paymentSource: {
        paypal: {
          experienceContext: {
            brandName: "Kitty",
            shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
            userAction: PaypalExperienceUserAction.PayNow,
            returnUrl: opts.returnUrl,
            cancelUrl: opts.cancelUrl,
          },
        },
      },
    },
  });
  const approveUrl = result.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!result.id || !approveUrl) throw new Error("PayPal did not return an approval link");
  return { orderId: result.id, approveUrl };
}

export async function captureCheckout(orderId: string) {
  let order: Order;
  try {
    ({ result: order } = await orders().captureOrder({ id: orderId, paypalRequestId: randomUUID() }));
  } catch (e) {
    // Coming back twice (a refresh) must not look like a failure: the money already moved, once.
    if (!/ORDER_ALREADY_CAPTURED/.test(`${(e as Error).message} ${JSON.stringify(e)}`)) throw e;
    ({ result: order } = await orders().getOrder({ id: orderId }));
  }
  const unit = order.purchaseUnits?.[0];
  const cap = unit?.payments?.captures?.[0];
  // PayPal puts custom_id on the capture in this reply, not on the purchase unit (owner test, 9 Nov: a paid top-up was never credited).
  const customId = cap?.customId ?? unit?.customId ?? (await orders().getOrder({ id: orderId })).result.purchaseUnits?.[0]?.customId;
  return { captureId: cap?.id, status: cap?.status, cents: cap?.amount ? Math.round(Number(cap.amount.value) * 100) : 0, customId };
}

export async function testCardPayment(opts: { cents: number; customId: string }) {
  const { result } = await orders().createOrder({
    paypalRequestId: randomUUID(),
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [{ customId: opts.customId, amount: usd(opts.cents) }],
      paymentSource: { card: SANDBOX_TEST_CARD },
    },
  });
  const cap = result.purchaseUnits?.[0]?.payments?.captures?.[0];
  if (cap?.id) return { orderId: result.id!, captureId: cap.id, status: cap.status };
  const done = await captureCheckout(result.id!);
  return { orderId: result.id!, captureId: done.captureId, status: done.status };
}

/** Partial or full refund of a capture (leftovers, tag-alongs, dropouts). */
export async function refundCapture(captureId: string, cents: Cents) {
  const { result } = await payments().refundCapturedPayment({
    captureId,
    paypalRequestId: randomUUID(),
    body: { amount: usd(cents) },
  });
  return { refundId: result.id!, status: result.status };
}
