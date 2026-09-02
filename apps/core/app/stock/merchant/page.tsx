"use client"

import { useMemo, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { useAccount } from "wagmi"

import { ConnectGate } from "@/components/connect-gate"

/**
 * The merchant's side of the counter.
 *
 * The pitch opens with "scan merchant QR" and for a while there was no QR
 * anywhere in the product, which is the kind of gap between a deck and a demo
 * that a reviewer notices before anything else.
 *
 * The code carries the checkout, not a payment: merchant address, order
 * reference and the shares to lock. The shopper's wallet still signs, and the
 * price is still quoted from the chain at the moment they scan — so a stale
 * code cannot lock in a stale number.
 */
export default function MerchantPage() {
  return (
    <ConnectGate
      title="Connect the wallet that takes the money"
      reason="The code you hand a customer has to name the address the pool pays, and that is this wallet."
      previewLabel="Your counter"
      previewNote="a checkout code your customers can scan"
    >
      <MerchantCounter />
    </ConnectGate>
  )
}

function MerchantCounter() {
  const { address } = useAccount()
  const [shares, setShares] = useState("10")
  const [orderRef, setOrderRef] = useState("order-" + Math.random().toString(36).slice(2, 8))

  const url = useMemo(() => {
    if (!address) return ""
    const origin = typeof window === "undefined" ? "" : window.location.origin
    const q = new URLSearchParams({ merchant: address, ref: orderRef, shares })
    return `${origin}/stock?${q.toString()}`
  }, [address, orderRef, shares])

  return (
    <div className="py-10">
      <p className="label">Polaris · stock credit</p>
      <h1 className="mt-3 text-[clamp(2rem,5vw,3.4rem)] font-medium leading-[0.98] tracking-[-0.035em] text-white">
        Take a payment
      </h1>
      <p className="mt-4 max-w-[62ch] text-white/60">
        Show this code. The customer scans it, their wallet signs, and the pool pays you in
        stablecoin the moment their shares lock.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_auto]">
        <div className="surface p-6 md:p-8">
          <label className="label block" htmlFor="m-shares">Shares the customer locks</label>
          <input
            id="m-shares" value={shares} inputMode="decimal" data-testid="merchant-shares"
            onChange={(e) => setShares(e.target.value)}
            className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xl text-white outline-none focus:border-white/25"
          />

          <label className="label mt-5 block" htmlFor="m-ref">Order reference</label>
          <input
            id="m-ref" value={orderRef} data-testid="merchant-ref"
            onChange={(e) => setOrderRef(e.target.value)}
            className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-sm text-white outline-none focus:border-white/25"
          />

          <p className="label mt-6">Paid to</p>
          <p className="mt-2 break-all font-mono text-sm text-white/70">{address}</p>

          <p className="mt-6 text-[11px] text-white/40">
            The code carries the checkout, not a payment. Nothing is charged until the customer&rsquo;s
            own wallet signs, and the price is quoted from the chain at that moment — so a code left
            on the counter cannot lock in yesterday&rsquo;s number.
          </p>
        </div>

        <div className="surface flex flex-col items-center justify-center gap-4 p-8">
          {url ? (
            <>
              {/* White quiet zone is not decoration: a scanner needs the
                  contrast, and a code drawn in the brand green on near-black
                  fails on half the phones that try it. */}
              <div className="rounded-lg bg-white p-4" data-testid="merchant-qr">
                <QRCodeSVG value={url} size={232} level="M" />
              </div>
              <a
                href={url}
                className="max-w-[280px] break-all text-center font-mono text-[10px] text-white/40 underline underline-offset-4"
              >
                {url}
              </a>
            </>
          ) : (
            <p className="text-white/50">Connect to generate a code.</p>
          )}
        </div>
      </div>
    </div>
  )
}
