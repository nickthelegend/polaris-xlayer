/**
 * Merchant onboarding and API key issuance.
 *
 * Keys are shown once and stored only as a SHA-256 digest, so a database dump
 * cannot be replayed against the API. The prefix is kept in the clear purely so
 * a merchant can identify which key a dashboard row refers to without us being
 * able to reconstruct it.
 */

import { createHash, randomBytes } from "node:crypto";

import { collections } from "./client.js";
import type { MerchantDoc, MerchantStatus } from "./schema.js";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** `pk_live_` + 32 bytes of base64url. Prefixed so a leaked key is greppable. */
export function generateApiKey(live = false): string {
  return `pk_${live ? "live" : "test"}_${randomBytes(24).toString("base64url")}`;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export type OnboardResult = {
  merchantId: string;
  /** Returned once, never stored in this form. */
  apiKey: string;
  webhookSecret: string;
  keyPrefix: string;
};

export async function onboardMerchant(params: {
  name: string;
  walletAddress: string;
  payoutAddress?: string;
  webhookUrl?: string;
  chainId: number;
  live?: boolean;
}): Promise<OnboardResult | { error: string }> {
  const { merchants } = await collections();
  const wallet = params.walletAddress.toLowerCase();

  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return { error: "walletAddress must be a 20-byte hex address" };
  }

  const existing = await merchants.findOne({ walletAddress: wallet });
  if (existing) {
    // Re-onboarding would silently invalidate the live key and break every
    // checkout in flight. Rotation is a separate, explicit action.
    return { error: "This wallet is already registered. Use key rotation instead." };
  }

  const merchantId = `merch_${randomBytes(8).toString("hex")}`;
  const apiKey = generateApiKey(params.live);
  const webhookSecret = generateWebhookSecret();

  const doc: MerchantDoc = {
    merchantId,
    name: params.name,
    walletAddress: wallet,
    payoutAddress: (params.payoutAddress ?? params.walletAddress).toLowerCase(),
    apiKeyHash: hashApiKey(apiKey),
    webhookUrl: params.webhookUrl,
    webhookSecret,
    // New merchants start pending. Origination is gated on active, so an
    // unreviewed merchant cannot draw on protocol liquidity.
    status: "pending" as MerchantStatus,
    maxOrderValue: "500000000", // 500 units, conservative until reviewed
    totalSettled: "0",
    chainId: params.chainId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await merchants.insertOne(doc);

  return {
    merchantId,
    apiKey,
    webhookSecret,
    keyPrefix: apiKey.slice(0, 12),
  };
}

/** Resolve a merchant from a raw API key. Returns null when unknown. */
export async function merchantForApiKey(apiKey: string): Promise<MerchantDoc | null> {
  if (!apiKey) return null;
  const { merchants } = await collections();
  return await merchants.findOne({ apiKeyHash: hashApiKey(apiKey) });
}

/** Issue a new key and invalidate the old one atomically. */
export async function rotateApiKey(
  merchantId: string,
  live = false
): Promise<{ apiKey: string } | { error: string }> {
  const { merchants } = await collections();
  const apiKey = generateApiKey(live);
  const result = await merchants.updateOne(
    { merchantId },
    { $set: { apiKeyHash: hashApiKey(apiKey), updatedAt: new Date() } }
  );
  if (result.matchedCount === 0) {
    return { error: "Unknown merchant" };
  }
  return { apiKey };
}

export async function setMerchantStatus(
  merchantId: string,
  status: MerchantStatus
): Promise<boolean> {
  const { merchants } = await collections();
  const r = await merchants.updateOne(
    { merchantId },
    { $set: { status, updatedAt: new Date() } }
  );
  return r.matchedCount > 0;
}

/**
 * Settlement export for accounting.
 *
 * CSV rather than JSON because the consumer is a bookkeeper's spreadsheet, and
 * amounts are emitted as decimal strings so a spreadsheet does not coerce a
 * large base-unit integer into scientific notation.
 */
export async function settlementCsv(merchantId: string): Promise<string> {
  const { loans } = await collections();
  const docs = await loans.find({ merchantId }).sort({ createdAt: 1 }).toArray();

  const rows = [
    "order_id,loan_id,borrower,installment,due_at,amount,state,paid_at,transaction_hash",
  ];
  for (const loan of docs) {
    for (const i of loan.installments) {
      rows.push(
        [
          loan.orderId,
          loan.loanId,
          loan.borrower,
          i.index,
          i.dueAt.toISOString(),
          decimal(i.amountRaw, 6),
          i.state,
          i.paidAt?.toISOString() ?? "",
          i.transactionHash ?? "",
        ]
          .map(csvCell)
          .join(",")
      );
    }
  }
  return `${rows.join("\n")}\n`;
}

function decimal(raw: string, decimals: number): string {
  const v = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  return `${v / base}.${(v % base).toString().padStart(decimals, "0")}`;
}

function csvCell(value: unknown): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
