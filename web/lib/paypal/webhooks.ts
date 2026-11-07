import { paypalRequest } from "./rest";

/** PayPal webhooks (PRD §C1, FR-SEC-7): every event is verified before it changes state. */

export const WEBHOOK_EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
] as const;

export async function verifyWebhook(headers: Headers, rawEvent: unknown, webhookId: string): Promise<boolean> {
  const h = (n: string) => headers.get(n) ?? "";
  const res = await paypalRequest<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: rawEvent,
    },
  });
  return res.verification_status === "SUCCESS";
}

export async function listWebhooks() {
  const res = await paypalRequest<{ webhooks: { id: string; url: string }[] }>("GET", "/v1/notifications/webhooks");
  return res.webhooks;
}

/** Registers (or finds) the webhook for this app's URL. Returns its id (store it as PAYPAL_WEBHOOK_ID). */
export async function ensureWebhook(url: string): Promise<string> {
  const existing = (await listWebhooks()).find((w) => w.url === url);
  if (existing) return existing.id;
  const res = await paypalRequest<{ id: string }>("POST", "/v1/notifications/webhooks", {
    body: { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) },
  });
  return res.id;
}

/** Asks PayPal to send a sample event to our webhook (sandbox testing). */
export async function simulateWebhook(webhookId: string, eventType: string) {
  return paypalRequest<{ id: string }>("POST", "/v1/notifications/simulate-event", {
    body: { webhook_id: webhookId, event_type: eventType, resource_version: "2.0" },
  });
}
