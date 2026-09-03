# 100 ideas, ranked

Scored on **impact × feasibility × fit**. Impact is whether a judge with five
minutes would notice. Fit is whether it strengthens the one sentence this
project is about — *spend the stock, don't sell the stock* — or just adds
surface. A pile of features can hurt a demo as much as help it, so anything
that pulls attention away from that sentence is ranked down or cut, and the
cuts are listed with reasons at the end.

Nothing already built is proposed here. What exists: the checkout, `/activity`,
the merchant QR page, docs, the faucet, the book, verified contracts, the price
relayer, the oracle circuit breaker, CI, smoke tests, Playwright e2e, and the
recorded demo.

---

## Tier 1 — build these (the demo lives or dies here)

| # | Idea | Why it ranks here |
|---|---|---|
| 1 | **Real storefront checkout paying the engine directly** — browse goods, add to cart, pay with stock credit inline, no redirect and no client secret | The pitch is *shop with your stock*. Right now the abstract checkout asks for "shares to lock", which is not how anyone shops. This is the difference between a lending demo and a payments demo. |
| 2 | **Cart total → shares required**, computed from the live price and LTV | A shopper thinks in dollars, not shares. The product has to do that conversion or it isn't a checkout. |
| 3 | **Order confirmation that proves it happened** — tx hash, shares locked, merchant paid, position link | Judges want the receipt, not a toast. |
| 4 | **Orders page in the store** reading real positions, with repay | Closes the loop inside the shop: buy, owe, settle, get the shares back. |
| 5 | **"You keep the upside" panel** — what the locked shares are worth now vs at lock | This is the entire argument for the product, and nothing on screen currently makes it. |
| 6 | **Insufficient-shares path in the store** — priced in goods, not tokens ("this basket needs 1.4 more tXAAPL") | The most common failure a judge will hit. |
| 7 | **One-click demo funding from the store** — get test shares without leaving checkout | Removes the single biggest reason a judge abandons the demo. |
| 8 | **Live price ticker on the storefront** with the venue state | Ties the shop to the market in one glance and makes the collateral feel real. |
| 9 | **Health-aware checkout** — the pay button explains itself when the price is stale or the pool is short | Failing loudly with a reason beats a spinner. |
| 10 | **Storefront → Polaris handoff via the existing merchant QR payload** so the two surfaces are one product | Reuses what exists rather than forking a second checkout. |

## Tier 2 — strong, build if the top ten land

| # | Idea |
|---|---|
| 11 | Liquidation preview: "your position is safe until tXAAPL falls to $X" |
| 12 | Repay-early savings line — interest saved by settling now |
| 13 | Partial repayment |
| 14 | Extend tenor for a fee, inside the 14-day bound |
| 15 | Multi-asset collateral (tXAAPL + a second stock) with a blended ceiling |
| 16 | Merchant settlement dashboard: what was paid, when, by whom |
| 17 | Merchant refund from the storefront order page |
| 18 | Order history persisted in Mongo, keyed to the on-chain loan |
| 19 | Email-less receipt: a signed, shareable order permalink |
| 20 | Position health as a live gauge that moves with the price |
| 21 | Price-drop alert banner when a position nears its threshold |
| 22 | Keeper feed showing real liquidation activity |
| 23 | Pool depositor view: supply stablecoin, earn origination fees |
| 24 | APR breakdown on the quote — where the fee actually comes from |
| 25 | Collateral ladder: show ceilings at 1, 2, 5, 10 shares at once |
| 26 | Checkout as an embeddable widget for any store |
| 27 | SDK snippet on the order page showing the exact call just made |
| 28 | Wallet-agnostic connect (OKX Wallet first, since this is X Layer) |
| 29 | Add-to-wallet button for tXAAPL and pUSDC |
| 30 | Network-switch prompt that adds X Layer if the wallet lacks it |

## Tier 3 — X Layer / sponsor depth

| # | Idea |
|---|---|
| 31 | Sequencer-outage banner driven by the real uptime feed (mainnet) |
| 32 | Show the L2→L1 finality state of the checkout transaction |
| 33 | Gas cost of a checkout displayed in OKB and USD |
| 34 | Batch approve+open in one wallet prompt via multicall |
| 35 | OKB gas balance check before the pay button enables |
| 36 | X Layer faucet deep-link when the wallet has no gas |
| 37 | Explorer links that land on the verified Sourcify source |
| 38 | Contract address book page with verification badges |
| 39 | Chain-id guard on every write, not just at connect |
| 40 | Read-lag aware UI: "the chain hasn't caught up yet" instead of a wrong balance |
| 41 | USDT0 support path documented and switchable by env |
| 42 | Mainnet preflight surfaced in the app, not just a script |
| 43 | Per-block price freshness indicator |
| 44 | Oracle provenance panel: source string, venue timestamp, on-chain age |
| 45 | Circuit-breaker explainer showing the 20% bound in action |

## Tier 4 — design and motion (memorable, not decorative)

| # | Idea |
|---|---|
| 46 | The shares "locking" — a physical motion on the collateral card at checkout |
| 47 | Number roll-up on capacity when the wallet connects |
| 48 | The merchant-paid moment: stablecoin visibly moving pool → merchant |
| 49 | Position health ring that fills and changes colour with the price |
| 50 | Price ticker with a subtle up/down tick animation on each new print |
| 51 | Skeleton states shaped like the real content, not grey boxes |
| 52 | Optimistic quote that settles into the real one |
| 53 | Success state that earns its moment — once, briefly, then out of the way |
| 54 | Reduced-motion honoured throughout |
| 55 | The repay moment: shares visibly returning to the wallet |
| 56 | Cart line items that show their share-cost as you add them |
| 57 | A "what if the price drops" slider on the position |
| 58 | Focus-visible states that are actually visible |
| 59 | Dark/light that follows the system and does not flash |
| 60 | Typography scale that survives a 320px viewport |

## Tier 5 — production readiness

| # | Idea |
|---|---|
| 61 | Empty cart, empty orders, empty positions — each with a way out |
| 62 | Every write error mapped to a sentence (extend past the current 19) |
| 63 | Wallet-rejected handled distinctly from failed |
| 64 | Double-submit guard on checkout |
| 65 | Idempotent order refs derived from the cart, not random |
| 66 | Retry with backoff on RPC flakiness |
| 67 | Offline / RPC-down banner |
| 68 | 404 and 500 pages that match the product |
| 69 | Loading states that never exceed 200ms without feedback |
| 70 | Server-side input validation on every route (done for some) |
| 71 | Rate limiting on the quote endpoint |
| 72 | Structured logging with request ids |
| 73 | Health check that fails the deploy if the oracle is stale |
| 74 | Sentry-style error boundary per route |
| 75 | Accessibility pass: labels, roles, keyboard order |
| 76 | Meta/OG images per route |
| 77 | robots/sitemap correctness (done) — extend with per-route canonicals |
| 78 | Analytics on the funnel: connect → quote → pay |
| 79 | Feature flags for demo vs production behaviour |
| 80 | Seed script that puts a demo wallet in a known good state |

## Tier 6 — worthwhile, lower priority

| # | Idea |
|---|---|
| 81 | Merchant onboarding flow with registry write |
| 82 | Merchant API keys and webhooks |
| 83 | CSV export of settlements |
| 84 | Multi-merchant storefront |
| 85 | Shopper credit profile page with history |
| 86 | Referral / invite mechanic |
| 87 | Savings calculator: stock credit vs selling vs a card |
| 88 | Tax-lot explainer (why not selling matters) |
| 89 | Portfolio import (read any wallet's tokenized equity) |
| 90 | Watchlist of assets accepted as collateral |
| 91 | Governance page for risk parameters |
| 92 | Insurance-pool staking UI (contract now real) |
| 93 | Liquidator bot dashboard |
| 94 | Historical price chart from posted prints |
| 95 | Loan book explorer with filters |
| 96 | Public stats page (TVL, originations, defaults) |
| 97 | i18n scaffolding |
| 98 | PWA install for the storefront |
| 99 | Mobile-first merchant terminal |
| 100 | Printed receipt via the iMin thermal printer module |

---

## Deliberately not building

- **AI anything** — no credential exists, and the only training data is 27
  loans from 3 of this repo's own test wallets. Covered at length in PLAN.md.
- **Mainnet-only features** (31, 42's live half) — mainnet spends real money.
- **Anything requiring a second device or a real payment** (99, 100) — the
  printer module exists and is proven; re-demoing it does not strengthen *this*
  pitch.
- **Ideas 84–98** are real but pull focus. A judge remembers one sentence; a
  governance page and a referral mechanic dilute it.

---

## What was actually built, and verified

Each of these was run against the deployed contracts on X Layer testnet and
confirmed working before moving on. Nothing below is "it compiles".

| # | Idea | Evidence |
|---|---|---|
| 1 | Storefront pays the engine directly | Purchase `0xe97b7a11…` — a $12.00 basket locked 0.118673 tXAAPL and paid the merchant **exactly 12.000000 pUSDC** |
| 2 | Cart total → shares required | $12.00 → 0.1186 tXAAPL at the live mark. 10 unit tests hold the arithmetic, including that a basket rounds up rather than leaving the merchant a millionth short |
| 3 | Order confirmation that proves it | Tx link, shares locked, merchant paid, settle link |
| 4 | Orders page with repay | Settle `0x1da1c49c…` — repaid $12.147616 and **the same 0.118673 tXAAPL came back**, to the wei |
| 5 | "You keep the upside" | `Since_Checkout` column on each order: what the locked shares are worth now against checkout |
| 6 | Insufficient shares, priced in goods | "This basket needs X, this wallet holds Y — Z short", with a way to fix it |
| 7 | One-click funding from checkout | `Get_25_Test_Shares`, signed by the shopper |
| 8 | Live price ticker | `tXAAPL $324.96` in the shop header, with the venue dot and a tick that fires only on a real change |
| 9 | Health-aware checkout | Refuses on a stale price or a short pool, with the reason |
| 11 | Liquidation preview | "Safe until $204.72, 37.0% below today", with a bar that goes amber then red. 2 tests |
| 24 | APR breakdown | Origination $0.12 + interest $0.02 reconciling against a $0.14 fee |
| 26 | Embeddable checkout (partial) | CORS on the public reads, so any storefront on any domain can price a basket |
| 61 | Empty states | Empty cart and empty orders, each with a way out |
| 65 | Idempotent order refs | Derived from the basket, so a double-tap on Pay is a no-op rather than a second loan |

## Deliberately not built, with reasons

- **#12 repay-early savings** — *wrong about the product.* `amountOwed` is
  `principal + fee` for the life of the loan: the fee is prepaid and fixed, so
  settling early frees the shares sooner but costs exactly the same. A savings
  panel would be inventing a discount the contract does not give. The checkout
  now says so plainly instead.
- **AI (#0.2 in PLAN.md)** — no credential exists anywhere, and the only
  training data is 27 loans from 3 of this repo's own test wallets.
- **Mainnet-dependent items (#31, #42's live half)** — spends real money.
- **#84–#98** — real ideas, but they pull focus. A judge remembers one
  sentence; a governance page and a referral mechanic dilute it.
- **#99–#100** — the printer module is already built and proven; re-demoing it
  does not strengthen *this* pitch.
- **Everything else in tiers 3–6** — not reached. Ranked below what was built,
  and the honest status is "not started", not "skipped".
