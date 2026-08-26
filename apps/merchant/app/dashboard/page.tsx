'use client';

export const dynamic = 'force-dynamic';

import { useWallet } from '@/components/WalletProvider';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ArrowUpRight, Loader2 } from 'lucide-react';

type Plan = {
    loanId: string;
    orderId: string;
    borrower: string;
    status: 'active' | 'repaid' | 'liquidated' | 'defaulted';
    principalDisplay: string;
    outstandingDisplay: string;
    installmentsPaid: number;
    installmentCount: number;
    nextDueAt: string | null;
    state: 'scheduled' | 'dunning' | 'paid' | 'written_off';
    attempts: number;
    lastTxHash?: string;
};

type Overview = {
    settledDisplay: string;
    outstandingDisplay: string;
    atRiskDisplay: string;
    collectedThisWeekDisplay: string;
    activePlans: number;
    dunningPlans: number;
    // Null until something has actually come due. The endpoint used to send a
    // flat 100 in that case, which presented an untested book as a perfect one.
    collectionRate: number | null;
    plans: Plan[];
};

const fetcher = (wallet: string) => async (url: string) => {
    const res = await fetch(url, { headers: { 'x-wallet-address': wallet } });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
};

export default function Dashboard() {
    const { address: wallet, connect, ready } = useWallet();
    const [filter, setFilter] = useState<'all' | 'collecting' | 'dunning' | 'closed'>('all');

    useEffect(() => {
        if (!wallet) return;
        fetch('/api/auth/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet_address: wallet }),
        }).catch(() => undefined);
    }, [wallet]);

    const { data, error, isLoading } = useSWR<Overview>(
        wallet ? '/api/merchant/overview' : null,
        fetcher(wallet),
        { refreshInterval: 20_000 }
    );

    const plans = useMemo(() => {
        const all = data?.plans ?? [];
        if (filter === 'collecting') return all.filter((p) => p.status === 'active' && p.state !== 'dunning');
        if (filter === 'dunning') return all.filter((p) => p.state === 'dunning');
        if (filter === 'closed') return all.filter((p) => p.status !== 'active');
        return all;
    }, [data, filter]);

    if (!ready) return null;

    if (!wallet) return <SignIn onSignIn={connect} />;

    return (
        <div className="min-h-screen bg-background text-foreground font-display selection:bg-primary/25">
            <main className="mx-auto max-w-[1180px] px-6 py-14 md:px-10">
                <Ledger
                    data={data}
                    error={error}
                    isLoading={isLoading}
                    plans={plans}
                    filter={filter}
                    onFilter={setFilter}
                />
            </main>
        </div>
    );
}

/* ------------------------------------------------------------------ */

export function Ledger({
    data,
    error,
    isLoading,
    plans,
    filter,
    onFilter,
}: {
    data?: Overview;
    error?: Error;
    isLoading: boolean;
    plans: Plan[];
    filter: string;
    onFilter: (f: 'all' | 'collecting' | 'dunning' | 'closed') => void;
}) {
    if (error) return <ErrorState message={error.message} />;

    const atRisk = Number.parseFloat((data?.atRiskDisplay ?? '0').replace(/,/g, '')) || 0;

    return (
        <>
            {/*
             * Two questions, not one summary.
             *
             * What is still owed is the figure a merchant opens the page for, so
             * it leads. What is at risk is the figure they can act on, so it sits
             * beside it rather than being flattened into a row of four where the
             * only number worth reacting to has the same weight as a running
             * total. When nothing is at risk that pairing says so plainly, which
             * is the answer a merchant most wants and the one a stat grid buries.
             */}
            <header className="border-b border-white/10 pb-10">
                <div className="grid gap-8 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] sm:gap-14">
                    <div>
                        <p className="label">Outstanding across active plans</p>
                        <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
                            <span className="figure-lg font-mono text-[clamp(2.75rem,7vw,4.5rem)] font-medium">
                                {isLoading ? <Skeleton w="9ch" /> : data?.outstandingDisplay ?? '0.00'}
                            </span>
                            <span className="font-mono text-lg text-white/60">USDC</span>
                        </div>
                    </div>

                    <div className="sm:border-l sm:border-white/10 sm:pl-14">
                        <p className="label">At risk</p>
                        <div className="mt-3 flex items-baseline gap-2.5">
                            <span
                                className={`figure font-mono text-3xl font-medium ${
                                    atRisk > 0 ? 'text-amber-300' : 'text-white/70'
                                }`}
                            >
                                {isLoading ? <Skeleton w="6ch" /> : data?.atRiskDisplay ?? '0.00'}
                            </span>
                            {!isLoading && atRisk === 0 && (
                                <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                            )}
                        </div>
                        <p className="mt-2 max-w-[30ch] text-[13px] leading-relaxed text-white/60">
                            {isLoading
                                ? ''
                                : atRisk > 0
                                  ? 'In dunning. The keeper is retrying these on a backoff.'
                                  : 'Nothing in dunning. Every plan is collecting on schedule.'}
                        </p>
                    </div>
                </div>

                {/* Running totals. Context for the two figures above, not peers of
                    them, so they read as a line rather than as more cards. */}
                <dl className="mt-9 flex flex-wrap gap-x-10 gap-y-5 text-sm">
                    <InlineFigure label="Settled to you" value={data?.settledDisplay} loading={isLoading} />
                    <InlineFigure label="Collected this week" value={data?.collectedThisWeekDisplay} loading={isLoading} />
                    {/* Left undefined when nothing has come due, so InlineFigure
                        shows its dash rather than a rate nothing has measured. */}
                    <InlineFigure
                        label="Collection rate"
                        value={
                            data?.collectionRate == null ? undefined : `${data.collectionRate.toFixed(1)}%`
                        }
                        loading={isLoading}
                        accent={data?.collectionRate != null && data.collectionRate >= 95}
                    />
                </dl>
            </header>

            <KeeperStrip />

            <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-lg font-semibold tracking-tight">Payment plans</h2>
                <nav className="flex items-center gap-1" aria-label="Filter plans">
                    {(['all', 'collecting', 'dunning', 'closed'] as const).map((f) => (
                        <button
                            key={f}
                            onClick={() => onFilter(f)}
                            aria-pressed={filter === f}
                            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                                filter === f
                                    ? 'bg-primary text-black'
                                    : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </nav>
            </div>

            <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-white/10 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-white/60">
                            <th className="pb-3 pr-4 font-normal">Order</th>
                            <th className="pb-3 pr-4 font-normal">Borrower</th>
                            <th className="pb-3 pr-4 text-right font-normal">Plan</th>
                            <th className="pb-3 pr-4 text-right font-normal">Outstanding</th>
                            <th className="pb-3 pr-4 font-normal">Next collection</th>
                            <th className="pb-3 font-normal">State</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            [0, 1, 2, 3, 4].map((i) => <RowSkeleton key={i} />)
                        ) : plans.length === 0 ? (
                            <tr>
                                <td colSpan={6}>
                                    <EmptyState filter={filter} />
                                </td>
                            </tr>
                        ) : (
                            plans.map((p) => <PlanRow key={p.loanId} plan={p} />)
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

type Health = {
    status: 'healthy' | 'degraded' | 'down' | 'unknown';
    jobs: Array<{ job: string; status: string; minutesSinceLastRun: number | null }>;
    incidents: string[];
};

/**
 * Whether anything is collecting right now.
 *
 * A merchant's real question is not "is the API up" but "is my money being
 * chased". Silence is the failure that costs the most, so a stopped keeper has
 * to be visible here rather than simply showing nothing.
 */
function KeeperStrip() {
    const { data } = useSWR<Health>('/api/keeper/health', (u: string) => fetch(u).then((r) => r.json()), {
        refreshInterval: 30_000,
    });
    if (!data?.jobs) return null;

    const tone = {
        healthy: 'text-primary',
        degraded: 'text-amber-300',
        down: 'text-rose-300',
        unknown: 'text-white/65',
    }[data.status];

    const label = {
        healthy: 'Collections running',
        degraded: 'Collections degraded',
        down: 'Collections stopped',
        unknown: 'No keeper activity yet',
    }[data.status];

    const collection = data.jobs.find((j) => j.job === 'collection');
    const ago =
        collection?.minutesSinceLastRun === null || collection?.minutesSinceLastRun === undefined
            ? null
            : collection.minutesSinceLastRun < 1
              ? 'just now'
              : `${collection.minutesSinceLastRun}m ago`;

    return (
        <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-white/[0.06] pt-5">
            <span className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] ${tone}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {label}
            </span>
            {ago && <span className="font-mono text-[11px] text-white/65">last pass {ago}</span>}
            {data.incidents.length > 0 && (
                <span className="font-mono text-[11px] text-amber-300/80">{data.incidents[0]}</span>
            )}
        </div>
    );
}

function PlanRow({ plan }: { plan: Plan }) {
    const progress = plan.installmentCount === 0 ? 0 : plan.installmentsPaid / plan.installmentCount;

    return (
        <tr className="group border-b border-white/[0.06] transition-colors hover:bg-white/[0.025]">
            <td className="py-4 pr-4">
                <span className="font-mono text-[13px] text-white/85">{plan.orderId}</span>
            </td>
            <td className="py-4 pr-4">
                <span className="font-mono text-[13px] text-white/55">
                    {plan.borrower.slice(0, 6)}&hellip;{plan.borrower.slice(-4)}
                </span>
            </td>
            <td className="py-4 pr-4 text-right">
                {/* Installment progress reads as discrete ticks because the count is
                    small and exact -- "3 of 4 collected", not an approximate bar. */}
                <span className="inline-flex items-center gap-[3px] align-middle" aria-hidden>
                    {Array.from({ length: plan.installmentCount }).map((_, i) => (
                        <span
                            key={i}
                            className={`h-3.5 w-[3px] rounded-full ${
                                i < plan.installmentsPaid ? 'bg-primary' : 'bg-white/15'
                            }`}
                        />
                    ))}
                </span>
                <span className="ml-2.5 font-mono text-[13px] tabular-nums text-white/55">
                    {plan.installmentsPaid}/{plan.installmentCount}
                </span>
                <span className="sr-only">
                    {plan.installmentsPaid} of {plan.installmentCount} installments collected
                </span>
            </td>
            <td className="py-4 pr-4 text-right font-mono text-[13px] tabular-nums text-white/85">
                {plan.outstandingDisplay}
            </td>
            <td className="py-4 pr-4 font-mono text-[13px] text-white/55">
                {plan.nextDueAt ? formatDue(plan.nextDueAt) : <span className="text-white/70">&mdash;</span>}
            </td>
            <td className="py-4">
                <div className="flex items-center justify-between gap-3">
                    <StateBadge plan={plan} />
                    {plan.lastTxHash && (
                        <a
                            href={`https://sepolia.etherscan.io/tx/${plan.lastTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                            aria-label={`View last transaction for order ${plan.orderId} on Etherscan`}
                        >
                            <ArrowUpRight className="h-3.5 w-3.5 text-white/40 hover:text-primary" />
                        </a>
                    )}
                </div>
            </td>
        </tr>
    );
}

function StateBadge({ plan }: { plan: Plan }) {
    if (plan.status === 'liquidated' || plan.status === 'defaulted') {
        return <Badge tone="danger">Liquidated</Badge>;
    }
    if (plan.status === 'repaid') return <Badge tone="muted">Repaid</Badge>;
    if (plan.state === 'dunning') {
        return <Badge tone="warn">Retry {plan.attempts}</Badge>;
    }
    return <Badge tone="live">Collecting</Badge>;
}

function Badge({ tone, children }: { tone: 'live' | 'warn' | 'danger' | 'muted'; children: React.ReactNode }) {
    const tones = {
        // Lime is reserved for "the keeper is actively working this plan".
        live: 'text-primary before:bg-primary',
        warn: 'text-amber-300 before:bg-amber-300',
        danger: 'text-rose-300 before:bg-rose-300',
        muted: 'text-white/60 before:bg-white/30',
    } as const;

    return (
        <span
            className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] before:h-1.5 before:w-1.5 before:rounded-full before:content-[''] ${tones[tone]}`}
        >
            {children}
        </span>
    );
}

function Figure({
    label,
    value,
    loading,
    tone,
}: {
    label: string;
    value?: string;
    loading: boolean;
    tone?: 'warn';
}) {
    return (
        <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">{label}</dt>
            <dd
                className={`mt-2 font-mono text-xl tabular-nums tracking-tight ${
                    tone === 'warn' ? 'text-amber-300' : 'text-white/90'
                }`}
            >
                {loading ? <Skeleton w="6ch" /> : value ?? '-'}
            </dd>
        </div>
    );
}

function InlineFigure({
    label,
    value,
    loading,
    accent,
}: {
    label: string;
    value?: string;
    loading?: boolean;
    accent?: boolean;
}) {
    return (
        <div className="flex items-baseline gap-2.5">
            <dt className="text-white/60">{label}</dt>
            <dd className={`figure font-mono font-medium ${accent ? 'text-primary' : 'text-white/85'}`}>
                {loading ? <Skeleton w="5ch" /> : (value ?? '-')}
            </dd>
        </div>
    );
}

function EmptyState({ filter }: { filter: string }) {
    const copy: Record<string, { head: string; body: string }> = {
        all: {
            head: 'No payment plans yet',
            body: 'Plans appear here the moment a customer splits a purchase at your checkout. Each one is collected automatically.',
        },
        collecting: { head: 'Nothing collecting right now', body: 'Every active plan is either paid up or in retry.' },
        dunning: { head: 'No plans in retry', body: 'Every installment has collected on the first attempt.' },
        closed: { head: 'No closed plans', body: 'Repaid and liquidated plans are kept here for your records.' },
    };
    const { head, body } = copy[filter] ?? copy.all;

    return (
        <div className="py-20 text-center">
            <p className="text-base font-medium text-white/85">{head}</p>
            <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-white/60">{body}</p>
        </div>
    );
}

function ErrorState({ message }: { message: string }) {
    return (
        <div className="rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-6">
            <p className="text-sm font-medium text-rose-200">We could not load your plans</p>
            <p className="mt-1.5 font-mono text-[13px] text-rose-200/70">{message}</p>
            <button
                onClick={() => location.reload()}
                className="mt-4 rounded-md border border-rose-300/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-rose-100 transition-colors hover:bg-rose-400/10"
            >
                Try again
            </button>
        </div>
    );
}

function Skeleton({ w }: { w: string }) {
    return (
        <span
            className="inline-block h-[0.75em] animate-pulse rounded bg-white/10 align-middle"
            style={{ width: w }}
        />
    );
}

function RowSkeleton() {
    return (
        <tr className="border-b border-white/[0.06]">
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <td key={i} className="py-4 pr-4">
                    <Skeleton w={i === 1 ? '12ch' : '7ch'} />
                </td>
            ))}
        </tr>
    );
}

/**
 * The merchant gate.
 *
 * This was a 26rem column centred in a full-screen void, which is the least
 * informative thing a dashboard can show before you sign in: it asks for a
 * wallet without showing what the wallet buys you. It is now a split -- the
 * pitch beside the redacted shape of the ledger itself.
 *
 * The bars are bars rather than sample figures on purpose. A merchant console
 * that renders a plausible fake balance to look populated has misled its user
 * before they have even connected.
 */
function SignIn({ onSignIn }: { onSignIn: () => void }) {
    // There is no settlement cycle and no escrow to wait on: createLoan sends
    // the merchant the full principal out of protocol liquidity in the same
    // transaction that opens the plan. The old line described a payout timing
    // model this protocol does not have, and buried the part that actually
    // matters to a merchant -- that the repayment risk is not theirs.
    const facts = [
        'You are paid the full amount when the plan opens, out of protocol liquidity. The protocol carries the repayment risk, not you.',
        'Every instalment is simulated before it is sent, so a charge that would fail becomes a dunning event instead of a burnt transaction.',
        'Gas is sponsored. Your customers never hold the native token.',
    ];

    return (
        <div className="shell">
            <div className="split min-h-[80dvh] items-center py-16">
                <div className="max-w-xl">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">PolarisPay</p>
                    <h1 className="page-title mt-5">Your collections ledger</h1>
                    <p className="page-lede mt-4 text-[15px]">
                        Every plan you have originated, what it has collected, and what is still owed to you.
                    </p>

                    <button
                        type="button"
                        onClick={onSignIn}
                        className="mt-8 flex w-full max-w-xs items-center justify-center gap-2.5 rounded-lg bg-primary px-6 py-3.5 text-sm font-semibold text-black transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-[0_6px_24px_-6px_rgba(166,242,74,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-0"
                    >
                        Connect wallet
                    </button>

                    <ul className="mt-10 grid gap-3.5">
                        {facts.map((fact) => (
                            <li key={fact} className="flex gap-3 text-sm leading-relaxed text-white/55">
                                <span aria-hidden className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-primary/70" />
                                {fact}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* The ledger's own shape, with the numbers withheld. */}
                <div className="surface overflow-clip" aria-hidden>
                    <div className="grid grid-cols-2 divide-x divide-white/[0.06] border-b border-white/[0.06]">
                        {['Collected', 'Outstanding'].map((label) => (
                            <div key={label} className="stat">
                                <span className="label">{label}</span>
                                <span className="mt-1 block h-6 w-24 rounded bg-white/[0.07]" />
                            </div>
                        ))}
                    </div>

                    <div className="divide-y divide-white/[0.06]">
                        {['70%', '52%', '81%', '44%', '63%'].map((w, i) => (
                            <div key={w} className="flex items-center justify-between gap-6 px-5 py-3.5">
                                <span className="block h-2 rounded-full bg-white/[0.08]" style={{ width: w }} />
                                <span
                                    className="block h-2 w-12 shrink-0 rounded-full"
                                    style={{ background: i % 3 === 0 ? 'rgba(166,242,74,0.22)' : 'rgba(255,255,255,0.06)' }}
                                />
                            </div>
                        ))}
                    </div>

                    <p className="border-t border-white/[0.06] px-5 py-4 text-xs leading-relaxed text-white/60">
                        Connect and this fills with your own originations and settlement history.
                    </p>
                </div>
            </div>
        </div>
    );
}

function formatDue(iso: string): string {
    const due = new Date(iso);
    const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
    if (days < -1) return `${Math.abs(days)}d overdue`;
    if (days === -1 || days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 14) return `In ${days} days`;
    return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
