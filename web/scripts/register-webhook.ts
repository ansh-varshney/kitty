/** Registers (or finds) the PayPal webhook for a public URL: `npx tsx scripts/register-webhook.ts https://kitty-web.onrender.com` */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const base = (process.argv[2] ?? "").replace(/\/$/, "");
  if (!base.startsWith("https://")) throw new Error("Pass the public https base URL");
  const { ensureWebhook, listWebhooks } = await import("../lib/paypal/webhooks");
  const id = await ensureWebhook(`${base}/api/paypal/webhook`);
  const all = await listWebhooks();
  console.log(`WEBHOOK_ID=${id}`);
  console.log(`registered webhooks on this app: ${all.length} (${all.map((w) => w.url).join(", ")})`);
}
main().catch((e) => { console.error(e.message, e.details ? JSON.stringify(e.details).slice(0, 400) : ""); process.exit(1); });
