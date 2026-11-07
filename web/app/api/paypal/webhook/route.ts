import { verifyWebhook } from "@/lib/paypal/webhooks";
import { db } from "@/lib/db";

/**
 * PayPal webhook receiver (FR-SEC-7, FR-PP-2): verify first, store once (event id is unique),
 * always answer 200 quickly so PayPal doesn't retry forever.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: { id?: string; event_type?: string };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  let verified = false;
  if (webhookId) {
    try {
      verified = await verifyWebhook(req.headers, event, webhookId);
    } catch {
      verified = false;
    }
  }
  const d = await db();
  await d.query(
    `insert into webhook_events (event_id, event_type, verified, payload) values ($1, $2, $3, $4) on conflict (event_id) do nothing`,
    [event.id ?? null, event.event_type ?? "UNKNOWN", verified, raw],
  );
  return Response.json({ received: true, verified });
}
