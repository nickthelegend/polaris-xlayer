"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { useAccount } from "wagmi"

/**
 * The borrower's side of the ledger.
 *
 * A merchant opens their dashboard to see what they are owed. A borrower opens
 * this to answer three questions, in this order: how much can I still spend,
 * what leaves my wallet next, and is anything wrong. The page is ordered that
 * way and nothing competes with it.
 *
 * This is the BNPL surface backed by the Sepolia LoanEngine and the Mongo loan
 * book. The FHE credit view at /credit is a separate product surface and is
 * left alone.
 */

type Installment = {
  index: number
  dueAt: string
  amountDisplay: string
  state: "scheduled" | "paid" | "dunning" | "written_off"
  attempts: number
  transactionHash?: string
}

type Plan = {
  loanId: string
  orderId: string
  merchantName: string
  status: "active" | "repaid" | "liquidated" | "defaulted"
  outstandingDisplay: string
  installments: Installment[]
}

type CreditProfile = {
  score: number
  scoreDelta: number
  limitDisplay: string
  availableDisplay: string
  usedDisplay: string
  onTimePayments: number
  latePayments: number
  nextDueAt: string | null
  nextDueDisplay: string | null
  plans: Plan[]
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Could not load your credit line (${r.status})`)
    return r.json()
  })

/**
 * Demo borrower shown when no wallet is connected. This is the address that
 * actually holds plans on Sepolia, so the page is viewable - and recordable -
 * without a wallet. Read-only either way: nothing here is actionable.
 */
const DEMO_BORROWER =
  process.env.NEXT_PUBLIC_DEMO_BORROWER ??
  "0x7a2e11b3ecebab8ea46966edadd4092583809b67"

export default function PlansPage() {
  const { address, isConnected } = useAccount()
  const borrower = (isConnected && address ? address : DEMO_BORROWER).toLowerCase()

  const { data, error, isLoading } = useSWR<CreditProfile>(
    `/api/credit/me?address=${borrower}`,
    fetcher,
    { refreshInterval: 30_000 }
  )
  const [expanded, setExpanded] = useState<string | null>(null)

  const utilisation = useMemo(() => {
    if (!data) return 0
    const limit = Number.parseFloat(data.limitDisplay.replace(/,/g, "")) || 0
    const used = Number.parseFloat(data.usedDisplay.replace(/,/g, "")) || 0
    return limit === 0 ? 0 : Math.min(used / limit, 1)
  }, [data])

  if (error) {
    return (
      <Shell>
        <div className="rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-6">
          <p className="text-sm font-medium text-rose-200">We could not load your credit line</p>
          <p className="mt-1.5 font-mono text-[13px] text-rose-200/70">{error.message}</p>
          <button
            onClick={() => location.reload()}
            className="mt-4 rounded-md border border-rose-300/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-rose-100 transition-colors hover:bg-rose-400/10"
          >
            Try again
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {/*
        Three bands stacked full-width made the most important number on the
        page carry no more weight than the paragraph under it. As a bento the
        balance keeps the largest plane and the two supporting figures sit
        beside it, which is the order they are actually read in.
      */}
      <section className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="surface flex flex-col justify-between gap-8 p-6 md:p-8">
          <div>
            <p className="label">Available to spend</p>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="figure-lg font-mono text-[clamp(2.75rem,7vw,4.5rem)] font-medium text-white">
                {isLoading ? <Bar w="8ch" /> : (data?.availableDisplay ?? "0.00")}
              </span>
              <span className="font-mono text-lg text-white/60">USDC</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between font-mono text-[11px] text-white/60">
              <span>{data ? `${data.usedDisplay} in use` : "-"}</span>
              <span>{data ? `${data.limitDisplay} limit` : "-"}</span>
            </div>
            {/* A single utilisation rule, not a decorative bar: the fill is the
                share of the limit already committed. */}
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white/70 transition-[width] duration-700 ease-out"
                style={{ width: `${utilisation * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="surface p-6">
            <p className="label">Next collection</p>
            {isLoading ? (
              <p className="mt-2.5 text-2xl">
                <Bar w="10ch" />
              </p>
            ) : data?.nextDueAt ? (
              <p className="figure mt-2.5 font-mono text-2xl text-white">
                {data.nextDueDisplay}
                <span className="ml-3 text-sm font-normal text-white/60">
                  {formatDue(data.nextDueAt)}
                </span>
              </p>
            ) : (
              <p className="mt-2.5 text-lg text-white/60">Nothing scheduled</p>
            )}
            <p className="mt-3 text-[13px] leading-relaxed text-white/60">
              Collected automatically from your wallet. Keep the balance topped up and there is
              nothing for you to do.
            </p>
          </div>

          <div className="surface p-6">
            <ScorePanel data={data} loading={isLoading} />
          </div>
        </div>
      </section>

      <section className="pt-12">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-white">Your plans</h2>
          {data?.plans.length ? (
            <span className="label">
              {data.plans.length} total
            </span>
          ) : null}
        </div>
        <div className="mt-5">
          {isLoading ? (
            [0, 1, 2].map((i) => <PlanSkeleton key={i} />)
          ) : !data?.plans.length ? (
            <EmptyState />
          ) : (
            data.plans.map((p) => (
              <PlanRow
                key={p.loanId}
                plan={p}
                open={expanded === p.loanId}
                onToggle={() => setExpanded(expanded === p.loanId ? null : p.loanId)}
              />
            ))
          )}
        </div>
      </section>
    </Shell>
  )
}

/* ---------------------------------------------------------------- */

/**
 * `bg-background` used to sit on this wrapper, which painted an opaque plane
 * over the ambient ground and left the page's own panels floating on flat
 * black. The body already supplies the background; a page should not repaint it.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-foreground">
      <main className="shell max-w-[1080px] py-14">{children}</main>
    </div>
  )
}

function ScorePanel({ data, loading }: { data?: CreditProfile; loading: boolean }) {
  const score = data?.score ?? 0
  const delta = data?.scoreDelta ?? 0
  // 300-850 is the full band; place the marker within it.
  const position = Math.max(0, Math.min(1, (score - 300) / 550))

  return (
    <div>
      <p className="label">Polaris score</p>
      <div className="mt-2.5 flex items-baseline gap-2.5">
        <span className="font-mono text-2xl tabular-nums text-white">
          {loading ? <Bar w="3ch" /> : score}
        </span>
        {!loading && delta !== 0 && (
          <span
            className={`font-mono text-xs tabular-nums ${
              delta > 0 ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            {delta > 0 ? "+" : ""}
            {delta}
          </span>
        )}
      </div>

      <div className="relative mt-3 h-[3px] w-full rounded-full bg-white/10">
        <span
          className="absolute top-1/2 h-2.5 w-[3px] -translate-y-1/2 rounded-full bg-white"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-white/65">
        <span>300</span>
        <span>850</span>
      </div>

      {!loading && data && (
        <p className="mt-3 text-[12px] leading-relaxed text-white/60">
          {data.onTimePayments} on time
          {data.latePayments > 0 ? `, ${data.latePayments} late` : ""}. Paying on time raises your
          limit.
        </p>
      )}
    </div>
  )
}

function PlanRow({
  plan,
  open,
  onToggle,
}: {
  plan: Plan
  open: boolean
  onToggle: () => void
}) {
  const paid = plan.installments.filter((i) => i.state === "paid").length
  const inTrouble = plan.installments.some((i) => i.state === "dunning")

  return (
    <div className="border-b border-white/[0.07]">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white/90">
            {plan.merchantName}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] text-white/60">{plan.orderId}</span>
        </span>

        <span className="hidden items-center gap-[3px] sm:flex" aria-hidden>
          {plan.installments.map((i) => (
            <span
              key={i.index}
              className={`h-3.5 w-[3px] rounded-full ${
                i.state === "paid"
                  ? "bg-white/80"
                  : i.state === "dunning"
                    ? "bg-amber-300"
                    : "bg-white/15"
              }`}
            />
          ))}
        </span>

        <span className="w-[7ch] text-right font-mono text-[13px] tabular-nums text-white/55">
          {paid}/{plan.installments.length}
        </span>

        <span className="w-[9ch] text-right font-mono text-[13px] tabular-nums text-white/90">
          {plan.outstandingDisplay}
        </span>

        <span className="hidden w-[9ch] text-right sm:block">
          {plan.status === "liquidated" || plan.status === "defaulted" ? (
            <Tag tone="danger">Closed</Tag>
          ) : plan.status === "repaid" ? (
            <Tag tone="muted">Paid off</Tag>
          ) : inTrouble ? (
            <Tag tone="warn">Retrying</Tag>
          ) : (
            <Tag tone="ok">On track</Tag>
          )}
        </span>
      </button>

      {open && (
        <ol className="pb-5">
          {plan.installments.map((i) => (
            <li
              key={i.index}
              className="flex items-center gap-4 border-t border-white/[0.04] py-2.5 font-mono text-[12px] first:border-t-0"
            >
              <span className="w-[3ch] tabular-nums text-white/65">{i.index}</span>
              <span className="w-[11ch] tabular-nums text-white/85">{i.amountDisplay}</span>
              <span className="flex-1 text-white/60">
                {i.state === "paid"
                  ? "Collected"
                  : i.state === "dunning"
                    ? `Retrying, attempt ${i.attempts}`
                    : formatDue(i.dueAt)}
              </span>
              {i.transactionHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${i.transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/65 underline-offset-4 hover:text-white/70 hover:underline"
                >
                  receipt
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Tag({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "muted"
  children: React.ReactNode
}) {
  const tones = {
    ok: "text-emerald-300/90",
    warn: "text-amber-300",
    danger: "text-rose-300",
    muted: "text-white/65",
  } as const
  return (
    <span className={`font-mono text-[11px] uppercase tracking-[0.08em] ${tones[tone]}`}>
      {children}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="py-20 text-center">
      <p className="text-base font-medium text-white/85">No plans yet</p>
      <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-white/60">
        Split a purchase into instalments at any store that accepts Polaris, and it appears here
        with every collection listed.
      </p>
      {/* "Where can I use this" is answered by the shop registry, not by the
          integration docs this used to point at. */}
      <Link
        href="/merchants"
        className="mt-6 inline-block font-mono text-[11px] uppercase tracking-[0.12em] text-white/60 underline-offset-4 hover:text-white hover:underline"
      >
        Where can I use this
      </Link>
    </div>
  )
}

function PlanSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-white/[0.07] py-4">
      <span className="flex-1">
        <Bar w="14ch" />
      </span>
      <Bar w="5ch" />
      <Bar w="8ch" />
    </div>
  )
}

function Bar({ w }: { w: string }) {
  return (
    <span
      className="inline-block h-[0.75em] animate-pulse rounded bg-white/10 align-middle"
      style={{ width: w }}
    />
  )
}

function formatDue(iso: string): string {
  const due = new Date(iso)
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000)
  if (days < -1) return `${Math.abs(days)} days overdue`
  if (days === -1 || days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  if (days < 14) return `In ${days} days`
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
