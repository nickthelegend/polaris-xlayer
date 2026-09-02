"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { maxUint256 } from "viem"

import { ConnectGate } from "@/components/connect-gate"
import { ADDRESSES, ENGINE_ABI, ERC20_ABI, explainWriteError, txUrl, waitForAllowance } from "@/lib/polaris-client"

/**
 * Every share you locked, what it is securing, and how much cover is left.
 *
 * Repay, refund and liquidate are all signed by the connected wallet. The
 * contract already decides who may do which — only the borrower repays, only
 * the merchant refunds — so the UI's job is to offer the action and let the
 * chain refuse it, not to pretend it can act as somebody else.
 */

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

export default function PositionsPage() {
  return (
    <ConnectGate
      title="Connect to see your positions"
      reason="A position belongs to one wallet, and only that wallet can repay it."
      previewLabel="Your positions"
      previewNote="the shares you locked, what they secure, and how much cover is left"
    >
      <Positions />
    </ConnectGate>
  )
}

function Positions() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const write = useCallback(
    (args: Record<string, unknown>) => writeContractAsync(args as never),
    [writeContractAsync],
  )

  const { data: state, mutate } = useSWR(
    address ? `/api/stock/state?address=${address}` : null,
    fetcher,
    { refreshInterval: 15000 },
  )

  /*
   * Re-read shortly after arriving.
   *
   * X Layer's RPC serves pre-transaction state for a moment after a receipt,
   * so someone who pays and then opens this page can land inside that window
   * and be told they have nothing locked — seconds after locking something.
   * The 15s poll corrects it eventually, which is far too late to be the first
   * thing they read. Two quick re-reads close the window.
   */
  useEffect(() => {
    if (!address) return
    const t = [setTimeout(() => void mutate(), 2500), setTimeout(() => void mutate(), 7000)]
    return () => t.forEach(clearTimeout)
  }, [address, mutate])

  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<{ hash: string; action: string } | null>(null)

  const act = useCallback(
    async (loanId: number, action: "repay" | "refund" | "liquidate", owed: string) => {
      if (!publicClient || !address) return
      setError(null); setOk(null); setBusy(loanId)
      try {
        // Repaying, refunding and liquidating all move stablecoin from the
        // caller into the pool, so the caller needs both the balance and the
        // approval. Checking the balance first turns "the engine is not
        // approved" — which is true but unhelpful — into the actual problem.
        const held = (await publicClient.readContract({
          address: ADDRESSES.stable as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        } as any)) as bigint
        if (held < BigInt(owed)) {
          setError(
            `Repaying this needs ${(Number(owed) / 1e6).toFixed(2)} ${state?.tokens?.stableSymbol ?? "stablecoin"}, ` +
              `and this wallet holds ${(Number(held) / 1e6).toFixed(2)}.`
          )
          setBusy(null)
          return
        }
        {
          const allowance = (await publicClient.readContract({
            address: ADDRESSES.stable as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, ADDRESSES.engine],
          } as any)) as bigint
          if (allowance < BigInt(owed)) {
            const approveHash = await write({
              address: ADDRESSES.stable as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [ADDRESSES.engine as `0x${string}`, maxUint256],
            })
            await publicClient.waitForTransactionReceipt({ hash: approveHash })
            // The receipt is not enough on this RPC — wait for the node to
            // actually report the allowance before the settle call simulates.
            const visible = await waitForAllowance(
              publicClient, ADDRESSES.stable as `0x${string}`, address,
              ADDRESSES.engine as `0x${string}`, BigInt(owed),
            )
            if (!visible) {
              setError("The approval is confirmed but the node has not caught up yet. Try again in a moment.")
              setBusy(null)
              return
            }
          }
        }

        const hash = await write({
          address: ADDRESSES.engine as `0x${string}`,
          abi: ENGINE_ABI,
          functionName: action,
          args: [BigInt(loanId)],
        })
        await publicClient.waitForTransactionReceipt({ hash })
        setOk({ hash, action })
        void mutate()
      } catch (e: any) {
        setError(explainWriteError(e, state?.tokens?.stableSymbol ?? "stablecoin"))
      } finally {
        setBusy(null)
      }
    },
    [publicClient, address, write, mutate, state],
  )

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

      {error && (
        <div className="mt-6 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-4" data-testid="error">
          <p className="text-sm text-rose-200">{error}</p>
        </div>
      )}
      {ok && (
        <div className="mt-6 rounded-lg border border-emerald-300/30 bg-emerald-300/[0.06] p-4" data-testid="action-done">
          <p className="text-sm text-emerald-200">
            {ok.action} signed and confirmed.{" "}
            <a href={txUrl(ok.hash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              View the transaction
            </a>
          </p>
        </div>
      )}

      {loans.length === 0 ? (
        <div className="surface mt-6 p-8" data-testid="empty">
          <h2 className="text-lg font-medium text-white">Nothing locked yet</h2>
          <p className="mt-2 text-white/60">
            This wallet has no positions. When you pay a merchant with stock credit, the position
            shows up here. <Link href="/" className="text-white underline underline-offset-4">Go to checkout</Link>.
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
                        <button onClick={() => act(l.id, "repay", l.owed)} disabled={busy !== null} data-testid={`repay-${l.id}`}
                          className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:opacity-85 disabled:opacity-40">
                          {busy === l.id ? "Signing…" : "Repay"}
                        </button>
                        {l.liquidatable && (
                          <button onClick={() => act(l.id, "liquidate", l.owed)} disabled={busy !== null} data-testid={`liquidate-${l.id}`}
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
        Block {state.blockNumber} · {state.viewer.address}
      </p>
      <p className="mt-2 text-[11px] text-white/35">
        A merchant refunds a sale from their own wallet, on their own dashboard — this page only
        offers what this wallet is allowed to do.
      </p>
    </div>
  )
}
