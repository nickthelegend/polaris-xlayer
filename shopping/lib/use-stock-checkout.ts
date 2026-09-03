"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { keccak256, maxUint256, toBytes } from "viem"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"

import { ADDRESSES, ENGINE_ABI, ERC20_ABI, explainWriteError, waitForAllowance } from "@/lib/polaris-client"
import { type Pricing, quoteForShares, sharesForTotal, usdToUnits } from "@/lib/stock-pricing"

/**
 * Paying for a basket with stock, from inside the shop.
 *
 * The storefront used to post the order to a separate merchant service and
 * redirect to a hosted page, which needed a client id, a client secret and a
 * second app running on localhost. None of that survives a demo. The shopper's
 * own wallet talks to the engine here: approve the shares, open the loan, and
 * the merchant is paid from the pool in the same transaction.
 *
 * Everything is read from the chain — the price, the risk parameters, the
 * shopper's balance. Nothing is assumed and nothing is stubbed.
 */

export type CheckoutState =
  | { step: "idle" }
  | { step: "quoting" }
  | { step: "approving" }
  | { step: "paying" }
  | { step: "done"; hash: `0x${string}`; shares: bigint; paid: bigint }
  | { step: "error"; message: string }

export type StockQuote = {
  /** What the basket costs, in stablecoin units. */
  total: bigint
  /** Shares that have to be locked to cover it. */
  shares: bigint
  /** What those shares are worth right now. */
  collateralValue: bigint
  /** The most they could support at the current LTV. */
  ceiling: bigint
  /** Origination fee, taken out of the ceiling. */
  fee: bigint
  /** What the merchant actually receives. */
  merchantReceives: bigint
  /** What the wallet holds. */
  held: bigint
  /** Whether the wallet can cover it. */
  affordable: boolean
  /** How many more shares are needed, if not. */
  shortfall: bigint
  pricing: Pricing
  marketOpen: boolean
  priceSource: string
}

type ChainState = {
  price: { usdPerShare: string; marketOpen: boolean; source: string; fresh: boolean }
  risk: {
    maxLtvBps: number
    closedMarketHaircutBps: number
    originationFeeBps: number
    interestAprBps: number
  }
  balances: { viewerShares: string }
  pool: { available: string }
  merchant: `0x${string}`
  tokens: { stockSymbol: string; stableSymbol: string }
}

/** Where the storefront reads chain state from. The app owns the RPC quota. */
/** The tenor every storefront loan opens at; the engine's floor is 7 days. */
const TENOR = BigInt(7 * 86400)

const STATE_URL = process.env.NEXT_PUBLIC_POLARIS_URL ?? "https://polaris-xlayer.vercel.app"

export function useStockCheckout(totalUsd: number) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [chain, setChain] = useState<ChainState | null>(null)
  const [state, setState] = useState<CheckoutState>({ step: "idle" })
  const [loadError, setLoadError] = useState<string | null>(null)

  /*
   * A lock, not a disabled button.
   *
   * Two clicks land before React has re-rendered the button as disabled, so
   * both entered `pay` — the first opened the loan and the second reverted on
   * the engine's idempotency check and overwrote the success. The shopper was
   * shown an empty cart while a real transaction had already paid the
   * merchant: money moved and nothing on screen said so.
   *
   * A ref flips synchronously, so the second call is refused in the same tick
   * regardless of when React gets around to re-rendering.
   */
  const inFlight = useRef(false)

  // Read the chain's view of the world: price, risk, this wallet's shares.
  const refresh = useCallback(async () => {
    try {
      const url = address
        ? `${STATE_URL}/api/stock/state?address=${address}`
        : `${STATE_URL}/api/stock/state`
      const res = await fetch(url, { cache: "no-store" })
      if (!res.ok) throw new Error(`state ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setChain(json)
      setLoadError(null)
    } catch (e: unknown) {
      setLoadError(
        "Could not reach Polaris to price this basket. The storefront is up; the chain read is not.",
      )
    }
  }, [address])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 20_000)
    return () => clearInterval(t)
  }, [refresh])

  const quote: StockQuote | null = (() => {
    if (!chain || totalUsd <= 0) return null

    // The haircut applies to the LTV itself while the venue is shut.
    const ltvBps = chain.price.marketOpen
      ? BigInt(chain.risk.maxLtvBps)
      : (BigInt(chain.risk.maxLtvBps) * BigInt(10000 - chain.risk.closedMarketHaircutBps)) / 10000n

    const pricing: Pricing = {
      usdPerShare: BigInt(chain.price.usdPerShare),
      ltvBps,
      originationFeeBps: BigInt(chain.risk.originationFeeBps),
      // The engine charges interest for the tenor at open, not just
      // origination. Leaving it out asked for more than the ceiling allows.
      interestAprBps: BigInt(chain.risk.interestAprBps),
      tenor: TENOR,
    }

    const total = usdToUnits(totalUsd.toFixed(2))
    const shares = sharesForTotal(total, pricing)
    const q = quoteForShares(shares, pricing)
    const held = BigInt(chain.balances.viewerShares)

    return {
      total,
      shares,
      ...q,
      held,
      affordable: held >= shares,
      shortfall: held >= shares ? 0n : shares - held,
      pricing,
      marketOpen: chain.price.marketOpen,
      priceSource: chain.price.source,
    }
  })()

  /** Approve if needed, then open the loan. Both signed by the shopper. */
  const pay = useCallback(
    async (orderRef: string) => {
      if (inFlight.current) return
      if (!quote || !address || !publicClient || !chain) return
      if (!quote.affordable) {
        setState({ step: "error", message: "This wallet does not hold enough shares for that basket." })
        return
      }
      if (!chain.price.fresh) {
        setState({
          step: "error",
          message: "The market price on chain is stale, so a loan cannot be opened against it yet.",
        })
        return
      }
      if (BigInt(chain.pool.available) < quote.merchantReceives) {
        setState({
          step: "error",
          message: "The pool does not have enough stablecoin to pay the merchant for this basket right now.",
        })
        return
      }

      inFlight.current = true
      try {
        const allowance = (await publicClient.readContract({
          address: ADDRESSES.stock as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, ADDRESSES.engine],
        } as never)) as bigint

        if (allowance < quote.shares) {
          setState({ step: "approving" })
          const approveHash = await writeContractAsync({
            address: ADDRESSES.stock as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [ADDRESSES.engine as `0x${string}`, maxUint256],
          } as never)
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
          // X Layer serves pre-transaction state for a moment after a receipt,
          // so openLoan would otherwise simulate against the old allowance.
          const visible = await waitForAllowance(
            publicClient,
            ADDRESSES.stock as `0x${string}`,
            address,
            ADDRESSES.engine as `0x${string}`,
            quote.shares,
          )
          if (!visible) {
            setState({
              step: "error",
              message: "The approval is confirmed but the node has not caught up yet. Try again in a moment.",
            })
            return
          }
        }

        setState({ step: "paying" })
        const hash = await writeContractAsync({
          address: ADDRESSES.engine as `0x${string}`,
          abi: ENGINE_ABI,
          functionName: "openLoan",
          args: [
            ADDRESSES.stock as `0x${string}`,
            quote.shares,
            chain.merchant,
            // The contract keys idempotency on (merchant, orderRef, borrower),
            // so a double-tap on Pay is a no-op rather than a second loan.
            keccak256(toBytes(orderRef)),
            quote.merchantReceives,
            TENOR,
          ],
        } as never)
        await publicClient.waitForTransactionReceipt({ hash })
        setState({ step: "done", hash, shares: quote.shares, paid: quote.merchantReceives })
        void refresh()
      } catch (e: unknown) {
        setState({ step: "error", message: explainWriteError(e, chain.tokens.stockSymbol) })
      } finally {
        inFlight.current = false
      }
    },
    [quote, address, publicClient, chain, writeContractAsync, refresh],
  )

  /** Testnet shares, so a visitor can actually try the thing. */
  const fundShares = useCallback(async () => {
    if (!publicClient) return
    try {
      setState({ step: "approving" })
      const hash = await writeContractAsync({
        address: ADDRESSES.stock as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "faucet",
        args: [25n * 10n ** 18n],
      } as never)
      await publicClient.waitForTransactionReceipt({ hash })
      setState({ step: "idle" })
      void refresh()
    } catch (e: unknown) {
      setState({ step: "error", message: explainWriteError(e, chain?.tokens.stockSymbol ?? "shares") })
    }
  }, [publicClient, writeContractAsync, refresh, chain])

  return {
    chain,
    quote,
    state,
    loadError,
    pay,
    fundShares,
    refresh,
    reset: () => setState({ step: "idle" }),
  }
}
