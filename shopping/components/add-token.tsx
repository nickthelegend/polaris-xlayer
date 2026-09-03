"use client"

import { useState } from "react"
import { Plus, Check } from "lucide-react"

import { ADDRESSES } from "@/lib/polaris-client"

/**
 * Put the tokens in the wallet's own list.
 *
 * A shopper pays with tXAAPL and settles in pUSDC, and until the wallet knows
 * about either, both are invisible — the balance reads zero and the collateral
 * they supposedly kept is nowhere on screen. `wallet_watchAsset` is the one
 * call that fixes that, and almost nothing bothers to make it.
 *
 * It is also the cheapest way to make "you still own the position" true to the
 * eye: after checkout the shares are still in the wallet's token list, locked
 * rather than gone.
 */

type Watchable = { address: string; symbol: string; decimals: number; label: string }

const TOKENS: Watchable[] = [
  { address: ADDRESSES.stock, symbol: "tXAAPL", decimals: 18, label: "Add_tXAAPL" },
  { address: ADDRESSES.stable, symbol: "pUSDC", decimals: 6, label: "Add_pUSDC" },
]

export function AddTokens() {
  const [added, setAdded] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const watch = async (t: Watchable) => {
    const eth = (globalThis as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum
    if (!eth) return
    setBusy(t.symbol)
    try {
      // The wallet decides; a refusal is a choice, not an error worth shouting
      // about, so nothing is claimed unless it says yes.
      const ok = await eth.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: t.address, symbol: t.symbol, decimals: t.decimals } },
      })
      if (ok) setAdded((a) => ({ ...a, [t.symbol]: true }))
    } catch {
      /* declined or unsupported — leave the button as it was */
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TOKENS.map((t) => (
        <button
          key={t.symbol}
          onClick={() => watch(t)}
          disabled={busy !== null || added[t.symbol]}
          className="inline-flex items-center gap-1.5 border border-white/10 px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white hover:border-white/30 transition-all disabled:opacity-40"
        >
          {added[t.symbol] ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {added[t.symbol] ? `${t.symbol}_Added` : t.label}
        </button>
      ))}
    </div>
  )
}
