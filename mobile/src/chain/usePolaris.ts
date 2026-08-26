import { useCallback, useEffect, useMemo, useState } from "react";

import { getPublicKey, isReady } from "./client";
import {
  fetchActivity,
  fetchAvailablePlans,
  fetchLoans,
  fetchProfile,
  fetchProtocol,
  fetchSubscriptions,
  type ActivityEvent,
  type CreditProfile,
  type Loan,
  type Plan,
  type ProtocolConfig,
} from "./queries";
import { creditLine } from "./math";
import { requestUnderwriting, type Underwriting } from "./underwriting";

export type ChainState = {
  protocol: ProtocolConfig;
  /** `null` until this wallet has a line. */
  profile: CreditProfile | null;
  /** Why the line is the size it is, when the gateway told us. */
  underwriting: Underwriting | null;
  loans: Loan[];
  subscriptions: Plan[];
  /** Plans on offer that this borrower does not already hold. */
  availablePlans: Plan[];
  activity: ActivityEvent[];
};

export type PolarisState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: ChainState; error: null }
  | { status: "error"; data: ChainState | null; error: string };

/**
 * Everything the app needs, in one pass over the chain.
 *
 * Fetched together rather than per screen because the four screens are four
 * views of one borrower's position: fetching them separately means the credit
 * line on one tab can disagree with the loans on the next, which is the kind of
 * inconsistency a money app cannot afford.
 *
 * A failure keeps the last good data and surfaces the error alongside it — the
 * alternative is throwing away a correct balance because a refresh timed out.
 */
export function usePolarisState(
  /** Nothing is read until the signer is loaded from the device keystore. */
  ready: boolean,
): PolarisState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<PolarisState>({
    status: "loading",
    data: null,
    error: null,
  });

  const load = useCallback(async () => {
    try {
      const [protocol, existing, loans, subscriptions, availablePlans, activity] =
        await Promise.all([
          fetchProtocol(),
          fetchProfile(),
          fetchLoans(),
          fetchSubscriptions(),
          fetchAvailablePlans(),
          fetchActivity(30),
        ]);

      /*
       * A wallet with no line gets one, from its own history.
       *
       * This is the first thing that happens to a new install, and it is the
       * one read the app cannot do for itself: attesting requires the
       * underwriter's signature, and that key belongs on a service rather than
       * in a client anyone can decompile.
       *
       * A gateway that is not running is not a failure of the rest of the
       * screen. The line simply stays unopened and says so, and every other
       * number here is still read from the chain.
       */
      let profile = existing;
      let underwriting: Underwriting | null = null;
      if (!profile) {
        try {
          underwriting = await requestUnderwriting(getPublicKey().toBase58());
          profile = await fetchProfile();
        } catch (e: any) {
          if (__DEV__) console.warn("[polaris] underwriting unavailable:", e?.message ?? e);
        }
      }

      setState({
        status: "ready",
        data: { protocol, profile, underwriting, loans, subscriptions, availablePlans, activity },
        error: null,
      });
    } catch (e: any) {
      // Keep the stack. A caught error that only survives as a sentence is
      // untraceable on a device, where there is no console to expand — and the
      // first failure this hid was a Hermes-only one the browser never saw.
      // Development only. A caught error that survives as a sentence is
      // untraceable on a device; a production build should not print stacks.
      if (__DEV__) console.error("[polaris] chain read failed:", e?.stack ?? e);
      const message =
        e?.message?.includes("fetch") || e?.message?.includes("Failed to fetch")
          ? "Cannot reach the network. Check the RPC endpoint is running."
          : (e?.message ?? String(e));
      setState((prev) => ({ status: "error", data: prev.data, error: message }));
    }
  }, []);

  useEffect(() => {
    /*
     * Both gates, not just the React one.
     *
     * `ready` says the provider believes the wallet has loaded; `isReady()`
     * asks the client itself. They can disagree — a hot reload re-evaluates
     * the module and clears the client while React keeps the state that says
     * it is there — and the read then throws into the console for a state the
     * app recovers from on its own a moment later.
     */
    if (ready && isReady()) void load();
  }, [ready, load]);

  return useMemo(() => ({ ...state, refresh: load }), [state, load]);
}

/** The derived credit line, or nulls while there is nothing to derive it from. */
export function useCreditLine(data: ChainState | null) {
  return useMemo(() => {
    // No profile is not zero: it is "no line yet". Deriving a limit from an
    // absent profile is how the app used to show 500 USDC to a wallet the
    // program had never heard of.
    if (!data?.profile) return null;
    return creditLine(data.profile, data.protocol.creditMultiplierBps);
  }, [data]);
}

/**
 * The next installment the keeper will collect, across every open plan.
 *
 * Sorted by due date rather than by loan id, because "what leaves my account
 * next" is a question about time.
 */
export function nextCollection(loans: Loan[]) {
  const active = loans.filter((l) => l.status === "active");
  if (!active.length) return null;
  const due = active
    .map((loan) => ({
      loan,
      amount: (() => {
        const target =
          loan.installmentsPaid + 1 >= loan.installmentCount
            ? loan.totalOwed
            : Math.ceil((loan.totalOwed * (loan.installmentsPaid + 1)) / loan.installmentCount);
        return Math.max(0, target - loan.totalRepaid);
      })(),
      dueAt: loan.startedAt + (loan.installmentsPaid + 1) * loan.intervalSeconds,
    }))
    .filter((d) => d.amount > 0);
  if (!due.length) return null;
  due.sort((a, b) => a.dueAt - b.dueAt);
  return due[0];
}
