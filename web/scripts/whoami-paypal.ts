/** Ops: which sandbox business account this app's keys belong to (creates an unpaid $1 order; no money moves). */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const { paypalRequest } = await import("../lib/paypal/rest");
  const o = await paypalRequest<{ id: string }>("POST", "/v2/checkout/orders", { body: { intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: "1.00" } }] } });
  const g = await paypalRequest<{ purchase_units: { payee?: { email_address?: string; merchant_id?: string } }[] }>("GET", `/v2/checkout/orders/${o.id}`);
  console.log("app's PayPal account:", g.purchase_units[0]?.payee?.email_address, "| merchant id:", g.purchase_units[0]?.payee?.merchant_id);
}
main().catch((e) => console.error(String((e as Error).message).slice(0, 200)));
