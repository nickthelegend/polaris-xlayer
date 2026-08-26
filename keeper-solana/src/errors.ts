/**
 * Why a charge failed.
 *
 * The kind drives the branch, not the attempt count. A borrower who is short
 * needs a business schedule measured in days; a loan whose state rejects the
 * call will never be fixed by waiting; a keeper wallet out of SOL is nobody's
 * problem but ours and must never reach a customer.
 *
 * This is the EVM taxonomy re-derived for Solana rather than translated. Two
 * kinds genuinely change shape. On EVM, `auth` meant our KeeperHub credentials
 * were wrong and `spend_cap` meant the platform's own limit stopped us — both
 * purely operator-side. Here the equivalent surface is the SPL delegation, and
 * losing it is the *borrower's* action, not ours: they revoked it, or another
 * app took the single delegate slot on the same token account. That is worth
 * telling them about, so it gets its own kind and its own ladder rather than
 * being filed under "operator problem, stay quiet".
 */
export type FailureKind =
  /** The borrower does not have the money. The dominant failure in a book. */
  | "insufficient_funds"
  /** Delegation revoked, or taken over by another app. Borrower must re-approve. */
  | "delegation_lost"
  /** Delegated amount no longer covers the installment. Borrower must re-approve. */
  | "delegation_exhausted"
  /** Program state rejects the call. Waiting will not fix it. */
  | "would_revert"
  /** Ours: keeper wallet out of SOL, bad RPC credentials, misconfiguration. */
  | "operator"
  /** Blockhash expired, RPC throttled, node behind. Worth another go. */
  | "transient"
  /** Sent, outcome unknown. The one case where the key must NOT rotate. */
  | "indefinite";

export type ClassifiedError = {
  kind: FailureKind;
  message: string;
  /** Anchor error name when we could recover one. */
  code?: string;
  logs?: string[];
};

/** Anchor errors whose cause is program state, not money. */
const STATE_ERRORS = new Set([
  "LoanNotActive",
  "NotDue",
  "NotLiquidatable",
  "SubscriptionNotActive",
  "PlanNotActive",
  "ZeroAmount",
  "AlreadySubscribed",
  "MerchantNotEligible",
  "ExceedsCreditLimit",
  "TokenOwnerMismatch",
  "MintMismatch",
  "OrderHashMismatch",
]);

/**
 * A charge that timed out is not a failure — it is an unknown.
 *
 * This distinction is the entire reason the EVM keeper tracked idempotency
 * keys per attempt: a timed-out charge may still be settling, and treating it
 * as a definite failure is how a borrower gets charged twice for one
 * installment.
 */
export function isIndefinite(kind: FailureKind | undefined): boolean {
  return kind === "indefinite" || kind === "transient";
}

export function classify(err: unknown): ClassifiedError {
  const anyErr = err as any;
  const logs: string[] | undefined = anyErr?.logs ?? anyErr?.transactionLogs;
  const raw = String(anyErr?.message ?? anyErr ?? "unknown error");
  const haystack = `${raw}\n${(logs ?? []).join("\n")}`;

  // Anchor surfaces the error name in the logs as "Error Code: <Name>".
  const codeMatch = haystack.match(/Error Code: (\w+)/);
  const code = codeMatch?.[1];

  const of = (kind: FailureKind, message = raw): ClassifiedError => ({
    kind,
    message,
    code,
    logs,
  });

  if (code === "NotDelegated") {
    return of(
      "delegation_lost",
      "The borrower's token account is no longer delegated to Polaris. An SPL token account holds exactly one delegate, so this is either a deliberate revoke or another app taking the slot.",
    );
  }
  if (code === "InsufficientDelegation") {
    return of(
      "delegation_exhausted",
      "The standing delegation no longer covers what is due. The borrower has to re-approve.",
    );
  }
  if (code && STATE_ERRORS.has(code)) return of("would_revert");

  // SPL Token: 0x1 is insufficient funds on the source account.
  if (
    /insufficient funds|insufficient lamports|custom program error: 0x1\b/i.test(haystack) &&
    !/0x17|0x19/.test(haystack)
  ) {
    // An out-of-SOL keeper reads the same way at a glance and must not be
    // confused with a borrower who is short — one is our bill to pay.
    if (/insufficient lamports|Transfer: insufficient/i.test(haystack)) {
      return of("operator", "The keeper wallet is out of SOL.");
    }
    return of("insufficient_funds", "The borrower's balance does not cover the installment.");
  }

  if (/blockhash not found|block height exceeded|BlockhashNotFound/i.test(haystack)) {
    return of("transient", "The blockhash expired before the transaction landed.");
  }
  if (/429|rate.?limit|too many requests|503|502|timed? ?out|ETIMEDOUT|ECONNRESET/i.test(haystack)) {
    return of("transient", raw);
  }
  if (/already been processed|AlreadyProcessed/i.test(haystack)) {
    // The runtime rejecting a duplicate signature is replay protection doing
    // its job, not a failure: the original landed.
    return of("indefinite", "Already processed — the original transaction landed.");
  }
  if (/unauthorized|invalid api key|401|403/i.test(haystack)) {
    return of("operator", "The RPC endpoint rejected our credentials.");
  }

  return of("would_revert", raw);
}
