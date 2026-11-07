import { paypalRequest } from "./rest";

/**
 * Subscriptions for Kitty Party and The Bowl (PRD §B13, §B15, §C1).
 * Kitty Party uses a $1 unit price with quantity, so each member's quantity = their monthly dollars.
 */

type Link = { rel: string; href: string };

export async function createProduct(name: string, description: string) {
  const res = await paypalRequest<{ id: string }>("POST", "/v1/catalogs/products", {
    body: { name, description, type: "SERVICE", category: "SOFTWARE" },
  });
  return res.id;
}

export async function createQuantityPlan(opts: {
  productId: string;
  name: string;
  intervalUnit: "DAY" | "WEEK" | "MONTH";
  unitPriceCents?: number;
}) {
  const unit = ((opts.unitPriceCents ?? 100) / 100).toFixed(2);
  const res = await paypalRequest<{ id: string; status: string }>("POST", "/v1/billing/plans", {
    body: {
      product_id: opts.productId,
      name: opts.name,
      status: "ACTIVE",
      quantity_supported: true,
      billing_cycles: [
        {
          frequency: { interval_unit: opts.intervalUnit, interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: unit, currency_code: "USD" } },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
    },
  });
  return { planId: res.id, status: res.status };
}

/** Creates a subscription waiting for the member's approval on PayPal. */
export async function createSubscription(opts: {
  planId: string;
  quantity: number;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
}) {
  const res = await paypalRequest<{ id: string; status: string; links: Link[] }>("POST", "/v1/billing/subscriptions", {
    body: {
      plan_id: opts.planId,
      quantity: String(opts.quantity),
      custom_id: opts.customId,
      application_context: {
        brand_name: "Kitty",
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    },
  });
  const approveUrl = res.links.find((l) => l.rel === "approve")?.href;
  return { subscriptionId: res.id, status: res.status, approveUrl };
}

export async function getSubscription(id: string) {
  return paypalRequest<{ id: string; status: string; quantity?: string; plan_id: string }>("GET", `/v1/billing/subscriptions/${id}`);
}
