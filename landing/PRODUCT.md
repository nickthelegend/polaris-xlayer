# Product

<!-- impeccable:product-schema 1 -->

> **Provenance.** Written by inference from the codebase, README, deployed copy
> and live API behaviour, not from an interview — the user's brief for this run
> explicitly instructed that product and design truth be derived from the code
> rather than asked for. Facts below carry `[inferred]` where they came from
> reading rather than confirmation.

## Platform

web

## Users

Two distinct audiences, both arriving with a wallet rather than an account:

- **Buyers** paying at a checkout. They choose how to pay — in full, split into
  four, or on a subscription — against a credit line they did not apply for. They
  have no account, no sign-up, and no key to bring beyond the wallet their browser
  already holds.
- **Merchants** taking payment. They want to be paid in full on the day of sale
  and to not carry the instalments. They read their own book, which is public
  state under their own address, so they need no key to see it. [inferred]

A third audience reads before either: **builders and evaluators** — hackathon
judges, integrators — who need the mechanism to be legible fast.

## Product Purpose

A payments layer with credit built in. Three ways to pay at checkout; the merchant
is paid the full amount up front in every case, and Polaris carries what is owed.
Success is a completed checkout where the merchant is settled immediately and the
buyer's instalments are collected later without them being online.

## Positioning

Credit that is underwritten from the wallet's own on-chain record — age,
transactions signed, tokens held, balance on hand — with no application and no
bureau. The mechanism a neighbouring product cannot truthfully copy is the
**collection path**: the buyer authorises once at checkout, and each instalment is
drawn later against that authorisation while they are offline, with the protocol
paying the network fee.

## Operating Context

The estate spans five deployed surfaces under `polarispay.app`:

| surface | job |
|---|---|
| `polarispay.app` | the landing page — persuade |
| `dashboard` / `app.polarispay.app` | the buyer's app — operate |
| `merchant` / `merchants.polarispay.app` | the merchant's book — operate |
| `demo-app` / `shopping-web.polarispay.app` | a demo storefront that checks out through Polaris — persuade/operate |
| `docs.polarispay.app` | reference — read |

A buyer's journey crosses surfaces: storefront → checkout → wallet → back. The
demo store exists to make that crossing visible.

## Capabilities and Constraints

- Three payment modes: **Pay in full** (settles immediately), **Pay in 4** (every
  7 days, 10% APR), **Subscribe** (charges every period).
- A credit score on a **300–850** range gates a spending limit. On-time
  instalments are worth **+12**; a late one costs **−40**.
- Worked example the product actually computes: a **$200** purchase split into
  four becomes **4 × 50.38**, repaying **201.53** — principal plus **1.53**
  interest pro-rated over 28 days. The merchant receives **200.00** that day.
- **Chain: Solana, resolved.** An earlier incarnation ran on Sepolia with
  Fhenix FHE, and for a while the landing copy and the deployed apps disagreed
  about which chain the product was on. That is settled: everything is Solana,
  on devnet, against program `CpRqbMywzAEKkEALZtrXqPYM36E5RrFewYnRtUYEEvUS`,
  and the EVM implementation is history rather than a parallel target.
- The merchant API runs against a real MongoDB; bills create and checkout
  completes end to end. [verified live]

## Brand Commitments

- **Name:** Polaris Pay.
- **Mark:** a four-point north star, the product's own tab icon, used as shipped
  and never redrawn or recoloured. Source: `public/star.png`.
- **Typefaces, binding:** **Space Grotesk** for everything a person reads,
  **JetBrains Mono** for anything a machine produced — addresses, signatures,
  program ids, order references. Carried over from the app's own
  `theme/typography.ts`. The user has pinned these for this run.
- **Colour, binding:** near-black ground `#04070F`, surface `#080D16`, ink
  `#F5F9FF`, and a single acid lime `#BFFA62` sampled from the mark itself.
- **Voice:** plain, declarative, unhedged. States mechanism rather than benefit —
  "They both land or neither does" over "seamless and secure". Never uses
  "revolutionary", "seamless", "unlock", or exclamation marks. [inferred from copy]

## Evidence on Hand

Real, and not to be fabricated around:

- Live program id `CpRqbMywzAEKkEALZtrXqPYM36E5RrFewYnRtUYEEvUS` on devnet.
- A real merchant book: **Financed 240.00 · Collected 23.18 · Outstanding 218.57**.
- The instalment ladder with real dates: Sep 4 / 11 / 18 / 25.
- A 41.6s launch film at `public/launch.mp4`, and the mark at `public/star.png`.

There are **no** customer testimonials, no logos of adopters, no usage metrics, no
funding or press. Nothing in that list may be invented to fill a layout.

## Product Principles

1. **State the mechanism, not the benefit.** The interesting thing is how
   collection works, not that it is easy.
2. **Every figure on screen is one the system actually computes.** No illustrative
   numbers, ever.
3. **Credit is earned from record, not from paperwork.** No application, no bureau.
4. **The merchant is never the lender.** They are paid in full, up front, always.
5. **Say what is provisional.** Devnet is named, not hidden.

## Accessibility & Inclusion

- Motion is an enhancement, never a load-bearing layer: content must render fully
  when animation never runs. This is a hard requirement — a prior build shipped a
  page that was blank whenever `requestAnimationFrame` did not fire.
- `prefers-reduced-motion` is honoured by suppressing timelines, not by hiding
  content.
- Money and any animating figure use tabular numerals so digits do not reflow.
- Text on the near-black ground must clear WCAG AA.
