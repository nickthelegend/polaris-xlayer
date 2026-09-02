"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import useSWR from "swr"

/**
 * Spend the stock, don't sell the stock.
 *
 * A shopper holding tokenized equity checks out at a merchant who only takes
 * stablecoin. Rather than closing the position they lock the shares here and
 * the merchant is paid immediately from the pool — the shopper keeps the
 * upside and repays inside the tenor.
 *
 * Everything on this page is read from X Layer and every action is a real
 * signed transaction against the deployed engine.
 */

const usd = (v: string, d = 6) =>
  (Number(v) / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sh = (v: string) => (Number(v) / 1e18).toFixed(4)
const fetcher = (u: string) => fetch(u, { cache: "no-store" }).then((r) => r.json())

export default function StockCredit() {
  const { data: state, mutate } = useSWR("/api/stock/state", fetcher, { refreshInterval: 15000 })
  const [shares, setShares] = useState("10")
  const [orderRef, setOrderRef] = useState("")
  const [quote, setQuote] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<any>(null)

  useEffect(() => { setOrderRef("basket-" + Math.random().toString(36).slice(2, 8)) }, [])

  const call = useCallback(async (url: string, body: any, tag: string) => {
    setError(null); setBusy(tag)
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json()
    setBusy(null)
    if (!r.ok) { setError(j.error); return null }
    return j
  }, [])

  const getQuote = async () => {
    setQuote(null)
    const j = await call("/api/stock/quote", { shares, tenorDays: 7 }, "quote")
    if (j) setQuote(j)
  }

  const pay = async () => {
    setDone(null)
    const j = await call("/api/stock/checkout", { shares, borrowAmount: quote.maxBorrow, orderRef, tenorDays: 7 }, "pay")
    if (j) { setDone(j); setQuote(null); setOrderRef("basket-" + Math.random().toString(36).slice(2, 8)); mutate() }
  }

  const faucet = async () => { if (await call("/api/stock/faucet", { shares: 25 }, "faucet")) mutate() }

  if (!state) return <div className="py-16 text-white/50">Reading X Layer…</div>
  if (state.error) return <div className="mt-8 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-6 text-rose-200">{state.error}</div>

  const ltv = state.price.marketOpen
    ? state.risk.maxLtvBps / 100
    : (state.risk.maxLtvBps * (10000 - state.risk.closedMarketHaircutBps)) / 1e6

  return (
    <div className="py-10">
      <p className="label">Polaris · stock credit</p>
      <h1 className="mt-3 max-w-[18ch] text-[clamp(2rem,5vw,3.4rem)] font-medium leading-[0.98] tracking-[-0.035em] text-white">
        Spend the stock. Don&rsquo;t sell the stock.
      </h1>
      <p className="mt-4 max-w-[62ch] text-white/60">
        Pay the merchant in stablecoin against tokenized equity you keep. The shares lock,
        the merchant is paid now, and you still own the position.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-4" data-testid="error">
          <p className="text-sm text-rose-200">{error}</p>
        </div>
      )}

      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: `${state.tokens.stockSymbol} price`, v: `$${usd(state.price.usdPerShare, 8)}`, s: `${state.price.marketOpen ? "market open" : "market closed"} · ${state.price.source}`, t: "text-emerald-300", id: "price" },
          { l: "You hold", v: sh(state.balances.shopperShares), s: state.tokens.stockSymbol, t: "text-white", id: "shares" },
          { l: "Pool available", v: `$${usd(state.pool.available)}`, s: "merchant is paid from here", t: "text-sky-300", id: "pool" },
          { l: "Max LTV", v: `${ltv}%`, s: state.price.marketOpen ? "venue open" : "after-hours haircut applied", t: "text-white", id: "ltv" },
        ].map((t) => (
          <div key={t.l} className="bg-background p-5" data-testid={`tile-${t.id}`}>
            <p className="label">{t.l}</p>
            <p className={`mt-2 font-mono text-[26px] leading-none ${t.t}`}>{t.v}</p>
            <p className="mt-2 text-[11px] text-white/40">{t.s}</p>
          </div>
        ))}
      </div>

      <div className="surface mt-6 p-6 md:p-8">
        <h2 className="text-lg font-medium text-white">Pay with stock credit</h2>
        <p className="mt-1 font-mono text-[13px] text-white/50">Merchant {state.actors.merchant.slice(0, 12)}…</p>

        <label className="label mt-6 block" htmlFor="shares">Shares to lock</label>
        <input
          id="shares" value={shares} inputMode="decimal" aria-label="Shares to lock" data-testid="shares-input"
          onChange={(e) => { setShares(e.target.value); setQuote(null) }}
          className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xl text-white outline-none focus:border-white/25"
        />

        <label className="label mt-5 block" htmlFor="ref">Order reference</label>
        <input
          id="ref" value={orderRef} aria-label="Order reference" data-testid="ref-input"
          onChange={(e) => setOrderRef(e.target.value)}
          className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-sm text-white outline-none focus:border-white/25"
        />

        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={getQuote} disabled={!!busy} data-testid="quote-btn"
            className="rounded-md bg-white px-5 py-3 text-sm font-medium text-black transition hover:opacity-85 active:scale-[0.98] disabled:opacity-40">
            {busy === "quote" ? "Quoting…" : "Get a quote"}
          </button>
          <button onClick={faucet} disabled={!!busy} data-testid="faucet-btn"
            className="rounded-md border border-white/15 px-5 py-3 text-sm text-white transition hover:border-white/30 active:scale-[0.98] disabled:opacity-40">
            {busy === "faucet" ? "Minting…" : "Get 25 test shares"}
          </button>
        </div>

        {quote && (
          <div className="mt-7 border-t border-white/10 pt-2" data-testid="quote">
            {[
              ["Collateral value", `$${usd(quote.collateralValue)}`, ""],
              [`Ceiling at ${quote.ltvBps / 100}% LTV`, `$${usd(quote.maxBorrow)}`, ""],
              ["Fee, 7 days", `$${usd(quote.feeOnMax)}`, ""],
              ["Merchant is paid", `$${usd(quote.maxBorrow)}`, "text-emerald-300 text-lg"],
            ].map(([l, v, cls]) => (
              <div key={l} className="flex items-baseline justify-between border-b border-white/10 py-2.5 last:border-0">
                <span className="text-sm text-white/60">{l}</span>
                <span className={`font-mono ${cls || "text-white"}`}>{v}</span>
              </div>
            ))}
            <button onClick={pay} disabled={!!busy} data-testid="pay-btn"
              className="mt-5 w-full rounded-md bg-emerald-300 px-5 py-3.5 text-sm font-medium text-black transition hover:opacity-85 active:scale-[0.99] disabled:opacity-40">
              {busy === "pay" ? "Signing on X Layer…" : `Pay $${usd(quote.maxBorrow)} with stock credit`}
            </button>
          </div>
        )}

        {done && (
          <div className="mt-6 rounded-lg border border-emerald-300/30 bg-emerald-300/[0.06] p-4" data-testid="checkout-done">
            <p className="text-sm text-emerald-200">
              Loan #{done.loanId} opened. The merchant has been paid and your shares are locked.{" "}
              <a href={done.explorer} target="_blank" rel="noreferrer" className="underline underline-offset-4">View the transaction</a>
              {" · "}
              <Link href="/stock/positions" className="underline underline-offset-4">See your positions</Link>
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 font-mono text-[11px] text-white/35">
        Block {state.blockNumber} · engine {state.addresses.engine}
      </p>
      {state.standIns?.length > 0 && (
        <p className="mt-2 font-mono text-[11px] text-white/35" data-testid="standins">
          Stand-ins on this network: {state.standIns.map((s: any) => s.what).join(", ")} — no real xStock or USDT0 exists on X Layer testnet.
        </p>
      )}
    </div>
  )
}
