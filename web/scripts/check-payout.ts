/**
 * Ops check: the platform's sandbox balance and whether Payouts work right now (bookers are paid from here).
 * Sends two tiny sandbox payouts to Ava. Run from web/:  npx tsx scripts/check-payout.ts [dollars ...]
 */
import { loadEnv } from "../lib/load-env";

loadEnv();

async function main() {
  const { paypalRequest } = await import("../lib/paypal/rest");
  const { sendPayout } = await import("../lib/paypal/payouts");
  try {
    const r = await paypalRequest<{ balances?: { currency: string; total_balance: { value: string }; available_balance?: { value: string } }[] }>("GET", "/v1/reporting/balances?currency_code=USD");
    for (const b of r.balances ?? []) console.log(`balance ${b.currency}: total ${b.total_balance.value}, available ${b.available_balance?.value ?? "?"}`);
  } catch (e) {
    console.log("balance API:", String((e as Error).message).slice(0, 200));
  }
  const list = process.argv.slice(2).map((d) => Math.round(Number(d) * 100)).filter((c) => c > 0);
  for (const cents of list.length ? list : [100, 8000]) {
    try {
      const r = await sendPayout([{ email: "ava.kt26@personal.example.com", cents, note: "Kitty payout check", itemId: `chk-${Date.now()}` }], "Kitty payout check");
      console.log(`payout $${(cents / 100).toFixed(2)}: OK (batch ${r.batchId})`);
    } catch (e) {
      const err = e as { message: string; details?: unknown };
      console.log(`payout $${(cents / 100).toFixed(2)}: FAIL ${err.message} ${JSON.stringify(err.details ?? "").slice(0, 300)}`);
    }
  }
}
void main();
