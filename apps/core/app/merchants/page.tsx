"use client"

import { useState } from "react"
import useSWR from "swr"
import { ArrowUpRight, Search, Store } from "lucide-react"

/**
 * Merchants accepting Polaris.
 *
 * The version of this page it replaced advertised "VENDORS: 1,248" and
 * "UPTIME: 99.99%" as literals, filtered on a `category` field the merchant
 * records do not have, and rendered `$NaN` for a `credit_limit` that does not
 * exist either. It described a network that was not there.
 *
 * The registry is small and real. Showing it honestly is more persuasive than
 * inventing a directory, and every merchant here has a payout address you can
 * go and look at.
 *
 * It is also public. This sat behind the wallet gate, which meant the one page
 * whose entire purpose is to be browsed before you commit to anything demanded
 * a wallet first. Nothing here is per-wallet: it is a list of shops and the
 * addresses they settle to, all of it already on chain.
 *
 * Layout note: the grid was `lg:grid-cols-3`, which reserves three tracks
 * whether or not there are three merchants -- so the one real shop rendered as
 * a third of a row adrift in empty space, and an honest registry was made to
 * look like a broken one. `.grid-cards` sizes to what exists, and the join card
 * is a real call to action that also guarantees the row is never a single tile.
 */

type Merchant = {
  merchantId: string
  chainId: number
  name: string
  payoutAddress: string
  createdAt: string
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

/**
 * The storefront that ships with the project, so the list is never a dead end.
 * Configurable because a deployed build does not run the store on localhost.
 */
const STORE_URL = process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:3111/store"

/** Two letters off the shop name, so a card has an anchor before it has a logo. */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "??"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export default function MerchantsPage() {
  const { data, error } = useSWR<Merchant[]>("/api/merchants", fetcher, {
    refreshInterval: 60_000,
  })
  const [search, setSearch] = useState("")

  const merchants = (data ?? []).filter((m) =>
    m.name.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <div className="pb-24">
      <header className="page-head" data-actions>
        <div className="grid gap-3">
          <p className="label text-primary">Registry</p>
          <h1 className="page-title">Merchants</h1>
          <p className="page-lede text-sm">
            Shops accepting Polaris. Any merchant can register and start splitting checkouts into
            four. Their payout address receives the full price when the plan opens, out of
            protocol liquidity.
          </p>
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-foreground/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchants"
            aria-label="Search merchants"
            className="w-full rounded-[--radius] border border-foreground/10 bg-foreground/[0.03] py-2.5 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-foreground/65 focus:border-primary/45"
          />
        </div>
      </header>

      {/*
        Three facts about the registry, all of them derived rather than written.
        The count is the length of the list you are looking at, which is the only
        honest way to state it.
      */}
      <dl className="plate mb-9 grid sm:grid-cols-3">
        <div className="stat">
          <dt className="label">Registered</dt>
          <dd className="stat-value">{data ? data.length : "--"}</dd>
          <dd className="stat-note">Live on the registry</dd>
        </div>
        <div className="stat border-t border-foreground/[0.08] sm:border-l sm:border-t-0">
          <dt className="label">Network</dt>
          <dd className="stat-value">Sepolia</dd>
          <dd className="stat-note">Real contracts, testnet funds</dd>
        </div>
        <div className="stat border-t border-foreground/[0.08] sm:border-l sm:border-t-0">
          <dt className="label">Default split</dt>
          <dd className="stat-value">4 &times;</dd>
          <dd className="stat-note">Collected every 14 days</dd>
        </div>
      </dl>

      {error && (
        <div className="surface mb-6 border-amber-500/25 px-5 py-4">
          <p className="text-sm font-medium text-amber-300">The registry is not loading</p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/55">
            This is a read on our side, not a chain problem. The merchants themselves are
            unaffected.
          </p>
        </div>
      )}

      {!(data || error) && (
        <div className="grid-cards" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="surface h-56 animate-pulse" />
          ))}
        </div>
      )}

      {data && merchants.length === 0 && search && (
        <div className="empty">
          <Store className="size-6 text-foreground/25" />
          <p className="text-sm text-foreground/60">No merchant matches &ldquo;{search}&rdquo;.</p>
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {data && (
        <div className="grid-cards">
          {merchants.map((m) => (
            <article
              key={m.merchantId}
              className="surface surface-interactive flex flex-col gap-5 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  aria-hidden
                  className="figure grid size-11 place-items-center rounded-[--radius-md] border border-primary/25 bg-primary/10 text-sm font-semibold text-primary"
                >
                  {monogram(m.name)}
                </span>
                <span className="label">
                  since{" "}
                  {new Date(m.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>

              <div>
                <h2 className="text-lg font-semibold leading-tight tracking-tight">{m.name}</h2>
                <p className="figure mt-1 text-xs text-foreground/60">{m.merchantId}</p>
              </div>

              <div className="mt-auto">
                <p className="label">Settles to</p>
                <a
                  href={`https://sepolia.etherscan.io/address/${m.payoutAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="figure mt-1 inline-flex items-center gap-1 text-xs text-foreground/60 underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  {m.payoutAddress.slice(0, 10)}...{m.payoutAddress.slice(-8)}
                  <ArrowUpRight className="size-3" />
                </a>

                <a
                  href={STORE_URL}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[--radius] bg-primary px-4 py-2.5 text-sm font-semibold text-black transition-[filter,transform] hover:brightness-110 active:scale-[0.99]"
                >
                  Shop <ArrowUpRight className="size-3.5" />
                </a>
              </div>
            </article>
          ))}

          {/*
            Always the last cell. It keeps a one-merchant registry from reading
            as an empty grid, and it is the action the page is actually for.
          */}
          <a
            href="/docs"
            className="empty group transition-colors hover:border-primary/35"
          >
            <span className="grid size-11 place-items-center rounded-[--radius-md] border border-foreground/15 text-foreground/40 transition-colors group-hover:border-primary/40 group-hover:text-primary">
              <Store className="size-5" />
            </span>
            <p className="text-sm font-medium">List your store</p>
            <p className="max-w-[26ch] text-xs leading-relaxed text-foreground/55">
              One SDK call and a payout address. Checkouts split into four from the first order.
            </p>
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
              Read the docs <ArrowUpRight className="size-3" />
            </span>
          </a>
        </div>
      )}
    </div>
  )
}
