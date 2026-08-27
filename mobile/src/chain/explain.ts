/**
 * Turning a failure into a sentence a borrower can act on.
 *
 * Split out from `actions.ts` so it can be tested on its own: that module
 * pulls in the polyfills and web3.js, and this decision — what a person is
 * told when their money did not move — is worth exercising directly.
 */

declare const __DEV__: boolean | undefined;

/*
 * `__DEV__` is injected by the bundler, so it simply does not exist in any
 * other host — and a bare reference to it throws a ReferenceError rather than
 * reading as false. That turned the two diagnostic branches below into a crash
 * for every caller outside the app, which is also what made this function
 * impossible to test until now.
 */
const dev = (): boolean => typeof __DEV__ !== "undefined" && __DEV__ === true;

export function explainError(e: any): string {
  /*
   * `getLogs()` as well as `.logs`.
   *
   * web3.js throws SendTransactionError, whose `logs` are often not populated
   * until something asks for them — so the program's own error name was
   * missing from the text this matches on, and every failed simulation
   * collapsed to the words "Simulation failed", which tells a borrower
   * nothing. `logs` is a plain property once resolved; reading both covers
   * the case where it already is.
   */
  const fromGetter = typeof e?.getLogs === "function" ? safeLogs(e) : [];
  const logs: string[] = e?.logs ?? fromGetter ?? [];
  const text = `${e?.message ?? e}\n${logs.join("\n")}`;
  const code = text.match(/Error Code: (\w+)/)?.[1];
  const map: Record<string, string> = {
    AccountNotInitialized: "This wallet has no USDC account yet. Add some and try again.",
    ExceedsCreditLimit: "That is more credit than your limit allows.",
    InsufficientDelegation: "Your payment authorisation does not cover this.",
    NotDelegated: "Your account is not authorised for Polaris yet.",
    InsufficientLiquidity: "The protocol pool cannot cover this purchase right now.",
    MerchantNotEligible: "This merchant cannot take a plan of that size.",
    InvalidInstallments: "Between 1 and 24 installments.",
    InvalidInterval: "That schedule is outside what the protocol allows.",
    ZeroAmount: "Enter an amount above zero.",
    AlreadySubscribed: "You already have a live subscription to this plan.",

    /*
     * The rest of the program's errors.
     *
     * Twenty of twenty-nine had no sentence, and the fallback below returned
     * the raw identifier — so withdrawing collateral against an open plan told
     * the borrower "DebtOutstanding". Every one of these is reachable from a
     * screen, so every one gets words.
     */
    DebtOutstanding: "You still owe on a plan. Repay it before withdrawing collateral.",
    InsufficientCollateral: "That is more collateral than you have locked.",
    LoanNotActive: "That plan is already closed.",
    NotLiquidatable: "That plan is not overdue enough to liquidate.",
    PlanNotActive: "That subscription plan is no longer offered.",
    SubscriptionNotActive: "That subscription is not running.",
    NotDue: "That charge is not due yet.",
    NotAuthorized: "This account is not allowed to do that.",
    InvalidPeriod: "That billing period is outside what the protocol allows.",
    MathOverflow: "That amount is too large for the protocol to handle.",
    StringTooLong: "That name is too long.",
    TokenOwnerMismatch: "That token account belongs to somebody else.",
    MintMismatch: "That account holds a different token than this deployment uses.",
    AlreadyUnderwritten: "This wallet already has a credit line.",
    NotUnderwriter: "Only the underwriter can open a credit line.",
    EvidenceStale: "That credit check went stale. Try again.",
    EvidenceFromTheFuture: "That credit check is timestamped wrong. Try again.",

    // Set once at initialization, so a borrower can never see these — mapped
    // anyway, because the alternative is a bare identifier on a screen.
    InvalidGracePeriod: "This deployment is misconfigured.",
    InvalidFee: "This deployment is misconfigured.",
    InvalidMultiplier: "This deployment is misconfigured.",
  };
  if (code && map[code]) return map[code];
  if (/already in use/i.test(text)) return "That order has already been paid.";
  if (/insufficient funds|0x1\b/.test(text)) return "Your balance does not cover this.";
  if (/could not find account|AccountNotInitialized|invalid account data/i.test(text)) {
    return "This wallet has no USDC account yet. Add some and try again.";
  }
  // Not a borrower's problem, and not something they can retry into working:
  // the app is pointed at an address with no program on it.
  if (/program that does not exist|ProgramAccountNotFound/i.test(text)) {
    return "This app is pointed at the wrong program. Its deployment needs re-syncing.";
  }
  /*
   * The one failure where "nothing was charged" would be a lie.
   *
   * A blockhash that expired before the transaction landed is safe to call a
   * refusal — nothing was signed into a block. A *confirmation timeout* is the
   * opposite: the transaction was already broadcast and web3.js says in the
   * message itself that it does not know whether it succeeded. That message is
   * long enough to overflow the length guard at the bottom of this ladder, so
   * it used to fall through to "The transaction was refused. Nothing was
   * charged." — which invites the borrower to pay a second time, the single
   * mistake this whole ladder exists to prevent.
   */
  if (/was not confirmed in|unknown if it succeeded/i.test(text)) {
    const sig =
      String((e as any)?.signature ?? "").trim() ||
      (text.match(/signature\s+([1-9A-HJ-NP-Za-km-z]{32,})/)?.[1] ?? "");
    return sig
      ? `Sent, but not confirmed in time. It may still have gone through — check ${sig.slice(0, 8)}… in Activity before trying again.`
      : "Sent, but not confirmed in time. It may still have gone through — check Activity before trying again.";
  }
  if (/blockhash not found|block height exceeded/i.test(text)) {
    return "That took too long to confirm. Nothing was charged — try again.";
  }
  if (/failed to fetch|network request failed|ECONNREFUSED/i.test(text)) {
    return "Cannot reach the network. Check the RPC endpoint is running.";
  }
  /*
   * Never the bare identifier.
   *
   * `return code` put things like "DebtOutstanding" on the screen — a symbol
   * from the program's source, shown to somebody trying to move their money.
   * Anything that reaches here is an error the map has not been taught yet,
   * and a sentence that admits that is better than a token that explains
   * nothing.
   */
  if (code) {
    if (dev()) console.error(`[polaris] unmapped program error: ${code}`, e);
    return "The program refused that. Nothing was charged.";
  }

  /*
   * Last resort, and the reason it is not just `e.message`.
   *
   * A simulation failure's message is a paragraph of logs, a hint about
   * catching SendTransactionError, and an empty array -- all of which landed
   * on the screen verbatim under the word "Refused". Anything that long is a
   * stack trace wearing a sentence, so it goes to the log and the borrower
   * gets something true and short.
   */
  const message = String(e?.message ?? "").split("\n")[0]?.trim() ?? "";
  /*
   * "Simulation failed." names nothing a borrower can act on, and it is
   * exactly the message that reaches here when the logs could not be found.
   * Better to say what is actually true.
   */
  if (/^simulation failed\.?$/i.test(message)) {
    return "The cluster refused that. Nothing was charged — check your balance and try again.";
  }
  if (message && message.length <= 120) return message;
  if (dev()) console.error("[polaris] unexplained failure:", e);
  return "The transaction was refused. Nothing was charged.";
}


/** `getLogs()` can itself throw when the RPC is gone; a diagnostic must not. */
function safeLogs(e: any): string[] {
  try {
    const logs = e.getLogs();
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}
