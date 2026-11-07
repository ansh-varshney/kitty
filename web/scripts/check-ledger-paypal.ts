/** Ops: the platform's PayPal transactions over the last N days, grouped by type and status (PayPal lists them with a few hours' delay). */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const { paypalRequest } = await import("../lib/paypal/rest");
  const days = Number(process.argv[2] ?? 3);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  type T = { transaction_info: { transaction_event_code: string; transaction_status: string; transaction_amount: { value: string }; fee_amount?: { value: string }; transaction_initiation_date: string } };
  const groups = new Map<string, { n: number; sum: number; fees: number; last: string }>();
  for (let page = 1; page <= 20; page++) {
    const r = await paypalRequest<{ transaction_details: T[]; total_pages: number }>(
      "GET",
      `/v1/reporting/transactions?start_date=${start.toISOString().slice(0, 19)}Z&end_date=${end.toISOString().slice(0, 19)}Z&fields=transaction_info&page_size=500&page=${page}`,
    );
    for (const t of r.transaction_details ?? []) {
      const i = t.transaction_info;
      const k = `${i.transaction_event_code} status=${i.transaction_status}`;
      const g = groups.get(k) ?? { n: 0, sum: 0, fees: 0, last: "" };
      g.n++;
      g.sum += Number(i.transaction_amount.value);
      g.fees += Number(i.fee_amount?.value ?? 0);
      g.last = i.transaction_initiation_date > g.last ? i.transaction_initiation_date : g.last;
      groups.set(k, g);
    }
    if (page >= (r.total_pages ?? 1)) break;
  }
  console.log("codes: T0006/T0004=checkout payment, T1107=refund, T0000/T0001=payouts, T1503/T1501/T1502=holds/releases. Status: S done, P pending, V reversed, D denied");
  for (const [k, g] of [...groups.entries()].sort()) console.log(`${k.padEnd(22)} n=${String(g.n).padStart(3)}  amount ${g.sum.toFixed(2).padStart(10)}  fees ${g.fees.toFixed(2).padStart(8)}  latest ${g.last.slice(0, 16)}`);
}
main().catch((e) => console.error(String((e as Error).message).slice(0, 300)));
