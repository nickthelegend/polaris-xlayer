import { GATEWAY_URL } from "./config";

/**
 * The code a merchant hands to a customer.
 *
 * This is a Solana Pay *transaction request*: the QR carries a URL, and the
 * customer's wallet POSTs its own address to that URL to be handed a
 * transaction to sign. The merchant never builds the transaction and never
 * sees a key — which is the whole reason this app can be read-only.
 */

export type Mode = "later" | "full";

export type Charge = {
  orderId: string;
  requestUrl: string;
  solanaUrl: string;
  usdc: number;
  mode: Mode;
  installments: number;
  intervalSeconds: number;
};

/** Base units. The program counts in micro-USDC; a person counts in USDC. */
const BASE = 1_000_000;

export function newOrderId(now: number): string {
  return `order-${now}`;
}

export function buildCharge(opts: {
  merchant: string;
  usdc: number;
  mode: Mode;
  installments?: number;
  intervalSeconds?: number;
  now: number;
}): Charge {
  const installments = opts.installments ?? 4;
  const intervalSeconds = opts.intervalSeconds ?? 7 * 86_400;
  const orderId = newOrderId(opts.now);

  const params = new URLSearchParams({
    merchant: opts.merchant,
    amount: String(Math.round(opts.usdc * BASE)),
    mode: opts.mode,
  });
  if (opts.mode === "later") {
    params.set("installments", String(installments));
    params.set("interval", String(intervalSeconds));
  }

  const requestUrl = `${GATEWAY_URL}/pay/${orderId}?${params.toString()}`;

  /*
   * Solana Pay requires the request URL to be percent-encoded inside the
   * `solana:` URI. Handing the raw URL over means any `&` in it silently
   * truncates the request at the first parameter.
   */
  const solanaUrl = `solana:${encodeURIComponent(requestUrl)}`;

  return {
    orderId,
    requestUrl,
    solanaUrl,
    usdc: opts.usdc,
    mode: opts.mode,
    installments,
    intervalSeconds,
  };
}

/**
 * What the customer will be asked to repay, shown before the code is handed
 * over so the merchant is never quoting a number the program disagrees with.
 * Mirrors the program's ceiling division off one canonical ladder.
 */
export function quote(
  usdc: number,
  installments: number,
  intervalSeconds = 7 * 86_400,
  aprBps = 1_000,
) {
  /*
   * The gateway's `totalOwed`, term in seconds, reproduced exactly:
   *
   *   interest = principal * aprBps * term / (10_000 * 365 * 86_400)
   *
   * An earlier version of this used a term in *days* and floored differently,
   * and quoted a customer 25.19 / 6.29 where the checkout said 25.20 / 6.30.
   * A merchant reading a number off their own terminal that the program then
   * disagrees with is worse than showing no number at all.
   */
  const principal = BigInt(Math.round(usdc * BASE));
  const term = BigInt(installments) * BigInt(intervalSeconds);
  const interest = (principal * BigInt(aprBps) * term) / (10_000n * 365n * 86_400n);
  const total = principal + interest;
  const each = (total + BigInt(installments) - 1n) / BigInt(installments); // ceil

  /* Rounded to the two decimals actually displayed. `Figure` truncates, so a
     raw 6.297945 would render "6.29" beside a checkout reading "6.30". */
  const to2dp = (v: bigint) => Number((v + 5_000n) / 10_000n) * 10_000;

  return {
    total: to2dp(total),
    interest: to2dp(interest),
    each: to2dp(each),
    installments,
  };
}
