import { randomUUID } from "node:crypto";
import { getAppToken } from "../paypal/rest";
import { authorizeHold, captureHold, createTestCardHold, createWalletHold, refundCapture, voidHold } from "../paypal/holds";
import { getPayout, sendPayout } from "../paypal/payouts";
import { createProduct, createQuantityPlan, createSubscription, getSubscription } from "../paypal/subscriptions";
import { ensureWebhook, simulateWebhook } from "../paypal/webhooks";
import { loginUrl } from "../paypal/login";
import { generate, generateJson } from "../ai/gemini";
import { db } from "../db";
import { baseUrl, env } from "../env";
import { toCents } from "../money";

/**
 * Phase 0 spike steps (PRD §D1 Phase 0). Each proves one integration works and returns
 * plain data for the dev console. Nothing here shows secrets.
 */

export type StepResult = { ok: boolean; summary: string; data?: unknown; needsYou?: { label: string; url: string } };
type Step = { title: string; auto: boolean; run: () => Promise<StepResult> };

const DEMO_PAYOUT_EMAIL = process.env.SPIKE_PAYOUT_EMAIL ?? "shopper.av26@personal.example.com";

export const STEPS: Record<string, Step> = {
  token: {
    title: "PayPal app token",
    auto: true,
    run: async () => {
      const t = await getAppToken();
      return { ok: t.length > 20, summary: "Got a sandbox access token (not shown)." };
    },
  },
  database: {
    title: "Database + migrations",
    auto: true,
    run: async () => {
      const d = await db();
      const [row] = await d.query<{ n: number }>("select count(*)::int as n from spike_runs");
      return { ok: true, summary: `Connected to ${d.kind}; spike_runs has ${row.n} rows.`, data: { kind: d.kind } };
    },
  },
  gemini: {
    title: "Gemini fast + smart, with fallback",
    auto: true,
    run: async () => {
      const t0 = Date.now();
      const fast = await generate('Reply with exactly the word "purr".', { tier: "fast", template: () => "purr (template)" });
      const t1 = Date.now();
      const smart = await generateJson<{ what: string; when: string }>(
        'Extract a plan from this chat message as JSON {"what": string, "when": string}: "cabin trip in december??"',
        { tier: "smart" },
      );
      const t2 = Date.now();
      return {
        ok: true,
        summary: `Fast: "${fast.text.trim()}" via ${fast.model} in ${t1 - t0} ms. Smart JSON via ${smart.model} in ${t2 - t1} ms.`,
        data: { fast: { model: fast.model, ms: t1 - t0, fallback: fast.fallback }, smart: { model: smart.model, ms: t2 - t1, parsed: smart.data } },
      };
    },
  },
  cardHoldCycle: {
    title: "Hold → partial charge → partial refund (server-side test card)",
    auto: true,
    run: async () => {
      const hold = await createTestCardHold({ cents: toCents("20.00"), referenceId: "spike-plan", customId: `spike-${randomUUID().slice(0, 8)}` });
      if (!hold.authorizationId) return { ok: false, summary: "Order created but no authorization came back.", data: hold };
      const capture = await captureHold(hold.authorizationId, toCents("12.34"), true);
      const refund = await refundCapture(capture.captureId, toCents("2.00"));
      return {
        ok: capture.status === "COMPLETED" && (refund.status === "COMPLETED" || refund.status === "PENDING"),
        summary: `Held $20.00, charged $12.34 (rest released), refunded $2.00. Capture ${capture.status}, refund ${refund.status}.`,
        data: { hold, capture, refund },
      };
    },
  },
  cardHoldVoid: {
    title: "Hold → release (void)",
    auto: true,
    run: async () => {
      const hold = await createTestCardHold({ cents: toCents("5.00"), referenceId: "spike-void", customId: `spike-${randomUUID().slice(0, 8)}` });
      if (!hold.authorizationId) return { ok: false, summary: "No authorization came back.", data: hold };
      const res = await voidHold(hold.authorizationId);
      return { ok: res.status === "VOIDED", summary: `Held $5.00, then released it. Status: ${res.status}.`, data: { hold, ...res } };
    },
  },
  payout: {
    title: "Payout $1 to a sandbox personal account",
    auto: true,
    run: async () => {
      const sent = await sendPayout([{ email: DEMO_PAYOUT_EMAIL, cents: 100, note: "Kitty spike", itemId: "spike-1" }], "Kitty test payout");
      await new Promise((r) => setTimeout(r, 3000));
      const status = await getPayout(sent.batchId);
      return { ok: true, summary: `Payout batch ${status.status}; item ${status.items[0]?.status ?? "pending"}.`, data: status };
    },
  },
  walletHold: {
    title: "Hold with a PayPal account (needs your approval on PayPal)",
    auto: false,
    run: async () => {
      const base = baseUrl();
      const { orderId, approveUrl } = await createWalletHold({
        cents: toCents("15.00"),
        referenceId: "spike-wallet",
        customId: `spike-${randomUUID().slice(0, 8)}`,
        description: "Kitty test hold (sandbox)",
        returnUrl: `${base}/api/dev/return?kind=hold`,
        cancelUrl: `${base}/dev?cancelled=1`,
      });
      return { ok: true, summary: `Order ${orderId} is waiting for approval.`, data: { orderId }, needsYou: { label: "Approve on PayPal (sandbox buyer login)", url: approveUrl } };
    },
  },
  subscription: {
    title: "Kitty Party subscription with quantity (needs your approval)",
    auto: false,
    run: async () => {
      const base = baseUrl();
      const productId = await createProduct("Kitty Party (spike)", "Squad savings, $1 per unit");
      const plan = await createQuantityPlan({ productId, name: "Goa fund (daily demo)", intervalUnit: "DAY" });
      const sub = await createSubscription({
        planId: plan.planId,
        quantity: 10,
        customId: "spike-party",
        returnUrl: `${base}/api/dev/return?kind=sub`,
        cancelUrl: `${base}/dev?cancelled=1`,
      });
      return {
        ok: Boolean(sub.approveUrl),
        summary: `Plan ${plan.planId} (${plan.status}); subscription ${sub.subscriptionId} for $10/day waiting for approval.`,
        data: { productId, plan, subscriptionId: sub.subscriptionId },
        needsYou: sub.approveUrl ? { label: "Approve the subscription on PayPal", url: sub.approveUrl } : undefined,
      };
    },
  },
  login: {
    title: "Log in with PayPal (needs the app setting + your login)",
    auto: false,
    run: async () => {
      const url = loginUrl(`${baseUrl()}/api/auth/paypal/callback`, randomUUID());
      return { ok: true, summary: "Login link ready.", needsYou: { label: "Log in with a sandbox personal account", url } };
    },
  },
  webhook: {
    title: "Register webhook + send a test event (hosted URL only)",
    auto: false,
    run: async () => {
      const base = baseUrl();
      if (!base.startsWith("https://")) return { ok: false, summary: `Needs a public https URL; this app runs at ${base}. Run it on Render.` };
      const id = env().PAYPAL_WEBHOOK_ID ?? (await ensureWebhook(`${base}/api/paypal/webhook`));
      const sim = await simulateWebhook(id, "PAYMENT.CAPTURE.COMPLETED");
      return { ok: true, summary: `Webhook ${id} registered; test event ${sim.id} sent. Check the webhook log below in a few seconds.`, data: { webhookId: id } };
    },
  },
};

export async function runStep(name: string): Promise<StepResult> {
  const step = STEPS[name];
  if (!step) return { ok: false, summary: `Unknown step: ${name}` };
  let result: StepResult;
  try {
    result = await step.run();
  } catch (err) {
    const e = err as { message?: string; debugId?: string; details?: unknown; result?: unknown };
    result = { ok: false, summary: e.message ?? String(err), data: { debugId: e.debugId, details: e.details ?? e.result } };
  }
  try {
    const d = await db();
    await d.query("insert into spike_runs (step, ok, result) values ($1, $2, $3)", [name, result.ok, JSON.stringify(result)]);
  } catch {
    /* logging must never break a step */
  }
  return result;
}

export { authorizeHold, getSubscription };
