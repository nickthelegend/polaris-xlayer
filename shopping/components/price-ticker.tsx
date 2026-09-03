"use client"

import { useEffect, useRef, useState } from "react"
import { TrendingDown, TrendingUp } from "lucide-react"

/**
 * The mark, in the shop's header.
 *
 * A storefront that takes stock as payment should say what the stock is worth,
 * for the same reason a bureau de change puts the rate in the window. It also
 * quietly makes the point the whole product rests on: this is a live market
 * price, read off chain, not a number the shop chose.
 *
 * The tick animation fires only when the price actually changes, and only
 * after the first read — otherwise every mount flashes green for no reason.
 */

const POLARIS = process.env.NEXT_PUBLIC_POLARIS_URL ?? "https://polaris-xlayer.vercel.app"

type Print = { usd: number; symbol: string; marketOpen: boolean; source: string }

export function PriceTicker() {
  const [print, setPrint] = useState<Print | null>(null)
  const [direction, setDirection] = useState<"up" | "down" | null>(null)
  const previous = useRef<number | null>(null)

  useEffect(() => {
    let live = true

    const read = async () => {
      try {
        const res = await fetch(`${POLARIS}/api/stock/state`, { cache: "no-store" })
        if (!res.ok) return
        const j = await res.json()
        if (!live || !j?.price?.usdPerShare) return

        const usd = Number(j.price.usdPerShare) / 1e8
        const before = previous.current
        if (before !== null && usd !== before) {
          setDirection(usd > before ? "up" : "down")
          // Long enough to register, short enough not to linger.
          setTimeout(() => live && setDirection(null), 1200)
        }
        previous.current = usd
        setPrint({
          usd,
          symbol: j.tokens?.stockSymbol ?? "tXAAPL",
          marketOpen: Boolean(j.price.marketOpen),
          source: j.price.source ?? "",
        })
      } catch {
        // A ticker that cannot reach the chain should say nothing rather than
        // show a stale number as though it were current.
      }
    }

    void read()
    const t = setInterval(read, 30_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])

  if (!print) return null

  const Arrow = direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : null

  return (
    <div
      title={`${print.source}${print.marketOpen ? "" : " · venue closed"}`}
      className="hidden sm:flex items-center gap-2 mr-6"
    >
      <span
        className={`size-1.5 rounded-full ${print.marketOpen ? "bg-green-500" : "bg-white/25"}`}
        aria-hidden
      />
      <span className="text-[10px] font-black uppercase tracking-tighter text-white/40">
        {print.symbol}
      </span>
      <span
        className={`font-mono text-[11px] font-black tabular-nums transition-colors duration-300 ${
          direction === "up" ? "text-green-400" : direction === "down" ? "text-red-400" : "text-white/70"
        }`}
      >
        ${print.usd.toFixed(2)}
      </span>
      {Arrow && <Arrow className="w-3 h-3 text-current" aria-hidden />}
      <span className="sr-only">
        {print.symbol} at {print.usd.toFixed(2)} dollars, venue {print.marketOpen ? "open" : "closed"}
      </span>
    </div>
  )
}
