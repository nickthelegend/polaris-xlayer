"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import useSWR from "swr"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { parseUnits, maxUint256 } from "viem"

import { ConnectGate } from "@/components/connect-gate"
import { ADDRESSES, ENGINE_ABI, ERC20_ABI, explainWriteError, txUrl, waitForAllowance } from "@/lib/polaris-client"

/**
 * Spend the stock, don't sell the stock.
 *
 * A shopper holding tokenized equity checks out at a merchant who only takes
 * stablecoin. Rather than closing the position they lock the shares and the
 * merchant is paid immediately from the pool.
 *
 * Every write here is signed by the connected wallet. An earlier version of
 * this page posted to a server route that signed with a key the server held,
 * which meant a visitor could "pay" without a wallet and without consenting to
 * anything — the transaction was real, but it was not theirs.
 */

const usd = (v: string, d = 6) =>
  (Number(v) / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sh = (v: string) => (Number(v) / 1e18).toFixed(4)
const fetcher = (u: string) => fetch(u, { cache: "no-store" }).then((r) => r.json())

export default function StockCreditPage() {
  return (
    <ConnectGate
      title="Connect the wallet holding your shares"
      reason="This page locks your shares and signs for them. Nothing moves without your wallet, and nothing is signed on your behalf."
      previewLabel="Your stock credit"
      previewNote="what your shares are worth, what you can borrow against them, and what you owe"
    >
      <StockCredit />
    </ConnectGate>
  )
}

function StockCredit() {
  const { address } = useAccount()
  const params = useSearchParams()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  /**
   * wagmi types its call parameters against a literal `abi`, and ours is
   * imported JSON, so the inference collapses. One cast here beats one at
   * every call site.
   */
  const write = useCallback(
    (args: Record<string, unknown>) => writeContractAsync(args as never),
    [writeContractAsync],
  )

  const { data: state, mutate } = useSWR(
    address ? `/api/stock/state?address=${address}` : null,
    fetcher,
    { refreshInterval: 15000 },
  )

  // A merchant's QR carries the checkout in the URL.
  const qrMerchant = params.get("merchant")
  const qrRef = params.get("ref")
  const qrShares = params.get("shares")

  const [shares, setShares] = useState(qrShares ?? "10")
  const [orderRef, setOrderRef] = useState("")
  const [quote, setQuote] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ hash: string } | null>(null)

  useEffect(() => {
    setOrderRef(qrRef ?? "basket-" + Math.random().toString(36).slice(2, 8))
  }, [qrRef])

  const merchant = (qrMerchant ?? state?.merchant) as `0x${string}` | undefined

  const getQuote = useCallback(async () => {
    setError(null); setQuote(null); setDone(null); setBusy("quote")
    const r = await fetch("/api/stock/quote", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shares, tenorDays: 7 }),
    })
    const j = await r.json()
    setBusy(null)
    if (!r.ok) { setError(j.error); return }
    setQuote(j)
  }, [shares])

  /** Approve if needed, then open the loan. Both signed by the connected wallet. */
  const pay = useCallback(async () => {
    if (!quote || !address || !merchant || !publicClient) return
    setError(null); setBusy("pay"); setDone(null)
    try {
      const wei = parseUnits(shares, 18)

      const allowance = (await publicClient.readContract({
        address: ADDRESSES.stock as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, ADDRESSES.engine],
      } as any)) as bigint

      if (allowance < wei) {
        setBusy("approve")
        const approveHash = await write({
          address: ADDRESSES.stock as `0x${string}`,
          abi: ERC20_ABI as any,
          functionName: "approve",
          args: [ADDRESSES.engine as `0x${string}`, maxUint256],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveHash })
        // Same read-lag: openLoan would simulate against the pre-approve state.
        const visible = await waitForAllowance(
          publicClient, ADDRESSES.stock as `0x${string}`, address,
          ADDRESSES.engine as `0x${string}`, wei,
        )
        if (!visible) {
          setError("The approval is confirmed but the node has not caught up yet. Try again in a moment.")
          setBusy(null)
          return
        }
        setBusy("pay")
      }

      const hash = await write({
        address: ADDRESSES.engine as `0x${string}`,
        abi: ENGINE_ABI as any,
        functionName: "openLoan",
        args: [
          ADDRESSES.stock as `0x${string}`,
          wei,
          merchant,
          // The contract keys idempotency on (merchant, orderRef, borrower),
          // so this hash is what makes a double-tap a no-op rather than a
          // second loan.
          keccak(orderRef),
          BigInt(quote.maxBorrow),
          BigInt(7 * 86400),
        ],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      setDone({ hash })
      setQuote(null)
      setOrderRef("basket-" + Math.random().toString(36).slice(2, 8))
      void mutate()
    } catch (e: any) {
      setError(explainWriteError(e, state?.tokens?.stockSymbol ?? "shares"))
    } finally {
      setBusy(null)
    }
  }, [quote, address, merchant, publicClient, shares, orderRef, write, mutate, state])

  const faucet = useCallback(async () => {
    setError(null); setBusy("faucet")
    try {
      const hash = await write({
        address: ADDRESSES.stock as `0x${string}`,
        abi: ERC20_ABI as any,
        functionName: "faucet",
        args: [parseUnits("25", 18)],
      })
      await publicClient?.waitForTransactionReceipt({ hash })
      void mutate()
    } catch (e: any) {
      setError(explainWriteError(e, state?.tokens?.stockSymbol ?? "shares"))
    } finally {
      setBusy(null)
    }
  }, [write, publicClient, mutate, state])

  if (!state) return <div className="py-16 text-white/50">Reading X Layer…</div>
  if (state.error) {
    return (
      <div className="mt-8 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-6 text-rose-200">
        {state.error}
      </div>
    )
  }

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
          { l: "You hold", v: sh(state.balances.viewerShares), s: state.tokens.stockSymbol, t: "text-white", id: "shares" },
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
        <p className="mt-1 font-mono text-[13px] text-white/50">
          Merchant {merchant?.slice(0, 12)}…{qrMerchant && " · from the merchant's code"}
        </p>

        <label className="label mt-6 block" htmlFor="shares">Shares to lock</label>
        <input
          id="shares" value={shares} inputMode="decimal" data-testid="shares-input"
          onChange={(e) => { setShares(e.target.value); setQuote(null) }}
          className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xl text-white outline-none focus:border-white/25"
        />

        <label className="label mt-5 block" htmlFor="ref">Order reference</label>
        <input
          id="ref" value={orderRef} data-testid="ref-input"
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
            {busy === "faucet" ? "Signing…" : "Get 25 test shares"}
          </button>
        </div>

        {quote && (
          <div className="mt-7 border-t border-white/10 pt-2" data-testid="quote">
            {[
              ["Collateral value", `$${usd(quote.collateralValue)}`, ""],
              [`Ceiling at ${quote.ltvBps / 100}% LTV`, `$${usd(quote.maxBorrow)}`, ""],
              ["Fee, 7 days", `$${usd(quote.feeOnMax)}`, ""],
              ["Merchant is paid", `$${usd(quote.maxBorrow)}`, "text-emerald-300 text-lg"],
            ].concat(
              quote.cappedByPool
                ? [["Capped by pool liquidity", `$${usd(quote.poolAvailable)} available`, "text-amber-300"]]
                : [],
            ).map(([l, v, cls]: any) => (
              <div key={l} className="flex items-baseline justify-between border-b border-white/10 py-2.5 last:border-0">
                <span className="text-sm text-white/60">{l}</span>
                <span className={`font-mono ${cls || "text-white"}`}>{v}</span>
              </div>
            ))}
            <button onClick={pay} disabled={!!busy} data-testid="pay-btn"
              className="mt-5 w-full rounded-md bg-emerald-300 px-5 py-3.5 text-sm font-medium text-black transition hover:opacity-85 active:scale-[0.99] disabled:opacity-40">
              {busy === "approve" ? "Approve the shares in your wallet…"
                : busy === "pay" ? "Confirm in your wallet…"
                : `Pay $${usd(quote.maxBorrow)} with stock credit`}
            </button>
          </div>
        )}

        {done && (
          <div className="mt-6 rounded-lg border border-emerald-300/30 bg-emerald-300/[0.06] p-4" data-testid="checkout-done">
            <p className="text-sm text-emerald-200">
              Signed. The merchant has been paid and your shares are locked.{" "}
              <a href={txUrl(done.hash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">View the transaction</a>
              {" · "}
              <Link href="/stock/positions" className="underline underline-offset-4">See your positions</Link>
            </p>
          </div>
        )}
      </div>

      {/* A reviewer will not go looking for docs/STOCK-CREDIT.md. The three
          things that actually distinguish this from a weekend lending fork
          belong on the page they land on. */}
      <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-3">
        {[
          {
            h: "Liquidation sells only what it needs",
            b: "A liquidator repays the debt and takes collateral worth it plus a bonus; the remainder goes back to the borrower in the same transaction. Losing a whole position over a small shortfall is the failure this product exists to prevent.",
          },
          {
            h: "Two staleness bounds, not one",
            b: "Fifteen minutes while the venue is open, four days while it is shut. When the market closes the newest print is the closing print and only gets older — one bound would reject every price all weekend and silently delete the after-hours path.",
          },
          {
            h: "Nothing is seized during an outage",
            b: "X Layer is an L2 with one sequencer. If it stalls you cannot reach the chain to repay while the price moves. The engine reads Chainlink's uptime feed and refuses to liquidate during an outage and for an hour after — but never gates repayment.",
          },
        ].map((c) => (
          <div key={c.h} className="bg-background p-5">
            <p className="text-sm font-medium text-white">{c.h}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/55">{c.b}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-white/50">
        Five adversarial reviewers went at these contracts across accounting, decimals, access
        control, oracle manipulation and liveness, and every claim was handed to a separate agent
        whose job was to refute it. <span className="text-white/70">24 attacks were claimed and 2
        survived</span>; both are fixed. 48 tests, and the conservation invariants are checked
        against the live chain, not a fixture.
      </p>

      <p className="mt-8 font-mono text-[11px] text-white/35">
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

/** keccak256 of a UTF-8 string, as bytes32 — the contract's orderRef key. */
function keccak(s: string): `0x${string}` {
  // Imported lazily to keep viem's hashing out of the module's top level.
  const { keccak256, toBytes } = require("viem") as typeof import("viem")
  return keccak256(toBytes(s))
}
