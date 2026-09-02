"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import useSWR from "swr"

/** Every share locked, what it is securing, and how much cover is left. */

const usd = (v: string, d = 6) =>
  (Number(v) / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sh = (v: string) => (Number(v) / 1e18).toFixed(4)
const STATUS = ["None", "Active", "Repaid", "Liquidated", "Refunded"]
const TONE: Record<number, string> = {
  1: "border-emerald-300/40 text-emerald-200",
  2: "border-white/20 text-white/60",
  3: "border-rose-400/40 text-rose-200",
  4: "border-sky-300/40 text-sky-200",
}
const fetcher = (u: string) => fetch(u, { cache: "no-store" }).then((r) => r.json())

export default function Positions() {
  const [as, setAs] = useState("shopper")
  const { data: state, mutate } = useSWR(`/api/stock/state?as=${as}`, fetcher, { refreshInterval: 15000 })
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<any>(null)

  const act = useCallback(async (loanId: number, action: string) => {
    setError(null); setOk(null); setBusy(loanId)
    const r = await fetch("/api/stock/repay", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ loanId, action }),
    })
    const j = await r.json()
    setBusy(null)
    if (!r.ok) { setError(j.error); return }
    setOk(j); mutate()
  }, [mutate])

  if (!state) return <div className="py-16 text-white/50">Reading X Layer…</div>

  const loans = state.loans ?? []
  return (
    <div className="py-10">
      <p className="label">Polaris · stock credit</p>
      <h1 className="mt-3 text-[clamp(2rem,5vw,3.4rem)] font-medium leading-[0.98] tracking-[-0.035em] text-white">
        Your positions
      </h1>
      <p className="mt-4 max-w-[62ch] text-white/60">
        Every share you locked, what it is securing, and how much cover is left.
      </p>

      <div className="mt-6 flex gap-2" data-testid="actor-switch">
        {["shopper", "merchant", "liquidator"].map((r) => (
          <button key={r} onClick={() => setAs(r)} data-testid={`as-${r}`}
            className={`rounded-md px-4 py-2 text-sm capitalize transition ${
              as === r ? "bg-white text-black" : "border border-white/15 text-white/70 hover:border-white/30"
            }`}>
            {r}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-4" data-testid="error">
          <p className="text-sm text-rose-200">{error}</p>
        </div>
      )}
      {ok && (
        <div className="mt-6 rounded-lg border border-emerald-300/30 bg-emerald-300/[0.06] p-4" data-testid="action-done">
          <p className="text-sm text-emerald-200">
            {ok.action} confirmed.{" "}
            <a href={ok.explorer} target="_blank" rel="noreferrer" className="underline underline-offset-4">View the transaction</a>
          </p>
        </div>
      )}

      {loans.length === 0 ? (
        <div className="surface mt-6 p-8" data-testid="empty">
          <h2 className="text-lg font-medium text-white">Nothing locked yet</h2>
          <p className="mt-2 text-white/60">
            This account has no positions. When you pay a merchant with stock credit, the position
            shows up here. <Link href="/stock" className="text-white underline underline-offset-4">Go to checkout</Link>.
          </p>
        </div>
      ) : (
        <div className="surface mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px]" data-testid="positions-table">
            <thead>
              <tr className="border-b border-white/10">
                {["#", "Shares", "Owed", "Health", "Due", "Status", ""].map((h) => (
                  <th key={h} className="label px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loans.map((l: any) => (
                <tr key={l.id} className="border-b border-white/10 last:border-0" data-testid={`loan-${l.id}`}>
                  <td className="px-4 py-4 font-mono text-sm text-white/60">{l.id}</td>
                  <td className="px-4 py-4 font-mono text-sm text-white">{sh(l.shares)}</td>
                  <td className="px-4 py-4 font-mono text-sm text-white">{l.status === 1 ? `$${usd(l.owed)}` : "—"}</td>
                  <td className={`px-4 py-4 font-mono text-sm ${l.healthFactor && Number(l.healthFactor) < 1 ? "text-rose-300" : "text-emerald-300"}`}>
                    {l.status === 1 ? l.healthFactor ?? "unpriced" : "—"}
                  </td>
                  <td className="px-4 py-4 font-mono text-sm text-white/40">{new Date(l.dueAt * 1000).toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-4">
                    <span className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.1em] ${TONE[l.status] ?? "border-white/20 text-white/60"}`}>
                      {STATUS[l.status]}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {l.status === 1 && (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button onClick={() => act(l.id, "repay")} disabled={busy !== null} data-testid={`repay-${l.id}`}
                          className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:opacity-85 disabled:opacity-40">
                          {busy === l.id ? "…" : "Repay"}
                        </button>
                        <button onClick={() => act(l.id, "refund")} disabled={busy !== null} data-testid={`refund-${l.id}`}
                          className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white transition hover:border-white/30 disabled:opacity-40">
                          Refund
                        </button>
                        {l.liquidatable && (
                          <button onClick={() => act(l.id, "liquidate")} disabled={busy !== null} data-testid={`liquidate-${l.id}`}
                            className="rounded-md border border-rose-400/40 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-400/70 disabled:opacity-40">
                            Liquidate
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 font-mono text-[11px] text-white/35">
        Block {state.blockNumber} · {state.viewer.role} {state.viewer.address}
      </p>
    </div>
  )
}
