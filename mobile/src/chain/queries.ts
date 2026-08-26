import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { merchantDirectory } from "./config";
import { getConnection, getProgram, getTokenAccount, getWallet } from "./client";
import { pdas } from "./pdas";
import idl from "./idl.json";

export type LoanStatus = "active" | "repaid" | "liquidated";
export type SubStatus = "active" | "cancelled" | "lapsed";

export type Loan = {
  id: number;
  address: string;
  merchant: string;
  merchantIcon: string;
  principal: number;
  totalOwed: number;
  totalRepaid: number;
  installmentCount: number;
  installmentsPaid: number;
  startedAt: number;
  intervalSeconds: number;
  status: LoanStatus;
};

export type Plan = {
  id: number;
  address: string;
  merchant: string;
  merchantIcon: string;
  /** The merchant's registry PDA — what `subscribe` needs, not the name. */
  merchantPda: string;
  name: string;
  pricePerPeriod: number;
  periodSeconds: number;
  nextChargeAt: number;
  periodsCharged: number;
  missedCharges: number;
  status: SubStatus;
};

export type CreditProfile = {
  score: number;
  onTimePayments: number;
  latePayments: number;
  liquidations: number;
  activeDebt: number;
  lockedCollateral: number;
};

export type ProtocolConfig = {
  stablecoin: string;
  gracePeriod: number;
  minIntervalSeconds: number;
  feeBps: number;
  creditMultiplierBps: number;
  loanCount: number;
  planCount: number;
  badDebt: number;
};

const n = (v: any) => Number(v?.toString() ?? 0);
const statusOf = (s: any) => Object.keys(s ?? {})[0] as any;
const merchantName = (pk: PublicKey) =>
  merchantDirectory.get(pk.toBase58()) ?? { name: "Unknown merchant", icon: "◻" };

/**
 * A fresh profile has no account on chain — the program creates it on the first
 * loan or the first collateral lock. That is not an error state, it is a
 * borrower with no history, and the program's own defaults are what they get.
 */
const FRESH_PROFILE: CreditProfile = {
  score: 600,
  onTimePayments: 0,
  latePayments: 0,
  liquidations: 0,
  activeDebt: 0,
  lockedCollateral: 0,
};

export async function fetchProtocol(): Promise<ProtocolConfig> {
  const p: any = await (getProgram().account as any).protocol.fetch(pdas.protocol);
  return {
    stablecoin: p.stablecoin.toBase58(),
    gracePeriod: n(p.gracePeriod),
    minIntervalSeconds: n(p.minIntervalSeconds),
    feeBps: p.feeBps,
    creditMultiplierBps: p.creditMultiplierBps,
    loanCount: n(p.loanCount),
    planCount: n(p.planCount),
    badDebt: n(p.badDebt),
  };
}

export async function fetchProfile(user = getWallet().publicKey): Promise<CreditProfile> {
  const info = await getConnection().getAccountInfo(pdas.profileOf(user));
  if (!info) return FRESH_PROFILE;
  const p: any = (getProgram().account as any).creditProfile.coder.accounts.decode(
    "creditProfile",
    info.data,
  );
  return {
    score: p.score,
    onTimePayments: p.onTimePayments,
    latePayments: p.latePayments,
    liquidations: p.liquidations,
    activeDebt: n(p.activeDebt),
    lockedCollateral: n(p.lockedCollateral),
  };
}

/**
 * Every loan belonging to this borrower.
 *
 * Filtered server-side on the borrower pubkey rather than fetched wholesale and
 * filtered here — the discriminator is 8 bytes and `borrower` is the second
 * field, so the offset is 8 + 8 (the u64 id).
 */
export async function fetchLoans(user = getWallet().publicKey): Promise<Loan[]> {
  const raw = await (getProgram().account as any).loan.all([
    { memcmp: { offset: 8 + 8, bytes: user.toBase58() } },
  ]);
  return raw
    .map((r: any) => {
      const m = merchantName(r.account.merchant);
      return {
        id: n(r.account.id),
        address: r.publicKey.toBase58(),
        merchant: m.name,
        merchantIcon: m.icon,
        principal: n(r.account.principal),
        totalOwed: n(r.account.totalOwed),
        totalRepaid: n(r.account.totalRepaid),
        installmentCount: r.account.installmentCount,
        installmentsPaid: r.account.installmentsPaid,
        startedAt: n(r.account.startedAt),
        intervalSeconds: n(r.account.intervalSeconds),
        status: statusOf(r.account.status),
      } as Loan;
    })
    // Newest first, which is the order a borrower thinks about their plans in.
    .sort((a: Loan, b: Loan) => b.startedAt - a.startedAt);
}

export async function fetchSubscriptions(user = getWallet().publicKey): Promise<Plan[]> {
  const subs = await (getProgram().account as any).subscription.all([
    { memcmp: { offset: 8, bytes: user.toBase58() } },
  ]);
  if (!subs.length) return [];

  // One read for the plan directory rather than one per subscription.
  const plans = new Map<string, any>(
    (await (getProgram().account as any).plan.all()).map((p: any) => [
      p.publicKey.toBase58(),
      p.account,
    ]),
  );

  return subs
    .map((s: any) => {
      const plan = plans.get(s.account.plan.toBase58());
      if (!plan) return null;
      const merchantPda: PublicKey = plan.merchant;
      const m = merchantName(merchantPda);
      return {
        id: n(plan.id),
        address: s.publicKey.toBase58(),
        merchant: m.name,
        merchantIcon: m.icon,
        merchantPda: merchantPda.toBase58(),
        name: plan.name,
        pricePerPeriod: n(plan.pricePerPeriod),
        periodSeconds: n(plan.periodSeconds),
        nextChargeAt: n(s.account.nextChargeAt),
        periodsCharged: s.account.periodsCharged,
        missedCharges: s.account.missedCharges,
        status: statusOf(s.account.status),
      } as Plan;
    })
    .filter(Boolean) as Plan[];
}

/**
 * Plans this borrower could subscribe to.
 *
 * Every active plan on the protocol, minus the ones they already hold a live
 * subscription to. Subscribing twice to the same plan is refused on chain by
 * `AlreadySubscribed`, so offering it is offering a guaranteed failure.
 */
export async function fetchAvailablePlans(user = getWallet().publicKey): Promise<Plan[]> {
  const [plans, subs] = await Promise.all([
    (getProgram().account as any).plan.all(),
    (getProgram().account as any).subscription.all([
      { memcmp: { offset: 8, bytes: user.toBase58() } },
    ]),
  ]);

  const taken = new Set(
    subs
      .filter((s: any) => statusOf(s.account.status) === "active")
      .map((s: any) => s.account.plan.toBase58()),
  );

  return plans
    .filter((p: any) => p.account.active && !taken.has(p.publicKey.toBase58()))
    .map((p: any) => {
      const m = merchantName(p.account.merchant);
      return {
        id: n(p.account.id),
        address: p.publicKey.toBase58(),
        merchant: m.name,
        merchantIcon: m.icon,
        merchantPda: p.account.merchant.toBase58(),
        name: p.account.name,
        pricePerPeriod: n(p.account.pricePerPeriod),
        periodSeconds: n(p.account.periodSeconds),
        nextChargeAt: 0,
        periodsCharged: 0,
        missedCharges: 0,
        status: "active",
      } as Plan;
    });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export type ActivityEvent = {
  id: string;
  kind: "collected" | "originated" | "charged" | "settled" | "liquidated" | "score";
  title: string;
  detail: string;
  amount?: number;
  at: number;
  signature: string;
};

const coder = new BorshCoder(idl as any);
// Built lazily: the program id is only known once the client is initialised.
let _parser: EventParser | null = null;
const parser = () => (_parser ??= new EventParser(getProgram().programId, coder));

/**
 * Truncate rather than round.
 *
 * These are exact base-unit amounts. Rounding 100.767123 up to 100.77 states
 * that seven thousandths more moved than actually did; truncating never claims
 * more than the chain recorded. `Figure` truncates for the same reason, and the
 * two have to agree or the same amount reads differently in a title and in the
 * column beside it.
 */
const usd = (raw: number) => {
  const whole = Math.floor(raw / 1_000_000);
  const frac = String(raw % 1_000_000).padStart(6, "0").slice(0, 2);
  return `${whole}.${frac}`;
};

/**
 * Anchor decodes event fields under the names the IDL declares them, which for
 * a Rust program is snake_case. Every field access here was written camelCase
 * first — and single-word fields like `amount` and `principal` matched, so
 * events rendered with correct money and `Installment NaN`, `score undefined →
 * undefined` beside it. A half-working mapping is worse than a broken one,
 * because it looks fine at a glance.
 *
 * Normalising once at the boundary means the rest of this file reads in one
 * convention and cannot drift from the wire format field by field.
 */
function camelize<T = any>(value: any): T {
  if (Array.isArray(value)) return value.map(camelize) as any;
  if (value === null || typeof value !== "object") return value;
  // Leave anything with its own class (PublicKey, BN, Buffer) alone.
  if (value.constructor && value.constructor !== Object) return value;
  const out: any = {};
  for (const [k, v] of Object.entries(value)) {
    out[k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = camelize(v);
  }
  return out;
}

/**
 * This borrower's activity, decoded from the program's own events.
 *
 * Signatures are gathered from the accounts that belong to *them* — their
 * credit profile, which every score and debt change writes to, and their token
 * account, which every movement of their money touches, including the ones a
 * keeper signed on their behalf.
 *
 * The first version of this read the protocol PDA instead, on the reasoning
 * that every instruction touches it. It does — for every borrower. That feed
 * would have shown one customer another customer's loans, which is a privacy
 * fault well before it is a correctness one. The protocol PDA is the wrong
 * question: "what happened to the protocol" is not "what happened to me".
 *
 * Two lookups are merged and deduplicated by signature, because a single
 * transaction usually touches both.
 */
export async function fetchActivity(limit = 25): Promise<ActivityEvent[]> {
  const sources = [pdas.profileOf(getWallet().publicKey), getTokenAccount()];

  const perSource = await Promise.all(
    sources.map((address) =>
      getConnection().getSignaturesForAddress(address, { limit }).catch(() => []),
    ),
  );

  const seen = new Set<string>();
  const sigs = perSource
    .flat()
    .filter((s) => {
      if (s.err || seen.has(s.signature)) return false;
      seen.add(s.signature);
      return true;
    })
    .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0))
    .slice(0, limit);

  if (!sigs.length) return [];

  const txs = await getConnection().getTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  );

  const out: ActivityEvent[] = [];

  txs.forEach((tx, i) => {
    const meta = sigs[i];
    if (!tx?.meta?.logMessages || meta.err) return;
    const at = meta.blockTime ?? tx.blockTime ?? 0;

    /*
     * Who moved this installment.
     *
     * The `InstallmentPaid` event does not carry the caller — the program does
     * not care, since the money can only travel one way regardless. But the
     * borrower does: "collected by the keeper" and "you paid this early" are
     * different facts about their own account.
     *
     * The first attempt at this compared the fee payer against the borrower,
     * which is a proxy and a bad one. Anchor's `.rpc()` pays fees from the
     * provider wallet, so a repayment the borrower signed themselves can be
     * fee-paid by somebody else entirely — and every early repayment was
     * captioned as a keeper collection.
     *
     * The instruction name is not a proxy. `Repay` is borrower-signed by
     * construction; `CollectInstallment` is the permissionless keeper path.
     */
    const byKeeper = tx.meta.logMessages.some((l) =>
      l.includes("Instruction: CollectInstallment"),
    );

    let idx = 0;
    for (const event of parser().parseLogs(tx.meta.logMessages)) {
      const d: any = camelize(event.data);
      const base = {
        id: `${meta.signature}:${idx++}`,
        at,
        signature: meta.signature,
      };

      /*
       * Keyed on the event names exactly as the IDL spells them — PascalCase.
       *
       * This was written against camelCase first, which typechecked, parsed,
       * and then matched nothing: every event fell through and the feed
       * rendered empty, which is indistinguishable from a borrower who has
       * done nothing. That is why the fallback below exists rather than a
       * `default: break` — an event this does not recognise now shows up as a
       * row instead of disappearing.
       */
      switch (event.name) {
        case "InstallmentPaid":
          out.push({
            ...base,
            kind: "collected",
            title: `Installment ${Number(d.installmentIndex) + 1} collected`,
            detail: [
              d.onTime ? "On time" : "Late, inside grace",
              byKeeper ? "collected by the keeper" : "you paid this early",
            ].join(" · "),
            amount: n(d.amount),
          });
          break;

        case "LoanCreated":
          out.push({
            ...base,
            kind: "originated",
            title: `Split ${usd(n(d.principal))} into ${d.installments}`,
            detail: "Merchant paid in full, up front",
            amount: n(d.principal),
          });
          break;

        case "LoanFullyRepaid":
          out.push({
            ...base,
            kind: "settled",
            title: "Plan paid off",
            detail: "Every installment collected",
          });
          break;

        case "SubscriptionCharged":
          out.push({
            ...base,
            kind: "charged",
            title: `Subscription period ${d.period}`,
            detail: "Charged on the agreed schedule",
            amount: n(d.amount),
          });
          break;

        case "Subscribed":
          out.push({
            ...base,
            kind: "charged",
            title: "Subscription started",
            detail: "First period charged at signup",
          });
          break;

        case "SubscriptionCancelled":
          out.push({
            ...base,
            kind: "settled",
            title: "Subscription cancelled",
            detail: "Cancelled without the merchant's agreement",
          });
          break;

        case "SubscriptionLapsed":
          out.push({
            ...base,
            kind: "liquidated",
            title: "Subscription lapsed",
            detail: `${d.misses} consecutive ${d.misses === 1 ? "charge" : "charges"} missed`,
          });
          break;

        case "ChargeMissed":
          out.push({
            ...base,
            kind: "liquidated",
            title: "Subscription charge missed",
            detail: "Period skipped, not stacked",
          });
          break;

        case "ScoreChanged":
          out.push({
            ...base,
            kind: "score",
            title: `Credit score ${d.oldScore} → ${d.newScore}`,
            detail: String(d.reason),
          });
          break;

        case "LoanLiquidated":
          out.push({
            ...base,
            kind: "liquidated",
            title: "Plan liquidated",
            detail: `Recovered ${usd(n(d.recovered))} of ${usd(n(d.outstanding))}`,
            amount: n(d.outstanding),
          });
          break;

        case "PaymentMade":
          out.push({
            ...base,
            kind: "settled",
            title: `Paid ${usd(n(d.amount))} in full`,
            detail: `Fee ${usd(n(d.fee))}`,
            amount: n(d.amount),
          });
          break;

        case "CollateralLocked":
          out.push({
            ...base,
            kind: "settled",
            title: `Locked ${usd(n(d.amount))} collateral`,
            detail: "Raises the credit limit by 150% of what is locked",
            amount: n(d.amount),
          });
          break;

        case "CollateralWithdrawn":
          out.push({
            ...base,
            kind: "settled",
            title: `Withdrew ${usd(n(d.amount))} collateral`,
            detail: "No debt outstanding",
            amount: n(d.amount),
          });
          break;

        case "CollateralSeized":
          out.push({
            ...base,
            kind: "liquidated",
            title: `Collateral seized`,
            detail: "Recovered against a defaulted plan",
            amount: n(d.amount),
          });
          break;

        // Protocol-operator events. Real, but not the borrower's business, so
        // they are dropped deliberately rather than by omission.
        case "LiquidityFunded":
        case "LiquidityWithdrawn":
        case "FeesSwept":
        case "MerchantRegistered":
        case "MerchantActivated":
        case "PlanCreated":
        case "LoanStatusChanged":
          break;

        default:
          out.push({
            ...base,
            kind: "settled",
            title: String(event.name),
            detail: "On-chain event",
          });
          break;
      }
    }
  });

  return out.sort((a, b) => b.at - a.at);
}
