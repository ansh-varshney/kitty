/** Shows the sandbox platform account's PayPal balance (payouts to bookers come from here). Run: npx tsx scripts/check-balance.ts */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const { paypalRequest } = await import("../lib/paypal/rest");
  try {
    const r = await paypalRequest<{ balances?: { currency: string; primary?: boolean; total_balance: { value: string }; available_balance?: { value: string }; withheld_balance?: { value: string } }[] }>("GET", "/v1/reporting/balances?currency_code=USD");
    for (const b of r.balances ?? []) console.log(`${b.currency}: total ${b.total_balance.value}, available ${b.available_balance?.value ?? "?"}, withheld ${b.withheld_balance?.value ?? "0"}`);
  } catch (e) {
    console.log("balance API:", String((e as Error).message).slice(0, 300));
  }
}
void main();
