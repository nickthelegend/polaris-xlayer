"use client"

import { Shield } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import useSWR from "swr"
import { useAccount } from "wagmi"

import { ACTIVE_CHAIN } from "@/lib/chains"

const fetcher = (u: string) => fetch(u, { cache: "no-store" }).then((r) => r.json())

export function AppFooter() {
    const pathname = usePathname()
    const { isConnected } = useAccount()

    /*
     * The liveness light, wired to something that can actually be down.
     *
     * The comment below used to end "this app has no health endpoint to wire
     * it to", which was true when it was written and stopped being true when
     * /api/stock/health arrived. That endpoint checks the RPC, the freshness
     * of the price and the pool's ability to pay a merchant, and reports each
     * separately — so the dot can mean something instead of being decoration
     * that says ACTIVE while the relayer is down.
     */
    const { data: health, error: healthError } = useSWR("/api/stock/health", fetcher, {
        refreshInterval: 60_000,
    })
    const status = healthError ? "down" : health ? (health.ok ? "ok" : "degraded") : "unknown"

    if (pathname === "/" && !isConnected) return null
    return (
        // opacity-40 on the element dimmed everything inside it, including the
        // 10px labels and both links, to roughly 3.6:1 -- below the 4.5:1 that
        // small text needs. Dimming only the text colour keeps the same quiet
        // footer without taking the type below the threshold.
        <footer className="w-full flex flex-col md:flex-row justify-between items-center py-6 px-6 md:px-12 border-t border-white/5 gap-6 text-foreground/65 font-mono">
            <div className="flex items-center gap-8">
                {/* This was a pulsing green dot next to a hardcoded
                    "POLARIS_PROTOCOL: ACTIVE". It read as a liveness light but
                    checked nothing, so it said ACTIVE just as confidently while
                    the keeper was down -- the one moment the indicator existed
                    to warn about. It reads /api/stock/health now, and stays
                    silent until that answers rather than guessing green. */}
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em]">
                    <span
                        title={
                            status === "ok" ? "RPC, price and liquidity all healthy"
                            : status === "degraded" ? "Reachable, but something is degraded — see /api/stock/health"
                            : status === "down" ? "The health check could not be reached"
                            : "Checking"
                        }
                        className={
                            "size-1.5 rounded-full " +
                            (status === "ok" ? "bg-primary"
                             : status === "degraded" ? "bg-amber-400"
                             : status === "down" ? "bg-rose-400"
                             : "bg-foreground/25")
                        }
                    />
                    POLARIS_PROTOCOL
                </div>
                {/* This read SEPOLIA — a hardcoded label for a chain this app
                    has not run on since the port, sitting in the footer of
                    every page. The name comes from the chain config now, so it
                    cannot disagree with what the app is connected to. */}
                <div className="text-[10px] flex items-center gap-1 font-bold uppercase tracking-[0.2em]">
                    <Shield className="w-3 h-3" />
                    {ACTIVE_CHAIN.name}
                </div>
            </div>
            <div className="flex gap-6">
                <Link href="/docs" className="hover:text-primary transition-colors text-[10px] font-bold uppercase tracking-widest">Docs</Link>
                {/* This pointed at the engine's OKLink address page, which
                    reports "No transaction records currently found under this
                    address" even though the engine has written every loan in
                    the book — OKLink's testnet indexer does not list activity
                    for contract addresses. Somebody following the one link
                    labelled CONTRACTS landed on what looked like a dead
                    contract. Sourcify has the verified source instead, which
                    is what the link was for. */}
                <a href="https://repo.sourcify.dev/1952/0xb649453f78b01F832d97fDD8a12Bf27ac5abf446" target="_blank" rel="noreferrer" className="hover:text-primary transition-colors text-[10px] font-bold uppercase tracking-widest">Contracts</a>
            </div>
        </footer>
    )
}
