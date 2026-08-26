import { GATEWAY_URL } from "./config";

/**
 * Why a credit line is the size it is.
 *
 * Every input is public, so the reasons can be too. A credit decision the
 * borrower cannot interrogate is the thing everyone hates about credit
 * scoring, and there is no reason to reproduce it here.
 */
export type Underwriting = {
  score: number;
  creditLimit: string;
  reasons: string[];
  alreadyOpen: boolean;
  signature: string | null;
};

/**
 * Ask the gateway to open a line for this wallet.
 *
 * Idempotent at the program level -- a borrower with any record is refused a
 * second attestation -- so this is safe to call on every cold start, and the
 * gateway returns the existing line rather than an error.
 */
export async function requestUnderwriting(
  borrower: string,
  signal?: AbortSignal,
): Promise<Underwriting> {
  const res = await fetch(`${GATEWAY_URL}/underwrite`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ borrower }),
    ...(signal ? { signal } : {}),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error ?? `The underwriter refused (${res.status}).`);
  }
  return {
    score: payload.score,
    creditLimit: payload.creditLimit,
    reasons: payload.reasons ?? [],
    alreadyOpen: Boolean(payload.alreadyOpen),
    signature: payload.signature ?? null,
  };
}
