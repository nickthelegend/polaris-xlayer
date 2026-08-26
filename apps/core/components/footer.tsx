"use client"

import { Shield } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAccount } from "wagmi"

export function AppFooter() {
    const pathname = usePathname()
    const { isConnected } = useAccount()

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
                    to warn about. This app has no health endpoint to wire it to
                    (/api/keeper/health lives in the merchant app), so the claim
                    is gone rather than faked. The name is a fact and stays. */}
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em]">
                    POLARIS_PROTOCOL
                </div>
                <div className="text-[10px] flex items-center gap-1 font-bold uppercase tracking-[0.2em]">
                    <Shield className="w-3 h-3" />
                    SEPOLIA
                </div>
            </div>
            <div className="flex gap-6">
                <Link href="/docs" className="hover:text-primary transition-colors text-[10px] font-bold uppercase tracking-widest">Docs</Link>
                <a href="https://sepolia.etherscan.io/address/0x21E9740DDe241f0653F699DAa206AfCE1FA25405" target="_blank" rel="noreferrer" className="hover:text-primary transition-colors text-[10px] font-bold uppercase tracking-widest">Contracts</a>
            </div>
        </footer>
    )
}
