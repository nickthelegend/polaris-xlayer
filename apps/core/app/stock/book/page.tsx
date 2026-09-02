"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"

/** What the pool has lent, what it has earned, and the print behind every position. */

const usd = (v: string, d = 6) =>
  (Number(v) / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fetcher = (u: string) => fetch(u, { cache: "no-store" }).then((r) => r.json())

export default function Book() {
  const { data: state, mutate } = useSWR("/api/stock/state", fetcher, { refreshInterval: 15000 })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<any>(null)

  const post = useCallback(async (mode: string, pct?: number) => {
    setError(null); setOk(null); setBusy(mode + (pct ?? ""))
    const r = await fetch("/api/stock/price", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, pct }),
    })
    const j = await r.json()
    setBusy(null)
    if (!r.ok) { setError(j.error); return }
    setOk(j); mutate()
  }, [mutate])

  if (!state) return <div className="py-16 text-white/50">Reading X Layer…</div>

  return (
    <div className="py-10">
      <p className="label">Polaris · stock credit</p>
      <h1 className="mt-3 text-[clamp(2rem,5vw,3.4rem)] font-medium leading-[0.98] tracking-[-0.035em] text-white">
        The book &amp; the price
      </h1>
      <p className="mt-4 max-w-[62ch] text-white/60">
        What the pool has lent, what it has earned, and the print every position is valued against.
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-4" data-testid="error">
          <p className="text-sm text-rose-200">{error}</p>
        </div>
      )}
      {ok && (
        <div className="mt-6 rounded-lg border border-emerald-300/30 bg-emerald-300/[0.06] p-4" data-testid="price-done">
          <p className="text-sm text-emerald-200">
            Posted ${usd(ok.usdPerShare, 8)} — {ok.source}.{" "}
            <a href={ok.explorer} target="_blank" rel="noreferrer" className="underline underline-offset-4">View the transaction</a>
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Available", v: `$${usd(state.pool.available)}`, t: "text-sky-300", id: "pool-available" },
          { l: "Out on loan", v: `$${usd(state.pool.outstanding)}`, t: "text-white", id: "pool-outstanding" },
          { l: "Earned", v: `$${usd(state.pool.earned)}`, t: "text-emerald-300", id: "pool-earned" },
          { l: "Shares held", v: (Number(state.balances.engineShares) / 1e18).toFixed(4), t: "text-white", id: "engine-shares" },
        ].map((t) => (
          <div key={t.l} className="bg-background p-5" data-testid={t.id}>
            <p className="label">{t.l}</p>
            <p className={`mt-2 font-mono text-[26px] leading-none ${t.t}`}>{t.v}</p>
          </div>
        ))}
      </div>

      <div className="surface mt-6 p-6 md:p-8">
        <h2 className="text-lg font-medium text-white">The print</h2>
        <div className="mt-4">
          {[
            ["Price", `$${usd(state.price.usdPerShare, 8)}`, "text-emerald-300"],
            ["Source", state.price.source, "text-white"],
            ["Venue", state.price.marketOpen ? "open" : "closed", "text-white"],
            ["Age", `${state.price.ageSeconds}s`, "text-white"],
            ["Usable", state.price.fresh ? "yes" : "stale", state.price.fresh ? "text-emerald-300" : "text-rose-300"],
          ].map(([l, v, cls]) => (
            <div key={l as string} className="flex items-baseline justify-between border-b border-white/10 py-2.5 last:border-0">
              <span className="text-sm text-white/60">{l}</span>
              <span className={`font-mono text-sm ${cls}`}>{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={() => post("relay")} disabled={!!busy} data-testid="relay-btn"
            className="rounded-md bg-white px-5 py-3 text-sm font-medium text-black transition hover:opacity-85 disabled:opacity-40">
            {busy === "relay" ? "Fetching…" : "Relay the live print"}
          </button>
          <button onClick={() => post("move", -45)} disabled={!!busy} data-testid="crash-btn"
            className="rounded-md border border-white/15 px-5 py-3 text-sm text-white transition hover:border-white/30 disabled:opacity-40">
            Move the price −45%
          </button>
          <button onClick={() => post("move", 20)} disabled={!!busy} data-testid="rally-btn"
            className="rounded-md border border-white/15 px-5 py-3 text-sm text-white transition hover:border-white/30 disabled:opacity-40">
            Move the price +20%
          </button>
        </div>
        <p className="mt-4 text-[11px] text-white/40">
          A moved price is labelled as a demo move on chain, so it can never be mistaken for a real quote.
        </p>
      </div>
    </div>
  )
}
