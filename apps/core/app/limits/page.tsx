"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { useAccount } from "wagmi"
import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers"
import { ArrowUpRight, Loader2, Lock, TrendingUp, Unlock } from "lucide-react"

import { ConnectGate } from "@/components/connect-gate"

/**
 * Credit limit, and the one lever the borrower has over it.
 *
 * The page this replaced showed collateral positions on Morpho, Aave and
 * Compound sourced from an attestation endpoint whose own comment read
 * "Mocked for now" -- three protocols this product has never integrated,
 * rendering "---" forever.
 *
 * What is real is the CollateralVault: lock tokens, get 150% of them as extra
 * credit, withdraw once you owe nothing. That is the whole mechanism, and it is
 * deployed, so it is what the page is about.
 */

const VAULT = "0xDb6781ed843Ba07Af3321bB8C3952db643324b98"
const TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F"

const VAULT_ABI = [
  "function lock(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function lockedOf(address) view returns (uint256)",
  "function withdrawable(address) view returns (uint256)",
  "function creditBoostOf(address) view returns (uint256)",
]
const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]

type Limits = {
  creditScore: number
  currentLimit: string
  baseLimit: string
  collateralBoost: string
  collateralLocked: string
  used: string
  available: string
  activeLoans: number
  repaidLoans: number
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`)
  }
  return res.json()
}

export default function LimitsPage() {
  return (
    <ConnectGate
      title="Connect to see your limit"
      reason="Your limit is built from this wallet's own repayment history, so there is nothing to show until we know which wallet you are."
      previewLabel="Your credit line"
      previewNote="your score, your limit and the collateral behind it"
    >
      <Limits />
    </ConnectGate>
  )
}

function Limits() {
  const { address } = useAccount()
  const { data, error, mutate } = useSWR<Limits>(
    address ? `/api/limits?address=${address}` : null,
    fetcher,
    { refreshInterval: 20_000 }
  )

  const [amount, setAmount] = useState("")
  const [busy, setBusy] = useState<"lock" | "withdraw" | null>(null)
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string; hash?: string }>()

  const run = useCallback(
    async (action: "lock" | "withdraw") => {
      const eth = (globalThis as { ethereum?: unknown }).ethereum
      if (!eth || !address) return
      const value = amount.trim()
      if (!value || Number(value) <= 0) {
        setNote({ kind: "err", text: "Enter an amount first." })
        return
      }

      setBusy(action)
      setNote(undefined)
      try {
        const provider = new BrowserProvider(eth as never)
        const signer = await provider.getSigner()
        const token = new Contract(TOKEN, ERC20_ABI, signer)
        const decimals = await token.decimals()
        const raw = parseUnits(value, decimals)
        const vault = new Contract(VAULT, VAULT_ABI, signer)

        if (action === "lock") {
          // Approve only when the standing allowance is short: an approval the
          // borrower does not need is a wallet popup they should not see.
          if ((await token.allowance(address, VAULT)) < raw) {
            await (await token.approve(VAULT, raw)).wait()
          }
          const tx = await vault.lock(raw)
          await tx.wait()
          setNote({ kind: "ok", text: `Locked ${value}. Your limit just went up.`, hash: tx.hash })
        } else {
          const tx = await vault.withdraw(raw)
          await tx.wait()
          setNote({ kind: "ok", text: `Withdrew ${value}.`, hash: tx.hash })
        }
        setAmount("")
        await mutate()
      } catch (err) {
        setNote({ kind: "err", text: readable(err) })
      } finally {
        setBusy(null)
      }
    },
    [address, amount, mutate]
  )

  const locked = Number(data?.collateralLocked ?? "0")
  const owes = Number(data?.used ?? "0")

  return (
    <div className="space-y-8 pt-6">
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Your limit</h1>
        <p className="text-sm text-foreground/55 max-w-2xl">
          Every wallet gets a limit underwritten from its own history. Lock collateral and you get
          150% of it as extra credit on top.
        </p>
      </header>

      {error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error.message}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <Figure label="Total limit" value={data?.currentLimit} accent />
        <Figure label="Earned on history" value={data?.baseLimit} />
        <Figure label="From collateral" value={data?.collateralBoost} />
      </section>

      {/* The bar makes the split legible at a glance: how much of the limit was
          earned versus bought with collateral, and how much is already spent. */}
      {data && <Breakdown data={data} />}

      <section className="rounded-2xl border border-primary/15 bg-[#05080f]/40 p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Lock className="size-4 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1">
            <h2 className="font-semibold">Collateral</h2>
            <p className="text-sm text-foreground/55">
              {locked > 0
                ? `${data?.collateralLocked} locked, worth ${data?.collateralBoost} of extra credit.`
                : "Nothing locked yet."}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            // A placeholder is not a label: it vanishes on focus, and without
            // this the field is announced as unnamed.
            aria-label="Collateral amount to lock or withdraw"
            className="flex-1 rounded-xl border border-primary/20 bg-black/40 px-4 py-3 text-sm tabular-nums outline-none focus:border-primary/50 transition-colors"
          />
          <button
            onClick={() => run("lock")}
            disabled={busy !== null}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {busy === "lock" ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            Lock
          </button>
          <button
            onClick={() => run("withdraw")}
            disabled={busy !== null || locked === 0 || owes > 0}
            title={owes > 0 ? "Repay what you owe before withdrawing" : undefined}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 px-5 py-3 text-sm font-semibold text-primary transition-all hover:bg-primary/10 active:scale-[0.98] disabled:opacity-40"
          >
            {busy === "withdraw" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Unlock className="size-4" />
            )}
            Withdraw
          </button>
        </div>

        {owes > 0 && locked > 0 && (
          <p className="text-xs text-amber-400/80">
            Withdrawal is blocked while you owe {data?.used}. Clear your plans and it unlocks.
          </p>
        )}

        {note && (
          <p
            className={`text-sm ${note.kind === "ok" ? "text-primary" : "text-destructive"} flex items-center gap-2 flex-wrap`}
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

      <section className="grid gap-4 sm:grid-cols-3">
        <Figure label="Polaris score" value={data ? String(data.creditScore) : undefined} />
        <Figure label="Plans open" value={data ? String(data.activeLoans) : undefined} />
        <Figure label="Plans repaid" value={data ? String(data.repaidLoans) : undefined} />
      </section>
    </div>
  )
}

function Breakdown({ data }: { data: Limits }) {
  const total = Number(data.currentLimit) || 1
  const base = (Number(data.baseLimit) / total) * 100
  const boost = (Number(data.collateralBoost) / total) * 100
  const used = (Number(data.used) / total) * 100

  return (
    <section className="space-y-3">
      <div className="h-3 w-full overflow-hidden rounded-full bg-primary/10 flex">
        <div className="bg-primary/70" style={{ width: `${base}%` }} title="Earned on history" />
        <div className="bg-primary/30" style={{ width: `${boost}%` }} title="From collateral" />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-foreground/55">
        <Legend swatch="bg-primary/70" label={`${data.baseLimit} earned`} />
        <Legend swatch="bg-primary/30" label={`${data.collateralBoost} from collateral`} />
        <span className="inline-flex items-center gap-1.5">
          <TrendingUp className="size-3" />
          {data.available} available · {data.used} in use ({used.toFixed(0)}%)
        </span>
      </div>
    </section>
  )
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${swatch}`} />
      {label}
    </span>
  )
}

function Figure({ label, value, accent }: { label: string; value?: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl border px-4 py-4 space-y-1.5 ${
        accent ? "border-primary/40 bg-primary/5" : "border-primary/15 bg-[#05080f]/40"
      }`}
    >
      <p className="text-[11px] uppercase tracking-widest text-foreground/60">{label}</p>
      {value === undefined ? (
        <div className="h-7 w-24 rounded bg-primary/10 animate-pulse" />
      ) : (
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      )}
    </div>
  )
}

/**
 * Wallet and revert errors arrive wrapped in several layers of noise. Show the
 * part a person can act on, and say plainly when they simply declined.
 */
function readable(err: unknown): string {
  const e = err as { code?: number | string; shortMessage?: string; reason?: string; message?: string }
  if (e.code === 4001 || e.code === "ACTION_REJECTED") return "You rejected the transaction."
  if (e.reason === "DebtOutstanding" || /DebtOutstanding/.test(e.message ?? "")) {
    return "You still owe on an open plan, so collateral cannot be withdrawn yet."
  }
  return e.shortMessage ?? e.reason ?? e.message ?? "Something went wrong."
}
