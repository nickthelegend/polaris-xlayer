'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import Image from 'next/image';
import useSWR from 'swr';
import { ArrowRight, ShoppingBag } from 'lucide-react';

import { CheckoutStack } from '@/components/CheckoutStack';

/**
 * The front door.
 *
 * Five sections, five different shapes: an asymmetric hero carrying a real
 * screenshot, a proof band ruled off rather than boxed, a pinned stack for the
 * checkout sequence, a code-dominant split, and a hairline footer. Repeating one
 * shape is what made the earlier version read as a template.
 *
 * The only image on the page is a capture of the real store, taken from the
 * running app. A stock photograph would say nothing true about a checkout.
 */

const fetcher = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
};

type Health = {
    book: {
        activeLoans: number;
        inDunning: number;
        liquidationCandidates: number;
        collectionRate: number;
    };
};

const STEPS = [
    {
        title: 'The chain underwrites the shopper',
        body: 'No application and no bureau. The limit is read from the wallet’s own repayment history, so a first-time shopper starts at a baseline and earns their way up by paying on time.',
    },
    {
        title: 'They approve once, and the plan opens',
        body: 'A single signature covers the whole schedule. Nothing is locked up front, and the shopper never pays gas to start a plan.',
    },
    {
        // Nothing here waits on a payout cycle: createLoan pays the merchant the
        // full principal out of protocol liquidity as the plan opens, so the
        // collections that follow are the protocol recovering its own money.
        title: 'You are paid up front, then the keeper collects',
        body: 'The full price reaches your payout address as the plan opens, out of protocol liquidity. Each instalment is then charged on its due date, and a charge that fails enters a retry ladder rather than being written off. That risk is the protocol’s, not yours.',
    },
];

const SNIPPET = `import { PayWithPolarisBNPL } from "polarispay-sdk/react";

// Reads the shopper's limit from the chain, shows the
// four-payment schedule, and opens the plan.
<PayWithPolarisBNPL
  merchant="0xYourPayoutAddress"
  amount="180.00"
  orderId="ORDER-1042"
  onSuccess={(r) => console.log(r.transactionHash)}
/>`;

export default function Home() {
    const { data: health } = useSWR<Health>('/api/keeper/health', fetcher, {
        refreshInterval: 60_000,
        shouldRetryOnError: false,
    });

    return (
        <div className="min-h-screen bg-background font-display text-foreground selection:bg-primary/30">
            {/* Asymmetric split. The copy holds the left five columns and the
                product sits in the right seven, bleeding past the container so
                the screenshot reads as a window rather than a framed tile. */}
            <section className="mx-auto max-w-[1400px] px-6 pt-20 md:px-10 md:pt-24">
                <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
                    <div>
                        <h1
                            data-reveal
                            style={{ ["--reveal-index" as string]: 0 }}
                            className="max-w-[13ch] text-[clamp(2.75rem,6vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.038em]"
                        >
                            Let shoppers pay in four.
                        </h1>
                        <p
                            data-reveal
                            style={{ ["--reveal-index" as string]: 1 }}
                            className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-foreground/55"
                        >
                            A buy-now-pay-later checkout for on-chain stores. The limit comes from
                            the shopper&apos;s own wallet history.
                        </p>
                        <div
                            data-reveal
                            style={{ ["--reveal-index" as string]: 2 }}
                            className="mt-9 flex flex-wrap gap-3"
                        >
                            <Link
                                href="/store"
                                className="inline-flex items-center gap-2 rounded-[calc(var(--radius)-2px)] bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.99]"
                            >
                                <ShoppingBag className="size-4" />
                                Try the store
                            </Link>
                            <Link
                                href="/dashboard"
                                className="inline-flex items-center gap-2 rounded-[calc(var(--radius)-2px)] border border-foreground/12 px-6 py-3.5 text-sm font-medium text-foreground/75 transition-colors hover:border-foreground/28 hover:text-foreground"
                            >
                                Merchant console
                                <ArrowRight className="size-4" />
                            </Link>
                        </div>
                    </div>

                    <div
                        data-reveal
                        style={{ ["--reveal-index" as string]: 2 }}
                        className="relative"
                    >
                        <div className="surface overflow-hidden">
                            <Image
                                src="/shots/checkout.png"
                                alt="The Polaris checkout: three products priced in full and split into four payments, beside the checkout panel."
                                width={2230}
                                height={740}
                                className="w-full"
                                priority
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Ruled band, not cards. Four figures on one line with hairlines
                above and below is a different shape from anything else here. */}
            {health && (
                <section className="mx-auto mt-24 max-w-[1400px] px-6 md:px-10">
                    <dl className="grid grid-cols-2 gap-y-9 border-y border-foreground/8 py-10 sm:grid-cols-4">
                        <Proof
                            term="Collected on time"
                            value={`${health.book.collectionRate.toFixed(0)}%`}
                            accent={health.book.collectionRate >= 95}
                        />
                        <Proof term="Plans collecting" value={String(health.book.activeLoans)} />
                        <Proof term="In dunning" value={String(health.book.inDunning)} />
                        {/* liquidationCandidates counts active loans that have
                            become eligible for liquidation. They are still being
                            chased and can still be repaid, so "Written off" -- a
                            closed, unrecoverable loan -- named the wrong thing. */}
                        <Proof term="At risk" value={String(health.book.liquidationCandidates)} />
                    </dl>
                    <p className="mt-6 max-w-[58ch] text-sm leading-relaxed text-foreground/60">
                        Read from the live book. Every instalment behind these was charged by a
                        keeper running on KeeperHub, with gas sponsored, and each one has a
                        transaction you can open.
                    </p>
                </section>
            )}

            {/* Pinned sequence. */}
            <section className="mx-auto mt-28 max-w-[1400px] px-6 md:px-10">
                <h2 className="max-w-[18ch] text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
                    What happens at checkout
                </h2>
                <div className="mt-12">
                    <CheckoutStack steps={STEPS} />
                </div>
            </section>

            {/* Code-dominant split, reversing the hero's weighting so the two
                two-column sections do not read as the same layout twice. */}
            <section className="mx-auto mt-28 max-w-[1400px] px-6 pb-28 md:px-10">
                <div className="grid gap-12 border-t border-foreground/8 pt-16 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20">
                    <div className="lg:sticky lg:top-28 lg:self-start">
                        <h2 className="text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
                            One component
                        </h2>
                        <p className="mt-5 max-w-[42ch] leading-relaxed text-foreground/55">
                            It reads the limit itself and falls back to paying in full when the limit
                            will not stretch. If you want your own UI, the same operations are
                            available headless, and to an agent over MCP.
                        </p>
                        <Link
                            href="/store"
                            className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                            Try the store
                            <ArrowRight className="size-3.5" />
                        </Link>
                    </div>

                    <div className="surface overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-foreground/8 px-4 py-3">
                            <span className="size-2 rounded-full bg-foreground/15" />
                            <span className="size-2 rounded-full bg-foreground/15" />
                            <span className="size-2 rounded-full bg-foreground/15" />
                            <span className="ml-2 font-mono text-[11px] text-foreground/60">
                                checkout.tsx
                            </span>
                        </div>
                        <pre className="overflow-x-auto px-5 py-5">
                            <code className="font-mono text-[13px] leading-[1.7] text-foreground/75">
                                {SNIPPET}
                            </code>
                        </pre>
                    </div>
                </div>
            </section>

            <footer className="border-t border-foreground/8">
                <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-8 md:px-10">
                    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/65">
                        Polaris · Sepolia
                    </p>
                    <a
                        href="https://sepolia.etherscan.io/address/0x21E9740DDe241f0653F699DAa206AfCE1FA25405"
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/65 transition-colors hover:text-foreground/90"
                    >
                        Contracts
                    </a>
                </div>
            </footer>
        </div>
    );
}

function Proof({ term, value, accent }: { term: string; value: string; accent?: boolean }) {
    return (
        <div>
            <dt className="label">{term}</dt>
            <dd
                className={`figure mt-2.5 text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold ${
                    accent ? 'text-primary' : ''
                }`}
            >
                {value}
            </dd>
        </div>
    );
}
