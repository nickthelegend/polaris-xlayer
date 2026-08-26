"use client"

import { useCallback, useEffect, useState } from "react"
import { useAccount } from "wagmi"
import { BrowserProvider, Contract, formatUnits } from "ethers"
import { ArrowUpRight, Droplets, Loader2 } from "lucide-react"

import { ConnectGate } from "@/components/connect-gate"

/**
 * Test tokens.
 *
 * The previous faucet offered WETH, USDT and BNB alongside USDC and minted them
 * with a server-held key. None of those tokens is deployed here and the key was
 * never configured, so every button returned a 500.
 *
 * The deployed token exposes its own public `faucet()`, which is the better
 * design anyway: the claim is the user's own transaction, there is no custodial
 * key to leak, and nothing breaks when a server env var goes missing.
 */

const TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F"
const ABI = [
  "function faucet()",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]

export default function FaucetPage() {
  return (
    <ConnectGate
      title="Connect to get test tokens"
      reason="The faucet sends Sepolia test tokens to an address, so it needs one to send them to."
      previewLabel="Your balances"
      previewNote="your test token balances and what the faucet can send"
    >
      <Faucet />
    </ConnectGate>
  )
}

function Faucet() {
  const { address } = useAccount()
  const [balance, setBalance] = useState<string>()
  const [symbol, setSymbol] = useState("pUSDC")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string; hash?: string }>()

  const read = useCallback(async () => {
    const eth = (globalThis as { ethereum?: unknown }).ethereum
    if (!eth || !address) return
    try {
      const token = new Contract(TOKEN, ABI, new BrowserProvider(eth as never))
      const [raw, decimals, sym] = await Promise.all([
        token.balanceOf(address),
        token.decimals(),
        token.symbol(),
      ])
      setSymbol(sym)
      setBalance(
        Number(formatUnits(raw, decimals)).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      )
    } catch {
      // A failed read leaves the balance unknown rather than showing a zero
      // the user might read as "my tokens are gone".
      setBalance(undefined)
    }
  }, [address])

  useEffect(() => {
    void read()
  }, [read])

  const claim = useCallback(async () => {
    const eth = (globalThis as { ethereum?: unknown }).ethereum
    if (!eth || !address) return
    setBusy(true)
    setNote(undefined)
    try {
      const signer = await new BrowserProvider(eth as never).getSigner()
      const tx = await new Contract(TOKEN, ABI, signer).faucet()
      await tx.wait()
      setNote({ kind: "ok", text: "Claimed 1,000 test tokens.", hash: tx.hash })
      await read()
    } catch (err) {
      const e = err as { code?: number | string; shortMessage?: string; message?: string }
      setNote({
        kind: "err",
        text:
          e.code === 4001 || e.code === "ACTION_REJECTED"
            ? "You rejected the transaction."
            : e.shortMessage ?? e.message ?? "Could not claim.",
      })
    } finally {
      setBusy(false)
    }
  }, [address, read])

  return (
    <div className="space-y-8 pt-6 max-w-xl">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Test tokens</h1>
        <p className="text-sm text-foreground/55">
          {symbol} on Sepolia, for trying the product. You will also need a little Sepolia ETH for
          gas, which the public faucets have.
        </p>
      </header>

      <section className="rounded-2xl border border-primary/15 bg-[#05080f]/40 p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-foreground/60">Your balance</p>
            {balance === undefined ? (
              <div className="mt-1.5 h-7 w-32 rounded bg-primary/10 animate-pulse" />
            ) : (
              <p className="text-xl font-semibold tabular-nums">
                {balance} {symbol}
              </p>
            )}
          </div>
          <Droplets className="size-6 text-primary/60" />
        </div>

        <button
          onClick={claim}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Droplets className="size-4" />}
          {busy ? "Claiming…" : `Claim 1,000 ${symbol}`}
        </button>

        {note && (
          <p
            className={`text-sm flex flex-wrap items-center gap-2 ${
              note.kind === "ok" ? "text-primary" : "text-destructive"
            }`}
          >
            {note.text}
            {note.hash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${note.hash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2"
              >
                View <ArrowUpRight className="size-3" />
              </a>
            )}
          </p>
        )}
      </section>

      <p className="text-xs text-foreground/65">
        Token{" "}
        <a
          href={`https://sepolia.etherscan.io/address/${TOKEN}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono underline underline-offset-2 hover:text-foreground/60"
        >
          {TOKEN}
        </a>
      </p>
    </div>
  )
}
