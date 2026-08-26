/** Typed failure modes for KeeperHub execution, so callers can branch on cause. */

export type KeeperHubErrorKind =
  | "auth" //            401/403 - bad or revoked kh_ key, or missing scope
  | "rate_limit" //      429 - 60 req/min per API key
  | "spend_cap" //       403 - organization daily spend cap hit
  | "validation" //      400 - bad field, bad encoding
  | "not_found" //       404
  | "would_revert" //    simulation says this call fails on current state
  | "insufficient_funds" // payer cannot cover the charge
  | "in_flight" //       our own earlier attempt is still being processed
  | "timeout" //         never reached a terminal status in the poll budget
  | "reverted" //        broadcast, mined, failed
  | "server" //          5xx
  | "unknown";

export class KeeperHubError extends Error {
  readonly kind: KeeperHubErrorKind;
  readonly status?: number;
  readonly field?: string;
  readonly details?: string;
  readonly executionId?: string;
  /** True when the same call is worth attempting again with fresh state. */
  readonly retryable: boolean;

  constructor(
    kind: KeeperHubErrorKind,
    message: string,
    opts: {
      status?: number;
      field?: string;
      details?: string;
      executionId?: string;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "KeeperHubError";
    this.kind = kind;
    this.status = opts.status;
    this.field = opts.field;
    this.details = opts.details;
    this.executionId = opts.executionId;
    this.retryable = opts.retryable ?? DEFAULT_RETRYABLE.has(kind);
  }
}

/**
 * Which failures are worth another attempt.
 *
 * `would_revert` and `insufficient_funds` are deliberately NOT retryable at
 * this layer: the chain state that caused them has to change first. Retrying a
 * revert on an unchanged state just burns rate limit. The collection scheduler
 * handles those by moving the charge into the dunning ladder instead, which
 * retries on a business schedule (hours/days) rather than a network one.
 */
const DEFAULT_RETRYABLE = new Set<KeeperHubErrorKind>([
  "rate_limit",
  "in_flight",
  "timeout",
  "server",
]);

export function isKeeperHubError(err: unknown): err is KeeperHubError {
  return err instanceof KeeperHubError;
}

/**
 * Failures that leave the on-chain outcome unknown.
 *
 * A revert or a validation error is definite: nothing was broadcast, and the
 * next attempt starts from a clean slate. A timeout or a 5xx is not -- the
 * request may have been received and may still be settling.
 *
 * This distinction decides whether the idempotency key may rotate. Rotating
 * after a definite failure is necessary, because KeeperHub caches failures and
 * a reused key would replay the old one forever. Rotating while the outcome is
 * unknown is the opposite mistake: the new key has no record, so the call is
 * executed again and the borrower is charged twice for one instalment.
 */
const INDEFINITE: ReadonlySet<KeeperHubErrorKind> = new Set([
  "in_flight",
  "timeout",
  "server",
]);

export function isIndefinite(kind: string | undefined): boolean {
  return kind !== undefined && INDEFINITE.has(kind as KeeperHubErrorKind);
}

/** Map an HTTP status + body onto a typed error. */
export function errorFromResponse(
  status: number,
  body: unknown
): KeeperHubError {
  const parsed = (body ?? {}) as {
    error?: string;
    field?: string;
    details?: string;
  };
  const message = parsed.error ?? `KeeperHub request failed (${status})`;
  const opts = { status, field: parsed.field, details: parsed.details };

  if (status === 401 || status === 403) {
    // The execute routes reuse 403 for the org spend cap, so disambiguate on
    // the message before falling back to an auth failure.
    const haystack = `${message} ${parsed.details ?? ""}`.toLowerCase();
    if (haystack.includes("cap") || haystack.includes("spend")) {
      return new KeeperHubError("spend_cap", message, opts);
    }
    return new KeeperHubError("auth", message, opts);
  }
  if (status === 429) {
    return new KeeperHubError("rate_limit", message, opts);
  }
  /*
   * 409 carries two conditions that mean opposite things.
   *
   * `idempotency_in_progress` says one of our own earlier attempts still holds
   * the lock and is very likely landing on chain. Treating it as terminal is
   * what this classifier used to do -- it fell through to `unknown` -- and the
   * result was a live instalment pushed into dunning while the charge behind it
   * succeeded, telling the borrower a payment failed that did not.
   *
   * `idempotency_conflict` is terminal for the key, though not for the call:
   * the key is bound to a different body and always will be, so it needs a new
   * one rather than another attempt.
   */
  if (status === 409) {
    const code = (body as { code?: string })?.code;
    const inFlight =
      code === "idempotency_in_progress" ||
      /already being processed/i.test(message);
    if (inFlight) {
      return new KeeperHubError("in_flight", message, opts);
    }
    return new KeeperHubError("validation", message, { ...opts, retryable: false });
  }
  if (status === 404) {
    return new KeeperHubError("not_found", message, opts);
  }
  if (status === 400) {
    return new KeeperHubError("validation", message, opts);
  }
  if (status >= 500) {
    return new KeeperHubError("server", message, opts);
  }
  return new KeeperHubError("unknown", message, opts);
}

/**
 * Classify a revert/simulation string into something the dunning logic can act
 * on. Substring matching is unavoidable here: the underlying reason is produced
 * by the target contract and the RPC, not by KeeperHub, so there is no code to
 * switch on.
 */
export function classifyFailure(reason: string | undefined): KeeperHubErrorKind {
  if (!reason) {
    return "unknown";
  }
  const r = reason.toLowerCase();
  if (
    r.includes("insufficient") ||
    r.includes("exceeds balance") ||
    r.includes("transfer amount exceeds")
  ) {
    return "insufficient_funds";
  }
  if (r.includes("revert") || r.includes("execution reverted")) {
    return "would_revert";
  }
  return "unknown";
}
