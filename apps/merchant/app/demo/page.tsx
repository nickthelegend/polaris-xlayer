'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { Ledger } from '../dashboard/page';

/**
 * The collections ledger with no wallet connection required.
 *
 * The real dashboard is wallet-gated, which is correct for a merchant managing
 * their own money and wrong for anyone evaluating the product. This renders the
 * identical component against the identical API for a fixed demo merchant, so
 * the ledger can be seen - and recorded - without a wallet at all. It is
 * read-only by construction: there is nothing here to act on.
 */

const DEMO_MERCHANT_WALLET =
    process.env.NEXT_PUBLIC_DEMO_MERCHANT_WALLET ??
    '0x7a2e11b3ecebab8ea46966edadd4092583809b67';

const fetcher = async (url: string) => {
    const res = await fetch(url, { headers: { 'x-wallet-address': DEMO_MERCHANT_WALLET } });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
};

export default function DemoLedger() {
    const [filter, setFilter] = useState<'all' | 'collecting' | 'dunning' | 'closed'>('all');
    const { data, error, isLoading } = useSWR('/api/merchant/overview', fetcher, {
        refreshInterval: 20_000,
    });

    const plans = useMemo(() => {
        const all = data?.plans ?? [];
        if (filter === 'collecting')
            return all.filter((p: any) => p.status === 'active' && p.state !== 'dunning');
        if (filter === 'dunning') return all.filter((p: any) => p.state === 'dunning');
        if (filter === 'closed') return all.filter((p: any) => p.status !== 'active');
        return all;
    }, [data, filter]);

    return (
        <div className="min-h-screen bg-background text-foreground font-display selection:bg-primary/25">
            <main className="mx-auto max-w-[1180px] px-6 py-14 md:px-10">
                <p className="mb-8 inline-block rounded-full border border-white/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">
                    Demo · live Sepolia data · read only
                </p>
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
