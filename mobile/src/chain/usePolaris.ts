import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getConnection, getPublicKey, isReady } from "./client";
import { describeChange, type LiveChange } from "./changes.ts";

export type { LiveChange };
import { pdas } from "./pdas";
import {
  fetchActivity,
  fetchAvailablePlans,
  fetchLoans,
  fetchProfile,
  fetchProtocol,
  fetchDelegation,
  fetchSubscriptions,
  type ActivityEvent,
  type Delegation,
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
  /**
   * Why no line was opened, in the underwriter's own words.
   *
   * This used to be swallowed into a dev-only warning, so the screen had
   * nothing to show and fell back to guessing "the underwriter is not
   * reachable" — which is wrong whenever it answered and refused.
   */
  underwritingError: string | null;
  loans: Loan[];
  subscriptions: Plan[];
  /** Plans on offer that this borrower does not already hold. */
  availablePlans: Plan[];
  activity: ActivityEvent[];
  /** True when the ledger could not be read in full — a rate-limited RPC. */
  activityPartial: boolean;
  /** Why it is partial, in a sentence, or null when the cause is unknown. */
  activityPartialReason: string | null;
  /** Whether the protocol can still collect. Null until the profile is known. */
  delegation: Delegation | null;
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
  /**
   * The signing address, or null until one is loaded from the device keystore.
   *
   * An address rather than a boolean because the signer can be *replaced*
   * while remaining present — connecting a wallet app swaps the device key for
   * it in place. Keyed on a boolean the live subscription below never noticed:
   * it stayed pointed at the previous wallet's profile, so the screen updated
   * itself for an account the user had just stopped using, and stayed silent
   * about the one they were actually looking at.
   */
  address: string | null,
): PolarisState & { refresh: () => Promise<void>; liveChange: LiveChange | null } {
  const [state, setState] = useState<PolarisState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [liveChange, setLiveChange] = useState<LiveChange | null>(null);
  const previous = useRef<{ profile: CreditProfile | null; loans: Loan[] } | null>(null);

  /*
   * The notice is a moment, not a state — it clears itself.
   *
   * Thirty seconds. This is the one thing on the screen that appears without
   * being asked for — a collection the borrower was not involved in — and the
   * realistic case is a phone that was in a pocket when it happened. Seven
   * seconds meant the only people who saw it were the ones already looking.
   * Long enough to still be there when they glance down; short enough that it
   * is plainly an event rather than a banner that lives on the screen.
   */
  useEffect(() => {
    if (!liveChange) return;
    const t = setTimeout(() => setLiveChange(null), 30_000);
    return () => clearTimeout(t);
  }, [liveChange]);

  const load = useCallback(async (live = false) => {
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
      let underwritingError: string | null = null;
      if (!profile) {
        try {
          underwriting = await requestUnderwriting(getPublicKey().toBase58());
          profile = await fetchProfile();
        } catch (e: any) {
          const said = String(e?.message ?? "").trim();
          /*
           * Prefer what the underwriter actually said. Only when there was no
           * answer at all — a network failure, not a refusal — is "not
           * reachable" the true description.
           */
          underwritingError =
            /failed to fetch|network request failed|econnrefused|load failed/i.test(said) || !said
              ? "The underwriter could not be reached from here."
              : said;
          if (__DEV__) console.warn("[polaris] underwriting unavailable:", said || e);
        }
      }

      /*
       * Only diff when the chain woke us. A manual refresh is the user asking
       * for the latest, and telling them what changed since they asked is
       * noise.
       */
      if (live) {
        const change = describeChange(previous.current, profile, loans, Date.now());
        if (change) setLiveChange(change);
      }
      previous.current = { profile, loans };

      /*
       * Read after the profile, because it needs the debt to compare against —
       * and skipped entirely for a borrower who owes nothing, where a
       * delegation that does not cover zero is not news.
       */
      const delegation =
        profile && profile.activeDebt > 0
          ? await fetchDelegation(profile.activeDebt).catch(() => null)
          : null;

      setState({
        status: "ready",
        data: {
          protocol,
          profile,
          underwriting,
          underwritingError,
          loans,
          subscriptions,
          availablePlans,
          activity: activity.events,
          activityPartial: activity.partial,
          activityPartialReason: activity.partialReason,
          delegation,
        },
        error: null,
      });
    } catch (e: any) {
      // Keep the stack. A caught error that only survives as a sentence is
      // untraceable on a device, where there is no console to expand — and the
      // first failure this hid was a Hermes-only one the browser never saw.
      // Development only. A caught error that survives as a sentence is
      // untraceable on a device; a production build should not print stacks.
      if (__DEV__) console.error("[polaris] chain read failed:", e?.stack ?? e);
      const raw = String(e?.message ?? e);
      /*
       * Never the RPC's own body.
       *
       * A rate-limited public cluster answers with a JSON-RPC envelope, and
       * that envelope — braces, error code, request id and all — was being
       * printed on the screen under "Could not reach the network". Each of
       * these is a real thing that happens to this app on a shared endpoint,
       * and each gets a sentence.
       */
      const message = /429|too many requests/i.test(raw)
        ? "The network is rate limiting us. Your position is safe on chain — try again in a moment."
        : /failed to fetch|network request failed|econnrefused/i.test(raw)
          ? "Cannot reach the network. Check the RPC endpoint is running."
          : /timed out|timeout/i.test(raw)
            ? "The network took too long to answer. Try again."
            : raw.length <= 120 && !raw.includes("{")
              ? raw
              : "Could not read your position just now. Try again in a moment.";
      setState((prev) => ({ status: "error", data: prev.data, error: message }));
    }
  }, []);

  useEffect(() => {
    /*
     * Both gates, not just the React one.
     *
     * `address` says the provider has a wallet loaded; `isReady()`
     * asks the client itself. They can disagree — a hot reload re-evaluates
     * the module and clears the client while React keeps the state that says
     * it is there — and the read then throws into the console for a state the
     * app recovers from on its own a moment later.
     */
    if (address && isReady()) void load();
  }, [address, load]);

  /*
   * Watch the borrower's own profile, and re-read when it moves.
   *
   * This is the whole argument of the product made visible. A keeper collects
   * an installment with the borrower offline and nothing of theirs involved —
   * so the only honest way to show that is for the screen to change while
   * nobody is touching it. Polling would do it too, badly; `accountSubscribe`
   * is a socket the cluster pushes to.
   *
   * The profile is the right account to watch rather than each loan: every
   * event that matters to a borrower — a collection, a repayment, a score
   * change, collateral moving — writes to it.
   */
  /*
   * Only after a read has actually succeeded.
   *
   * web3.js opens the subscription socket eagerly and reconnects for as long
   * as it fails, logging `ws error: undefined` on every attempt — an error
   * carrying no information, forever, and on Android a red toast on top of the
   * screen. Against a cluster that cannot be reached at all this is pure noise
   * about something the user already knows: the error state is on screen.
   *
   * Live updates are an enhancement on top of a working connection, so they
   * wait for one. The moment a read succeeds the socket opens as before.
   */
  const connected = state.status === "ready";

  useEffect(() => {
    if (!address || !connected || !isReady()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let id: number | null = null;

    try {
      const connection = getConnection();
      const profile = pdas.profileOf(getPublicKey());
      id = connection.onAccountChange(
        profile,
        () => {
          /*
           * Debounced. One transaction can write the profile more than once —
           * a repayment touches the debt and the score — and each write
           * arrives as its own notification. Re-reading the whole position
           * per notification would fire several overlapping loads.
           */
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (!cancelled) void load(true);
          }, 400);
        },
        { commitment: "confirmed" },
      );
    } catch (e: any) {
      // A socket that cannot open is not a reason to fail the screen; the app
      // simply goes back to updating when asked.
      if (__DEV__) console.warn("[polaris] live updates unavailable:", e?.message ?? e);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (id !== null) {
        void getConnection().removeAccountChangeListener(id).catch(() => {});
      }
    };
  }, [address, connected, load]);

  return useMemo(
    () => ({ ...state, refresh: () => load(false), liveChange }),
    [state, load, liveChange],
  );
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
