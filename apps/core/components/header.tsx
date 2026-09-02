"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button"

/*
 * Four destinations, not eight.
 *
 * Polaris used to ship its two credit products as two parallel sets of tabs —
 * stock credit on one side, BNPL on the other — which read as two apps sharing
 * a header and forced a visitor to work out which one they were in. They are
 * one product: you pay a merchant now and settle later, and the only thing
 * that differs is what backs the limit. So the nav names what you are doing
 * (pay, review, get paid, read), and the funding sources sit next to each
 * other inside the checkout where the choice actually belongs.
 */
const NAV = [
  { href: "/", label: "Pay" },
  { href: "/activity", label: "Activity" },
  { href: "/merchant", label: "Get paid" },
  { href: "/docs", label: "Docs" },
]

export function AppHeader() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 w-full pt-3 pb-2 ">
      <div
        className="grid grid-cols-[auto_1fr_auto] items-center rounded-none sm:rounded-2xl bg-[#05080f]/75 border-x-0 sm:border-x border-y border-primary/20 backdrop-blur-2xl px-4 py-3 min-h-[60px] shadow-[inset_0_0_20px_rgba(166,242,74,0.05)]"
        role="navigation"
        aria-label="Main"
      >
        {/* Left: menu icon + logo */}
        <div className="flex items-center gap-2">
          <Link href="/" className="font-semibold tracking-wide">
            <span className="inline-flex items-center gap-2">
              {/* The image is the link's only content, so its alt is the link's
                  accessible name. "Logo" describes the asset, not the destination. */}
              <Image src="/logo.png" alt="PolarisPay home" width={120} height={32} className="h-8 w-auto max-h-8" />
            </span>
          </Link>
        </div>

        {/* Center: nav, centered horizontally */}
        <nav className="hidden sm:flex items-center justify-center gap-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-xl px-3 py-1 text-sm transition-colors",
                pathname === n.href
                  ? "bg-primary text-black"
                  : "text-foreground/80 hover:text-foreground hover:bg-primary/15",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        {/* Right: wallet actions */}
        <div className="flex items-center justify-end gap-3 min-w-0">
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  )
}
