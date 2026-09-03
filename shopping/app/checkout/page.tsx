"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, CheckCircle, ExternalLink, Loader2, Lock, ShieldCheck, TrendingUp, Wallet, XCircle,
} from "lucide-react"

import { useCart } from "@/lib/cart-context"
import { useWallet } from "@/lib/use-wallet"
import { useStockCheckout } from "@/lib/use-stock-checkout"
import { feeBreakdown, formatShares, formatUsd } from "@/lib/stock-pricing"
import { ADDRESSES, EXPLORER } from "@/lib/polaris-client"
import { AddTokens } from "@/components/add-token"

/**
 * Checkout, paid with stock.
 *
 * This page used to POST the basket to a merchant service on localhost with a
 * client id and secret, then open a hosted page in a popup and wait for a
 * postMessage back. Three moving parts, none of which a visitor has, and the
 * popup is blocked by default in most browsers anyway.
 *
 * Now the shopper's own wallet pays the engine: the basket is priced in shares
 * at the live mark, the shares lock, and the merchant is paid from the pool in
 * the same transaction. Nothing here is simulated — the numbers come off chain
 * and the button signs.
 */

const POLARIS = process.env.NEXT_PUBLIC_POLARIS_URL ?? "https://polaris-xlayer.vercel.app"

export default function CheckoutPage() {
  const { total, items, clearCart } = useCart()
  const router = useRouter()
  const { login, connected, connecting, short } = useWallet()

  /*
   * The order reference: stable across a checkout, new for the next one.
   *
   * The engine keys idempotency on (merchant, orderRef, borrower), so a
   * double-tap on Pay must hash to the same thing — that part worked. But the
   * ref was derived from the basket alone, which meant buying the same item a
   * second time, days later, was refused for ever with "you have already paid
   * this order reference". A shopper cannot buy two of something.
   *
   * A checkout session id fixes both: generated once when this page mounts and
   * held in a ref, so every render and every double-tap reuses it, while a
   * fresh visit to checkout is a genuinely new order.
   */
  const session = useRef<string>("")
  if (!session.current) {
    session.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
  const orderRef = useMemo(() => {
    const line = items.map((i) => `${i.id}x${i.quantity}`).join("|")
    return `shop-${session.current}-${line}-${total.toFixed(2)}`
  }, [items, total])

  const { chain, quote, state, loadError, pay, fundShares, reset, needsGas } = useStockCheckout(total)
  const [form, setForm] = useState({
    name: "Avery Sterling",
    email: "avery@syndicate.net",
    address: "7th Sector Node, Neo-Tokyo 2045",
  })

  // Empty the basket once the chain has confirmed, not before.
  useEffect(() => {
    if (state.step === "done") clearCart()
  }, [state.step, clearCart])

  const busy = state.step === "approving" || state.step === "paying"

  // The receipt outranks the empty cart. Clearing the basket is a consequence
  // of a confirmed purchase, so an empty cart must never be what a shopper is
  // shown after one — they would have paid and been told nothing.
  if (items.length === 0 && state.step !== "done") {
    return (
      <div className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-black uppercase tracking-tighter">Cart_Empty</h1>
        <p className="mt-3 text-sm text-white/40">Nothing to settle. Pick something first.</p>
        <button
          onClick={() => router.push("/")}
          className="mt-8 bg-white text-black px-6 py-3 rounded text-[10px] font-black uppercase tracking-widest hover:opacity-80 transition-all"
        >
          Browse_Modules
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {state.step === "done" && (
        <div className="mb-12 p-8 rounded-xl border-2 border-green-500/30 bg-green-500/5">
          <div className="flex items-center gap-4 mb-6">
            <CheckCircle className="w-8 h-8 text-green-500" />
            <h2 className="text-2xl font-black uppercase tracking-tighter text-green-400">
              Settlement_Confirmed
            </h2>
          </div>
          <p className="text-sm text-white/60 mb-6 max-w-2xl">
            The merchant has been paid in stablecoin. Your shares are locked as collateral — you
            still own them, and every one comes back when you settle.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Figure label="Merchant_Paid" value={`$${formatUsd(state.paid)}`} accent />
            <Figure label="Shares_Locked" value={`${formatShares(state.shares)} ${chain?.tokens.stockSymbol ?? ""}`} />
            <Figure label="Settle_Within" value="7_Days" />
          </div>
          <div className="mt-6">
            <p className="text-[10px] uppercase font-bold text-white/35 tracking-widest">
              See_Them_In_Your_Wallet
            </p>
            <div className="mt-2">
              <AddTokens />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={`${EXPLORER}/tx/${state.hash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-green-500/20 border border-green-500/30 text-green-400 px-6 py-2 rounded text-[10px] font-black uppercase tracking-widest hover:bg-green-500/30 transition-all"
            >
              View_Transaction <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href={`${POLARIS}/activity`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 border border-white/15 px-6 py-2 rounded text-[10px] font-black uppercase tracking-widest hover:border-white/40 transition-all"
            >
              Settle_Position <ExternalLink className="w-3 h-3" />
            </a>
            <button
              onClick={() => { reset(); router.push("/") }}
              className="px-6 py-2 rounded text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-all"
            >
              Continue_Shopping
            </button>
          </div>
        </div>
      )}

      {state.step === "error" && (
        <div className="mb-12 p-8 rounded-xl border-2 border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-4 mb-4">
            <XCircle className="w-8 h-8 text-red-500" />
            <h2 className="text-2xl font-black uppercase tracking-tighter text-red-400">
              Settlement_Failed
            </h2>
          </div>
          <p className="text-sm text-white/60 mb-4">{state.message}</p>
          <button
            onClick={reset}
            className="border border-red-500/30 text-red-400 px-6 py-2 rounded text-[10px] font-black uppercase tracking-widest hover:bg-red-500/10 transition-all"
          >
            Try_Again
          </button>
        </div>
      )}

      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-white/40 hover:text-white mb-12 transition-all uppercase text-[10px] font-bold tracking-widest group"
      >
        <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
        Back
      </button>

      {state.step !== "done" && (
        <div className="grid lg:grid-cols-[1fr_420px] gap-12">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter mb-8">Delivery</h1>
            <div className="space-y-4">
              {([
                ["name", "Recipient"],
                ["email", "Contact"],
                ["address", "Drop_Point"],
              ] as const).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">{label}</span>
                  <input
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="mt-2 w-full bg-white/[0.03] border border-white/10 rounded px-4 py-3 text-sm outline-none focus:border-white/30 transition-colors"
                  />
                </label>
              ))}
            </div>

            <div className="mt-10 grid sm:grid-cols-3 gap-px bg-white/10 rounded-lg overflow-hidden border border-white/10">
              <Reassurance icon={Lock} title="Shares_Locked" body="Held by the engine, not sold. You keep the position." />
              <Reassurance icon={TrendingUp} title="Upside_Kept" body="If the stock climbs while locked, the gain is still yours." />
              <Reassurance icon={ShieldCheck} title="Only_What_It_Needs" body="A shortfall sells only enough to cover it. The rest returns." />
            </div>
          </div>

          <aside className="lg:sticky lg:top-8 h-fit">
            <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
              <h2 className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Order</h2>

              <div className="mt-4 space-y-3">
                {items.map((i) => (
                  <div key={i.id} className="flex justify-between text-sm">
                    <span className="text-white/60">
                      {i.name} <span className="text-white/25">×{i.quantity}</span>
                    </span>
                    <span className="font-mono">${(i.price * i.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-white/10 flex justify-between items-baseline">
                <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Total</span>
                <span className="text-2xl font-black font-mono">${total.toFixed(2)}</span>
              </div>

              {loadError && (
                <p className="mt-6 text-[11px] leading-relaxed text-amber-300/80">{loadError}</p>
              )}

              {!connected ? (
                <button
                  onClick={login}
                  disabled={connecting}
                  className="mt-6 w-full bg-white text-black py-4 rounded text-[10px] font-black uppercase tracking-widest hover:opacity-80 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  {connecting ? "Connecting" : "Connect_Wallet_To_Pay"}
                </button>
              ) : !quote ? (
                <p className="mt-6 text-[11px] text-white/40">Pricing the basket against the market…</p>
              ) : (
                <>
                  <div className="mt-6 pt-6 border-t border-white/10 space-y-2.5">
                    <Row
                      label={`${chain?.tokens.stockSymbol ?? "Share"}_Price`}
                      value={`$${formatUsd(quote.pricing.usdPerShare / 100n)}`}
                      note={quote.marketOpen ? "market open" : "after-hours"}
                    />
                    <Row label="Shares_To_Lock" value={formatShares(quote.shares)} accent />
                    <Row label="Collateral_Value" value={`$${formatUsd(quote.collateralValue)}`} />
                    <Row label="Fee_7_Days" value={`−$${formatUsd(quote.fee)}`} />
                    {/* A single fee line invites the reader to assume it is
                        interest, or to assume it is flat. It is both, and the
                        split is the difference between a number a shopper
                        accepts and one they understand. */}
                    {(() => {
                      const b = feeBreakdown(quote.merchantReceives, quote.pricing)
                      return (
                        <div className="pl-3 border-l border-white/10 space-y-1.5 py-0.5">
                          <Row label="Origination" value={`$${formatUsd(b.origination)}`} note="1% once" />
                          <Row label="Interest" value={`$${formatUsd(b.interest)}`} note="12% APR, 7 days" />
                        </div>
                      )
                    })()}
                    <Row label="Merchant_Receives" value={`$${formatUsd(quote.merchantReceives)}`} accent />
                  </div>

                  {needsGas ? (
                    <div className="mt-6">
                      <p className="text-[11px] leading-relaxed text-amber-300/90">
                        This wallet holds no OKB, so it cannot pay for gas on X Layer testnet — no
                        transaction can be signed until it does.
                      </p>
                      <a
                        href="https://www.okx.com/xlayer/faucet"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 block text-center border border-white/15 py-3 rounded text-[10px] font-black uppercase tracking-widest hover:border-white/40 transition-all"
                      >
                        Get_OKB_From_The_X_Layer_Faucet
                      </a>
                    </div>
                  ) : !quote.affordable ? (
                    <div className="mt-6">
                      <p className="text-[11px] leading-relaxed text-amber-300/90">
                        This basket needs {formatShares(quote.shares)} {chain?.tokens.stockSymbol}, and
                        this wallet holds {formatShares(quote.held)} — {formatShares(quote.shortfall)} short.
                      </p>
                      <button
                        onClick={fundShares}
                        disabled={busy}
                        className="mt-3 w-full border border-white/15 py-3 rounded text-[10px] font-black uppercase tracking-widest hover:border-white/40 transition-all disabled:opacity-40"
                      >
                        {busy ? "Signing" : "Get_25_Test_Shares"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => pay(orderRef)}
                      disabled={busy}
                      className="mt-6 w-full bg-green-500 text-black py-4 rounded text-[10px] font-black uppercase tracking-widest hover:opacity-85 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {state.step === "approving" ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Approve_Shares_In_Wallet</>
                      ) : state.step === "paying" ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Confirm_In_Wallet</>
                      ) : (
                        <>Pay_${total.toFixed(2)}_With_Stock</>
                      )}
                    </button>
                  )}

                  {/* Where the number came from.
                      The price is the one thing on this page a shopper cannot
                      derive for themselves, and the whole product hangs off it.
                      Naming the venue, the venue's own timestamp and how old
                      the print is lets them check it against the exchange
                      rather than take it on trust — which is the difference
                      between a feed and an assertion. */}
                  {chain && (
                    <details className="mt-5 group">
                      <summary className="cursor-pointer list-none text-[10px] uppercase font-bold tracking-widest text-white/35 hover:text-white/60 transition-colors">
                        Where_This_Price_Came_From
                      </summary>
                      <div className="mt-3 space-y-1.5 pl-3 border-l border-white/10">
                        <Row label="Source" value={chain.price.source} />
                        <Row label="Venue" value={chain.price.marketOpen ? "open" : "closed"} />
                        <Row
                          label="Printed"
                          value={new Date(chain.price.printedAt * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z"}
                        />
                        <Row
                          label="Age"
                          value={`${chain.price.ageSeconds}s`}
                          note={chain.price.fresh ? "within bound" : "stale"}
                        />
                        <Row label="Oracle" value={`${ADDRESSES.oracle.slice(0, 10)}…`} />
                      </div>
                      <p className="mt-3 pl-3 text-[10px] leading-relaxed text-white/30">
                        Posted on chain with its provenance, so it can be checked against the venue.
                        Chainlink carries no equity feed on X Layer — all 26 of its price feeds here
                        are crypto.
                      </p>
                    </details>
                  )}

                  <p className="mt-4 text-[10px] leading-relaxed text-white/30">
                    Wallet {short}. The shares lock as collateral and return when you settle — they are
                    not sold. The fee is fixed at checkout, so settling early frees the shares sooner
                    but costs the same.
                  </p>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, note, accent }: { label: string; value: string; note?: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">
        {label}
        {note && <span className="ml-2 text-white/25 normal-case tracking-normal font-normal">{note}</span>}
      </span>
      <span className={`font-mono text-sm ${accent ? "text-green-400 font-black" : "text-white/80"}`}>{value}</span>
    </div>
  )
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">{label}</span>
      <span className={`text-sm font-black font-mono ${accent ? "text-green-400" : ""}`}>{value}</span>
    </div>
  )
}

function Reassurance({
  icon: Icon, title, body,
}: { icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="bg-black p-5">
      <Icon className="w-4 h-4 text-green-500 mb-3" />
      <p className="text-[11px] font-black uppercase tracking-widest">{title}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">{body}</p>
    </div>
  )
}
