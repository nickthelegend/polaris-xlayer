"use client"

import type React from "react"
import { Lock, ShieldCheck, Wallet } from "lucide-react"
import { useAccount } from "wagmi"

import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button"

/**
 * The wallet gate.
 *
 * Gate only what is genuinely per-wallet. A limit is one wallet's credit and a
 * faucet sends to one address, so both need to know who is asking; the merchant
 * directory is public and used to sit behind this for no reason.
 *
 * What it says matters as much as when it appears. The previous copy announced
 * AUTH_REQUIRED over "please establish a link with Polaris to access the
 * confidential lending terminals", which describes a system this is not, and it
 * nested the connect button inside a 64px circle that clipped its label. A gate
 * should say plainly what is behind it and why the wallet is needed, because
 * that is the only information that helps someone decide to connect.
 *
 * Layout: this was a small card centred in 60dvh of nothing, which is the shape
 * of a page that failed rather than one that is waiting. It is now a split, and
 * the right half shows the redacted shape of what connecting reveals. The bars
 * are deliberately bars and not plausible numbers -- a gate that invents a
 * balance to look busy has lied to you before you have even connected.
 */

function RedactedRow({ width, wide }: { width: string; wide?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="grid flex-1 gap-2">
        <span
          className="block h-2 rounded-full bg-foreground/[0.09]"
          style={{ width }}
          aria-hidden
        />
        <span
          className="block h-2 rounded-full bg-foreground/[0.05]"
          style={{ width: wide ? "38%" : "26%" }}
          aria-hidden
        />
      </div>
      <span className="block h-3 w-16 rounded-full bg-foreground/[0.07]" aria-hidden />
    </div>
  )
}

export function ConnectGate({
  children,
  title = "Connect to continue",
  reason = "This page reads state that belongs to one wallet, so it needs to know which one is asking.",
  previewLabel = "Your plans",
  previewNote = "your own plans, limit and collection schedule",
}: {
  children: React.ReactNode
  title?: string
  reason?: string
  /** Names what the redacted panel stands in for on this particular page. */
  previewLabel?: string
  /**
   * Completes "Connect and this fills with ...". It travels with previewLabel:
   * a faucet headed "Your balances" that promised a collection schedule was
   * describing a different page.
   */
  previewNote?: string
}) {
  const { isConnected, isConnecting } = useAccount()

  if (isConnecting) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <p className="flex items-center gap-3 text-sm text-foreground/60">
          <span className="size-4 animate-spin rounded-full border border-foreground/20 border-t-primary" />
          Waiting for your wallet
        </p>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="split py-12 md:py-20">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-primary">
            <Wallet className="size-3.5" />
            Wallet required
          </span>

          <h1 className="page-title mt-6">{title}</h1>
          <p className="page-lede mt-4">{reason}</p>

          <div className="mt-8">
            <ConnectWalletButton />
          </div>

          <ul className="mt-9 grid gap-3">
            {[
              {
                icon: ShieldCheck,
                text: "Read-only. Connecting does not move anything, and nothing is signed until you approve it.",
              },
              {
                icon: Lock,
                text: "No account, no email, no application. Your limit is read from the chain, not from a form.",
              },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-sm leading-relaxed text-foreground/55">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary/70" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        {/* The shape of what is behind the gate, with the values withheld. */}
        <div className="surface overflow-clip" aria-hidden>
          <div className="flex items-center justify-between border-b border-foreground/[0.08] px-5 py-4">
            <p className="label">{previewLabel}</p>
            <span className="inline-flex items-center gap-1.5 text-[0.6875rem] uppercase tracking-[0.08em] text-foreground/35">
              <Lock className="size-3" />
              Locked
            </span>
          </div>

          <div className="divide-y divide-foreground/[0.06]">
            <RedactedRow width="64%" wide />
            <RedactedRow width="48%" />
            <RedactedRow width="72%" wide />
            <RedactedRow width="40%" />
          </div>

          <div className="border-t border-foreground/[0.08] px-5 py-4">
            <p className="text-xs leading-relaxed text-foreground/60">
              Connect and this fills with {previewNote}.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
