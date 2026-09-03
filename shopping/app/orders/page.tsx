"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { maxUint256 } from "viem"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { ArrowLeft, CheckCircle, ExternalLink, Loader2, TrendingDown, TrendingUp, Wallet } from "lucide-react"

import { useWallet } from "@/lib/use-wallet"
import { ADDRESSES, ENGINE_ABI, ERC20_ABI, EXPLORER, explainWriteError, waitForAllowance } from "@/lib/polaris-client"
import { formatShares, formatUsd } from "@/lib/stock-pricing"

/**
 * What you owe the shop, and getting your shares back.
 *
 * Without this the storefront could take a payment and then had nothing to say
 * about it — the shopper had to leave for a different app to settle, which is
 * the point at which a demo loses its thread. Repay lives here, signed by the
 * same wallet that bought.
 *
 * The interesting column is the last one: what the locked shares are worth now
 * against what they were worth at checkout. That difference is the entire
 * argument for the product, and it is the one number selling the stock would
 * have cost you.
 */

const POLARIS = process.env.NEXT_PUBLIC_POLARIS_URL ?? "https://polaris-xlayer.vercel.app"
const STATUS = ["None", "Active", "Repaid", "Liquidated", "Refunded"] as const

type Loan = {
  id: number
  shares: string
  principal: string
  owed: string
  dueAt: number
  status: number
  healthFactor: string | null
  liquidatable: boolean
}

type State = {
  loans: Loan[]
  price: { usdPerShare: string; marketOpen: boolean }
  tokens: { stockSymbol: string; stableSymbol: string }
  balances: { viewerStable: string }
}

export default function OrdersPage() {
  const router = useRouter()
  const { login, connected, connecting } = useWallet()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ hash: string } | null>(null)

  const refresh = useCallback(async () => {
    if (!address) return
    try {
      const res = await fetch(`${POLARIS}/api/stock/state?address=${address}`, { cache: "no-store" })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setState(json)
    } catch {
      setError("Could not read your positions from Polaris just now.")
    }
  }, [address])

  useEffect(() => {
    void refresh()
    // X Layer serves pre-transaction state briefly after a receipt, so a
    // shopper arriving straight from checkout can land inside that window.
    const quick = [setTimeout(() => void refresh(), 2500), setTimeout(() => void refresh(), 7000)]
    const poll = setInterval(() => void refresh(), 20_000)
    return () => {
      quick.forEach(clearTimeout)
      clearInterval(poll)
    }
  }, [refresh])

  const repay = useCallback(
    async (loan: Loan) => {
      if (!publicClient || !address || !state) return
      setError(null)
      setDone(null)
      setBusy(loan.id)
      try {
        // Repaying moves stablecoin in, so the wallet needs both the balance
        // and the approval. Checking the balance first turns "the engine is
        // not approved" — true but unhelpful — into the actual problem.
        const held = (await publicClient.readContract({
          address: ADDRESSES.stable as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        } as never)) as bigint

        if (held < BigInt(loan.owed)) {
          setError(
            `Settling this needs $${formatUsd(BigInt(loan.owed))} ${state.tokens.stableSymbol}, and this wallet holds $${formatUsd(held)}.`,
          )
          setBusy(null)
          return
        }

        const allowance = (await publicClient.readContract({
          address: ADDRESSES.stable as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, ADDRESSES.engine],
        } as never)) as bigint

        if (allowance < BigInt(loan.owed)) {
          const approveHash = await writeContractAsync({
            address: ADDRESSES.stable as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [ADDRESSES.engine as `0x${string}`, maxUint256],
          } as never)
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
          const visible = await waitForAllowance(
            publicClient,
            ADDRESSES.stable as `0x${string}`,
            address,
            ADDRESSES.engine as `0x${string}`,
            BigInt(loan.owed),
          )
          if (!visible) {
            setError("The approval is confirmed but the node has not caught up yet. Try again in a moment.")
            setBusy(null)
            return
          }
        }

        const hash = await writeContractAsync({
          address: ADDRESSES.engine as `0x${string}`,
          abi: ENGINE_ABI,
          functionName: "repay",
          args: [BigInt(loan.id)],
        } as never)
        await publicClient.waitForTransactionReceipt({ hash })
        setDone({ hash })
        void refresh()
      } catch (e: unknown) {
        setError(explainWriteError(e, state.tokens.stableSymbol))
      } finally {
        setBusy(null)
      }
    },
    [publicClient, address, state, writeContractAsync, refresh],
  )

  if (!connected) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-black uppercase tracking-tighter">Orders</h1>
        <p className="mt-3 text-sm text-white/40 max-w-md mx-auto">
          Your orders live on chain, against the wallet that paid for them.
        </p>
        <button
          onClick={login}
          disabled={connecting}
          className="mt-8 inline-flex items-center gap-2 bg-white text-black px-6 py-3 rounded text-[10px] font-black uppercase tracking-widest hover:opacity-80 transition-all disabled:opacity-40"
        >
          <Wallet className="w-3.5 h-3.5" />
          {connecting ? "Connecting" : "Connect_Wallet"}
        </button>
      </div>
    )
  }

  const active = state?.loans.filter((l) => l.status === 1) ?? []
  const settled = state?.loans.filter((l) => l.status !== 1) ?? []
  const price = state ? BigInt(state.price.usdPerShare) : 0n

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <button
        onClick={() => router.push("/")}
        className="flex items-center gap-2 text-white/40 hover:text-white mb-12 transition-all uppercase text-[10px] font-bold tracking-widest group"
      >
        <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
        Keep_Shopping
      </button>

      <h1 className="text-3xl font-black uppercase tracking-tighter">Orders</h1>
      <p className="mt-3 text-sm text-white/40 max-w-xl">
        What you bought with stock, and what it takes to unlock the shares again.
      </p>

      {error && (
        <div className="mt-8 p-5 rounded-xl border border-red-500/30 bg-red-500/5 text-sm text-red-200">{error}</div>
      )}
      {done && (
        <div className="mt-8 p-5 rounded-xl border border-green-500/30 bg-green-500/5 text-sm text-green-200">
          Settled. Every share is back in your wallet.{" "}
          <a href={`${EXPLORER}/tx/${done.hash}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            View the transaction
          </a>
        </div>
      )}

      {!state ? (
        <p className="mt-10 text-sm text-white/30">Reading X Layer…</p>
      ) : active.length === 0 && settled.length === 0 ? (
        <div className="mt-10 border border-white/10 rounded-xl p-10 text-center">
          <p className="text-sm font-black uppercase tracking-widest">No_Orders_Yet</p>
          <p className="mt-3 text-sm text-white/40 max-w-sm mx-auto">
            Pay for something with stock credit and it shows up here, with the shares you locked
            against it.
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-6 bg-white text-black px-6 py-3 rounded text-[10px] font-black uppercase tracking-widest hover:opacity-80 transition-all"
          >
            Browse_Modules
          </button>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="mt-10 space-y-4">
              {active.map((l) => {
                const shares = BigInt(l.shares)
                // What the locked shares are worth right now.
                const worthNow = (shares * price) / 10n ** 20n
                const owed = BigInt(l.owed)
                const upside = worthNow - BigInt(l.principal)
                return (
                  <div key={l.id} className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">
                        Order #{l.id}
                      </span>
                      <span className="text-[10px] uppercase font-bold text-green-400 tracking-widest">
                        {STATUS[l.status]}
                      </span>
                    </div>

                    <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-5">
                      <Cell label="Shares_Locked" value={formatShares(shares)} />
                      <Cell label="To_Settle" value={`$${formatUsd(owed)}`} accent />
                      <Cell label="Worth_Now" value={`$${formatUsd(worthNow)}`} />
                      <Cell
                        label="Since_Checkout"
                        value={`${upside >= 0n ? "+" : "−"}$${formatUsd(upside < 0n ? -upside : upside)}`}
                        tone={upside >= 0n ? "up" : "down"}
                      />
                    </div>

                    <p className="mt-4 text-[11px] leading-relaxed text-white/35">
                      Settle by {new Date(l.dueAt * 1000).toISOString().slice(0, 10)} and every share
                      returns. {upside >= 0n
                        ? "The gain since checkout is yours — selling would have handed it to somebody else."
                        : "The position is down since checkout, and it is still yours to hold rather than realise."}
                    </p>

                    <button
                      onClick={() => repay(l)}
                      disabled={busy !== null}
                      className="mt-5 bg-white text-black px-6 py-3 rounded text-[10px] font-black uppercase tracking-widest hover:opacity-80 transition-all disabled:opacity-40 inline-flex items-center gap-2"
                    >
                      {busy === l.id ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing</>
                      ) : (
                        <>Settle_${formatUsd(owed)}_And_Unlock</>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {settled.length > 0 && (
            <div className="mt-12">
              <h2 className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Settled</h2>
              <div className="mt-4 border border-white/10 rounded-xl divide-y divide-white/5">
                {settled.slice(-6).reverse().map((l) => (
                  <div key={l.id} className="flex items-center justify-between px-5 py-3.5">
                    <span className="font-mono text-sm text-white/50">Order #{l.id}</span>
                    <span className="font-mono text-sm text-white/40">{formatShares(BigInt(l.shares))} back</span>
                    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-white/40">
                      <CheckCircle className="w-3 h-3" />
                      {STATUS[l.status]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <a
        href={`${POLARIS}/activity`}
        target="_blank"
        rel="noreferrer"
        className="mt-10 inline-flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-white/30 hover:text-white transition-colors"
      >
        Full position detail on Polaris <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  )
}

function Cell({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: "up" | "down" }) {
  const Icon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase font-bold text-white/35 tracking-widest">{label}</span>
      <span
        className={`font-mono text-sm font-black inline-flex items-center gap-1.5 ${
          accent ? "text-white" : tone === "up" ? "text-green-400" : tone === "down" ? "text-red-400" : "text-white/70"
        }`}
      >
        {Icon && <Icon className="w-3 h-3" />}
        {value}
      </span>
    </div>
  )
}
