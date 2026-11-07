/**
 * Ops: refill the platform's SANDBOX balance, which pays bookers (Payouts). Each capture arrives minus PayPal's
 * fee while bookers are paid in full, so the balance slowly drains (Phase 1 finding). Uses PayPal's sandbox test card.
 * Run from web/:  npm run float:topup -- 3000      (dollars; default 2000, max 10000)
 * Then check with:  npx tsx scripts/check-payout.ts
 */
import { loadEnv } from "../lib/load-env";

loadEnv();

async function main() {
  if ((process.env.PAYPAL_ENVIRONMENT ?? "SANDBOX") !== "SANDBOX") throw new Error("Sandbox only.");
  const dollars = Math.min(Math.max(Number(process.argv[2] ?? 2000) || 2000, 1), 10_000);
  const { testCardPayment } = await import("../lib/paypal/holds");
  let left = Math.round(dollars * 100);
  while (left > 0) {
    const cents = Math.min(left, 150_000); // $1,500 per test payment
    const r = await testCardPayment({ cents, customId: "float:topup" });
    console.log(`+$${(cents / 100).toFixed(2)} test-card payment: ${r.status} (capture ${r.captureId})`);
    left -= cents;
  }
}
main().catch((e) => {
  console.error(String((e as Error).message).slice(0, 300));
  process.exit(1);
});
