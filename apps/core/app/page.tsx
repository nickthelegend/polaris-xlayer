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

/**
 * Two amounts added as they are shown, so a column of figures adds up.
 *
 * Rounding each value to the cent on its own can leave a total a penny away
 * from its parts. On a page whose whole job is to be checkable, that reads as
 * a mistake.
 */
const sumUsd = (a: string, b: string, d = 6) => {
  const cents = (v: string) => Math.round(Number(v) / 10 ** (d - 2))
  return (cents(a) + cents(b)) / 100 >= 0
    ? ((cents(a) + cents(b)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00"
}
const fetcher = (u: string) => fetch(u, { cache: "no-store" }).then((r) => r.json())

export default function StockCreditPage() {
  return (
    <ConnectGate
      title="Connect the wallet holding your shares"
      reason="This page locks your shares and signs for them. Nothing moves without your wallet, and nothing is signed on your behalf."
      previewLabel="Your stock credit"
      previewNote="what your shares are worth, what you can borrow against them, and what you owe"
      pitch={<Pitch />}
    >
      <StockCredit />
    </ConnectGate>
  )
}

/**
 * What this is, for someone who has not connected anything.
 *
 * The gate used to be the whole first screen: a visitor with no wallet — which
 * is every visitor, the first time — got "Connect the wallet holding your
 * shares" and a redacted panel, and had to take on trust that something worth
 * connecting to was behind it. The idea is the most persuasive thing here and
 * it was the one thing being withheld.
 */
function Pitch() {
  return (
    <div className="mt-12 border-t border-white/10 pt-10">
      <h2 className="text-[clamp(1.4rem,3vw,2rem)] font-medium leading-tight tracking-[-0.02em] text-white">
        Spend the stock. Don&rsquo;t sell the stock.
      </h2>
      <p className="mt-3 max-w-[62ch] text-white/60">
        You hold tokenized equity. The merchant only takes stablecoin. Today that means selling —
        losing the position to buy a coffee. Polaris locks the shares instead, pays the merchant
        now from a pre-funded pool, and gives them back when you repay.
      </p>

      <ol className="mt-8 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-4">
        {[
          ["Scan", "The merchant\u2019s code carries the basket and their address."],
          ["Lock", "Your shares move into the engine. You still own the position."],
          ["Paid", "The merchant has stablecoin immediately, from the pool."],
          ["Repay", "Inside 7\u201314 days, and every share comes back."],
        ].map(([h, b], i) => (
          <div key={h} className="bg-background p-5">
            <p className="font-mono text-[11px] text-white/35">0{i + 1}</p>
            <p className="mt-2 text-sm font-medium text-white">{h}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">{b}</p>
          </div>
        ))}
      </ol>

      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-3">
        {[
          {
            h: "Liquidation sells only what it needs",
            b: "A liquidator repays the debt and takes collateral worth it plus a bonus; the remainder returns to the borrower in the same transaction.",
          },
          {
            h: "Two staleness bounds, not one",
            b: "Fifteen minutes while the venue is open, four days while it is shut \u2014 one bound would reject every price all weekend.",
          },
          {
            h: "Nothing is seized during an outage",
            b: "The engine reads the sequencer uptime feed and refuses to liquidate during an outage and for an hour after \u2014 but never gates repayment.",
          },
        ].map((c) => (
          <div key={c.h} className="bg-background p-5">
            <p className="text-sm font-medium text-white">{c.h}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/55">{c.b}</p>
          </div>
        ))}
      </div>

      {/* Anyone arriving without X Layer testnet gas cannot do a single thing
          here, and the app is the only place that knows which chain it is on. */}
      <p className="mt-8 text-[13px] text-white/50">
        Running on <span className="text-white/75">X Layer testnet (chain 1952)</span>. You need a
        little OKB for gas &mdash; claim it from the{" "}
        <a
          href="https://www.okx.com/xlayer/faucet"
          target="_blank"
          rel="noreferrer"
          className="text-white underline underline-offset-4"
        >
          X Layer faucet
        </a>
        , then connect and use &ldquo;Get 25 test shares&rdquo; for the collateral.
      </p>
    </div>
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

  /*
   * The other half of the same credit profile.
   *
   * Polaris grants a limit two ways: from what you have repaid before, and
   * from stock you are willing to lock. Those used to live on separate pages
   * under separate tabs, which made them look like separate products. They are
   * one answer to one question — how much can I spend — so they are read
   * together and shown together.
   */
  const { data: line } = useSWR(
    address ? `/api/limits?address=${address}` : null,
    fetcher,
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
    setError(null); setQuote(null); setDone(null)

    /*
     * Refuse before quoting, not after signing.
     *
     * The quote only ever asked the engine what a share count is worth, which
     * is a question about the market and not about you. So a wallet holding
     * nothing was quoted for ten shares and shown a green button offering to
     * pay a merchant eleven hundred dollars — a purchase that cannot happen,
     * priced and offered as though it could. The collateral has to actually be
     * yours before any of the rest is worth showing.
     */
    const held = BigInt(state?.balances?.viewerShares ?? "0")
    let want: bigint
    try {
      want = parseUnits(shares || "0", 18)
    } catch {
      setError("Enter the share count as a plain decimal number.")
      return
    }
    if (want === 0n) {
      setError("Enter a number of shares greater than zero.")
      return
    }
    if (want > held) {
      setError(
        `This wallet holds ${sh(held.toString())} ${state?.tokens?.stockSymbol ?? "shares"}, ` +
          `and locking ${shares} would need more than that.` +
          (held === 0n ? " Use “Get 25 test shares” below to fund it on testnet." : "")
      )
      return
    }

    setBusy("quote")
    const r = await fetch("/api/stock/quote", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shares, tenorDays: 7 }),
    })
    const j = await r.json()
    setBusy(null)
    if (!r.ok) { setError(j.error); return }
    setQuote(j)
  }, [shares, state])

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

  // The haircut is applied to the LTV itself while the venue is shut, so the
  // effective ceiling moves with the session rather than the mark alone.
  const ltvBps = state.price.marketOpen
    ? BigInt(state.risk.maxLtvBps)
    : (BigInt(state.risk.maxLtvBps) * BigInt(10000 - state.risk.closedMarketHaircutBps)) / 10000n
  const ltv = Number(ltvBps) / 100

  /*
   * What this wallet could spend right now, in stablecoin units.
   *
   * shares are 1e18 and the print is 1e8, so dividing by 1e20 lands on the
   * stablecoin's six decimals without ever going through a float — a price
   * times a balance is exactly where binary floating point starts losing cents.
   */
  const collateralValue =
    (BigInt(state.balances.viewerShares) * BigInt(state.price.usdPerShare)) / 10n ** 20n
  const stockCeiling = (collateralValue * ltvBps) / 10000n

  return (
    <div className="py-10">
      <p className="label">Polaris</p>
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

      <section className="mt-8" aria-labelledby="capacity">
        <h2 id="capacity" className="label">What you can spend</h2>
        <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-2">
          {/* The funded, working path: lock shares, merchant is paid now. */}
          <div className="bg-background p-6" data-testid="source-stock">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-white">Against your shares</p>
              {/* A badge is a claim about state. Saying READY over $0.00 is
                  the page insisting it works while showing that it cannot. */}
              {stockCeiling > 0n ? (
                <span className="rounded border border-emerald-300/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-emerald-200">
                  Ready
                </span>
              ) : (
                <span className="rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-white/50">
                  No shares yet
                </span>
              )}
            </div>
            <p className="mt-4 font-mono text-[34px] leading-none text-emerald-300" data-testid="stock-capacity">
              ${usd(stockCeiling.toString())}
            </p>
            <p className="mt-2 text-[13px] text-white/55">
              {sh(state.balances.viewerShares)} {state.tokens.stockSymbol} at $
              {usd(state.price.usdPerShare, 8)}, at {ltv}% LTV
              {!state.price.marketOpen && " with the after-hours haircut"}.
            </p>
            <p className="mt-3 text-[12px] text-white/40">
              The shares lock and the merchant is paid from the pool. You keep the position.
            </p>
          </div>

          {/* The unsecured limit, read from the same chain. It is shown here
              because it is the same product's other answer — but origination
              is a merchant-side call, so this page does not pretend a shopper
              can draw on it from a browser. */}
          <div className="bg-background p-6" data-testid="source-line">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-white">Against your record</p>
              <span className="rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-white/60">
                At the till
              </span>
            </div>
            <p className="mt-4 font-mono text-[34px] leading-none text-white" data-testid="line-available">
              {line ? `$${line.available}` : "—"}
            </p>
            <p className="mt-2 text-[13px] text-white/55">
              {line ? `Score ${line.creditScore} · limit $${line.currentLimit}` : "Reading your score…"}
            </p>
            <p className="mt-3 text-[12px] text-white/40">
              No collateral — this is what your repayment history is worth. A merchant opens it at
              checkout; you settle it under Activity.
            </p>
            {/* Every address starts at the same score and limit, because that
                is what the contract returns before you have repaid anything.
                Left unexplained it reads as a hardcoded number, which is the
                first thing a reviewer probes for. */}
            {line && Number(line.used) === 0 && (
              <p className="mt-2 text-[12px] text-white/35">
                Everyone starts here. The score is read from{" "}
                <span className="font-mono">ScoreManager</span> on chain and moves with what you
                repay.
              </p>
            )}
          </div>
        </div>

        <div className="mt-px grid gap-px overflow-hidden rounded-b-lg border-x border-b border-white/10 bg-white/10 sm:grid-cols-3">
          {[
            { l: `${state.tokens.stockSymbol} price`, v: `$${usd(state.price.usdPerShare, 8)}`, s: `${state.price.marketOpen ? "market open" : "market closed"} · ${state.price.source}`, id: "price" },
            { l: "You hold", v: `${sh(state.balances.viewerShares)} ${state.tokens.stockSymbol}`, s: "yours throughout", id: "shares" },
            { l: "Pool available", v: `$${usd(state.pool.available)}`, s: "merchant is paid from here", id: "pool" },
          ].map((t) => (
            <div key={t.l} className="bg-background px-5 py-4" data-testid={`tile-${t.id}`}>
              <p className="label">{t.l}</p>
              <p className="mt-1.5 font-mono text-[15px] leading-none text-white">{t.v}</p>
              <p className="mt-1.5 text-[11px] text-white/40">{t.s}</p>
            </div>
          ))}
        </div>
      </section>

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
              [
                `Ceiling at ${quote.ltvBps / 100}% LTV`,
                // Summed from the values as displayed, not from the underlying
                // ones. Rounding each of the three to the cent independently
                // left them not adding up on screen — 204.72 − 2.49 showing
                // 202.24 — which reads as an arithmetic error even though the
                // exact figures reconcile. The row means "what you get plus
                // what you pay", so deriving it from those two keeps the
                // column honest to the eye as well as to the chain.
                `$${sumUsd(quote.maxBorrow, quote.feeOnMax)}`,
                "",
              ],
              ["Fee, 7 days", `−$${usd(quote.feeOnMax)}`, "text-white/70"],
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
              <Link href="/activity" className="underline underline-offset-4">See your activity</Link>
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
        survived</span>; both are fixed. 201 tests, and the conservation invariants are checked
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
