# Stockline on X Layer — test plan

Written **before** testing. Every item states what "correct" means as a
specific observable result. An item passes only when the real product produces
exactly that, with a clean console and no failed network requests.

Surface under test: `stockline-web` (Next.js, port 3200) against the live
deployment on **X Layer testnet, chain 1952**:

| | |
|---|---|
| engine | `0x81fABc31c455F88d6FAA733Dd695bebFE2083C7D` |
| pool | `0xAd4992d13682C31c374719A0a4520636cb5deD4d` |
| oracle | `0x51B91e1733e53F39E528C32823fe97FD3A96bf75` |
| stock (stand-in) | `0x957a46693F66B4676FF08DAF25323eb9124Eb278` |
| stable (stand-in) | `0x35cbD9F7432065309DF6FAEF0e4313e2093F1958` |
| shopper | `0xf2B99773b24c8593E071FDD4a7dFB1F925a209d0` |
| merchant | `0x095Ba9281e2ee960d0a553858AB76FaA830BEbbF` |
| liquidator | `0xc6f7274E64A7B520063ed06855ACa4A42f72fCF8` |

---

## A · Pages

| # | Item | Correct means |
|---|---|---|
| A1 | `/` loads | Heading "Spend the stock. Don't sell the stock." renders; four tiles show price, shares held, pool available, max LTV; no console error; `/api/state` returns 200 |
| A2 | `/` price tile | Shows a dollar figure equal to the oracle's `peek` value ÷ 1e8, with the venue state ("market open"/"market closed") and the source string from chain — not a placeholder |
| A3 | `/` LTV tile | Shows 35% when the venue is open, 31.5% when shut. Must match the contract's `effectiveLtvBps` for that state |
| A4 | `/` stand-in notice | Names the stablecoin and tokenized-share stand-ins explicitly. Absent = fail (it would be hiding what is not real) |
| A5 | `/positions` empty state | With no loans for the shopper, shows "Nothing locked yet" and a link to checkout — not an empty table, not a spinner |
| A6 | `/positions` populated | One row per loan from `loansOf`, with id, shares, owed, health factor, due date, status pill |
| A7 | `/admin` loads | Four tiles (available, out on loan, earned, shares held) and a print panel with price, source, venue, age, usable |
| A8 | Nav | Three links; each navigates without a full-page error; the network chip reads "X Layer testnet · 1952" |

## B · API

| # | Item | Correct means |
|---|---|---|
| B1 | `GET /api/state` | 200 with `blockNumber` matching the live chain within a few blocks, real balances, and `loans[]` matching `loansOf(shopper)` |
| B2 | `POST /api/quote` valid | 200; `collateralValue` = shares × price; `maxBorrow + feeOnMax ≤ collateralValue × ltvBps / 10000`; `ltvBps` = 3500 open / 3150 closed |
| B3 | `POST /api/quote` zero shares | 400 with "Enter a number of shares greater than zero." — not a 500, not a revert leaking through |
| B4 | `POST /api/quote` non-numeric | 400 with the same message |
| B5 | `POST /api/quote` bad tenor (3 days) | 400 naming the 7–14 day bound |
| B6 | `POST /api/checkout` valid | 200; a real tx hash on X Layer; `loanId` returned; loan exists on chain with status Active |
| B7 | `POST /api/checkout` duplicate ref | 409 "already been paid", and **no second loan is created** |
| B8 | `POST /api/checkout` more shares than held | 400 naming the actual holding — not an on-chain revert |
| B9 | `POST /api/checkout` empty ref | 400 "An order reference is required." |
| B10 | `POST /api/repay` valid | 200; loan status becomes Repaid; shares return to the shopper |
| B11 | `POST /api/repay` already closed | 409 "already closed" |
| B12 | `POST /api/repay` liquidate a healthy loan | 409 "healthy — it cannot be liquidated" |
| B13 | `POST /api/price` relay | 200; posts the live venue print; `source` names the exchange |
| B14 | `POST /api/price` move −45% | 200; price drops to 55% of previous; source labelled "(demo move −45%)" |
| B15 | `POST /api/price` move −200% | 400 "above -100" |
| B16 | `POST /api/faucet` | 200; shopper's share balance increases by the minted amount |
| B17 | `POST /api/faucet` 500 shares | 400 "between 0 and 100" |

## C · Flows, end to end in the browser

| # | Item | Correct means |
|---|---|---|
| C1 | Quote → pay | Quote renders collateral value, ceiling, fee, merchant payout. Pressing pay produces a success panel naming the loan id and linking a real explorer URL |
| C2 | Merchant is paid | Merchant's stablecoin balance rises by exactly `maxBorrow` across the checkout |
| C3 | Shares lock | Engine's share balance rises by exactly the shares locked; shopper's falls by the same |
| C4 | Position appears | The new loan appears on `/positions` with status Active and a health factor > 1 |
| C5 | Repay | Repay returns exactly the locked shares; status becomes Repaid; pool `outstanding` falls by the principal |
| C6 | Refund | Merchant refund closes the loan as Refunded and returns the shares; merchant's balance falls by principal + fee |
| C7 | Crash → liquidate | After −45%, health drops below 1.00 and the row offers Liquidate; liquidating seizes part and returns the remainder; seized + returned = locked |
| C8 | Recovery | Relaying the live print after a demo move restores a real price and the source stops saying "demo move" |
| C9 | Idempotent retry | Paying twice with the same reference produces one loan and a clear message the second time |

## D · On-chain invariants (verified by reading the chain after each flow)

| # | Item | Correct means |
|---|---|---|
| D1 | Value conservation on liquidation | `sharesSeized + sharesReturned == loan.shares`, exactly |
| D2 | Pool accounting | `pool.outstanding` equals the sum of `principal` over Active loans |
| D3 | No orphan collateral | Engine's share balance equals the sum of `shares` over Active loans |
| D4 | LTV honoured | For every Active loan, `principal + fee ≤ collateralValue × ltv` at the opening price |
| D5 | Merchant never at risk | Merchant's balance never decreases as a result of another party's default |

## E · External dependencies

| # | Item | Correct means |
|---|---|---|
| E1 | X Layer RPC | `eth_chainId` = 1952; reads and writes succeed; read-after-write is consistent once settled |
| E2 | Yahoo Finance | Returns a live AAPL print with `regularMarketPrice`, `regularMarketTime`, and a trading period; the relay posts it on chain |
| E3 | Explorer links | Each returned `explorer` URL resolves to the real transaction on oklink |

## F · Edge cases and interruptions

| # | Item | Correct means |
|---|---|---|
| F1 | Stale price | With a print older than its bound, quote returns 409 explaining the price is stale — the UI must not offer a checkout it cannot honour |
| F2 | Empty pool | If pool liquidity is below the borrow, checkout fails with a clear message rather than a raw revert |
| F3 | Reload mid-flow | Reloading after a quote but before paying loses the quote and shows no phantom position |
| F4 | Double-submit | Buttons disable while a transaction is in flight; a second click cannot open a second loan |
| F5 | Console cleanliness | Every page and every action produces zero console errors and zero failed network requests |

---

**Untestable without something I do not have** — recorded here up front so it is
never quietly marked PASS:

- Mainnet deployment (spends real money — out of scope by instruction)
- Real xStocks / real USDT0 (not issued on X Layer testnet; stand-ins are used and labelled)
- Chainlink L2 sequencer uptime feed (does not exist on X Layer testnet; the guard is off there and is covered by unit tests instead)
- OKX Pay merchant QR (no public developer API exists)
