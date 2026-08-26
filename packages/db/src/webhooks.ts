/**
 * Merchant webhooks.
 *
 * A merchant cannot poll our API to find out an instalment collected -- they
 * need to be told, and they need to be able to prove the message came from us.
 * Every delivery carries an HMAC signature over `timestamp.body`, which is the
 * shape Stripe popularised precisely because signing the body alone lets an
 * attacker replay a captured payload forever.
 *
 * Delivery is at-least-once. Receivers must key on `eventId` and treat a repeat
 * as a no-op; the alternative is at-most-once, which silently loses the
 * payment notification a merchant most needs.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { collections } from "./client.js";

export type WebhookEvent =
  | "plan.opened"
  | "installment.collected"
  | "installment.failed"
  | "plan.completed"
  | "plan.liquidated"
  | "settlement.paid";

export type WebhookPayload = {
  eventId: string;
  event: WebhookEvent;
  createdAt: string;
  merchantId: string;
  data: Record<string, unknown>;
};

/** Seconds a signature stays valid, to bound replay of a captured request. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signPayload(
  secret: string,
  body: string,
  timestamp: number
): string {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestamp}.${body}`);
  return `t=${timestamp},v1=${mac.digest("hex")}`;
}

/**
 * Verify a signature header. Exported so merchants can drop it straight into
 * their receiver rather than reimplementing it and getting it subtly wrong.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): { ok: true } | { ok: false; reason: string } {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=").map((s) => s.trim()) as [string, string])
  );
  const t = Number(parts.t);
  const provided = parts.v1;

  if (!(Number.isFinite(t) && provided)) {
    return { ok: false, reason: "malformed signature header" };
  }
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, which would leak via the exception path.
  if (a.length !== b.length) {
    return { ok: false, reason: "signature mismatch" };
  }
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

export type DeliveryResult = {
  delivered: boolean;
  status?: number;
  attempts: number;
  error?: string;
};

/**
 * Deliver one event, retrying transient failures.
 *
 * A 4xx other than 429 is the merchant rejecting the payload -- retrying that
 * just hammers a broken endpoint, so only 429 and 5xx and network errors are
 * retried.
 */
export async function deliverWebhook(
  merchantId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  opts: { maxAttempts?: number; fetchImpl?: typeof fetch; sleepMs?: (ms: number) => Promise<void> } = {}
): Promise<DeliveryResult> {
  const { merchants, events } = await collections();
  const merchant = await merchants.findOne({ merchantId });

  if (!(merchant?.webhookUrl && merchant.webhookSecret)) {
    return { delivered: false, attempts: 0, error: "no webhook configured" };
  }

  const payload: WebhookPayload = {
    eventId: randomUUID(),
    event,
    createdAt: new Date().toISOString(),
    merchantId,
    data,
  };
  const body = JSON.stringify(payload);
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 4;

  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const res = await doFetch(merchant.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "polaris-signature": signPayload(merchant.webhookSecret, body, timestamp),
          "polaris-event": event,
          "polaris-delivery-attempt": String(attempt),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      lastStatus = res.status;
      if (res.ok) {
        await events.insertOne({
          type: `webhook.${event}`,
          merchantId,
          payload: { eventId: payload.eventId, status: res.status, attempts: attempt },
          chainId: merchant.chainId,
          createdAt: new Date(),
        });
        return { delivered: true, status: res.status, attempts: attempt };
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) {
        lastError = `merchant rejected the delivery (${res.status})`;
        break;
      }
      lastError = `merchant endpoint returned ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }

    if (attempt < maxAttempts) {
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    }
  }

  await events.insertOne({
    type: `webhook.${event}.failed`,
    merchantId,
    payload: { eventId: payload.eventId, error: lastError, attempts: maxAttempts },
    chainId: merchant.chainId,
    createdAt: new Date(),
  });

  return { delivered: false, status: lastStatus, attempts: maxAttempts, error: lastError };
}
