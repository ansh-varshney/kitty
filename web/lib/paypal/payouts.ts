import { randomUUID } from "node:crypto";
import { paypalRequest } from "./rest";
import { toPayPalValue, type Cents } from "../money";

/** Payouts: pay the booker, people owed, help requests, withdrawals (PRD §C1). REST only. */

export type PayoutItem = { email: string; cents: Cents; note: string; itemId: string };

type PayoutBatch = {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: { payout_item_id: string; transaction_status: string; payout_item: { receiver: string } }[];
};

export async function sendPayout(items: PayoutItem[], subject: string, batchId = `kitty_${randomUUID().replace(/-/g, "").slice(0, 20)}`) {
  const res = await paypalRequest<PayoutBatch>("POST", "/v1/payments/payouts", {
    requestId: batchId,
    body: {
      sender_batch_header: { sender_batch_id: batchId, email_subject: subject },
      items: items.map((i) => ({
        recipient_type: "EMAIL",
        receiver: i.email,
        amount: { value: toPayPalValue(i.cents), currency: "USD" },
        note: i.note,
        sender_item_id: i.itemId,
      })),
    },
  });
  return { batchId: res.batch_header.payout_batch_id, status: res.batch_header.batch_status };
}

export async function getPayout(batchId: string) {
  const res = await paypalRequest<PayoutBatch>("GET", `/v1/payments/payouts/${batchId}`);
  return {
    batchId,
    status: res.batch_header.batch_status,
    items: (res.items ?? []).map((i) => ({ id: i.payout_item_id, status: i.transaction_status, receiver: i.payout_item.receiver })),
  };
}
