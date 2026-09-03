# Polaris — test plan

Written **before** testing. Every item states what "correct" means as a
specific observable result. An item passes only when the real product produces
exactly that, with a clean console and no failed network request.

**Surfaces**
- Polaris — https://polaris-xlayer.vercel.app (`apps/core`)
- Syndicate Equip, the storefront — `shopping`, run locally on :3400
- X Layer testnet, chain **1952**

| Contract | Address |
|---|---|
| PolarisEngine | `0xb649453f78b01F832d97fDD8a12Bf27ac5abf446` |
| LiquidityPool | `0x8a9b94F94aa8254e43B5b0e923B4F12FAE6Fc56C` |
| StockPriceOracle | `0x926cDFa64B6bF592DD73e71a1d915624f0FaF6FE` |
| TestnetStock (tXAAPL) | `0x5B74fdfE5943cC84Fe46f9a783b9AB9a2fD2Bec9` |
| Stand-in stablecoin (pUSDC) | `0x437D8039EaB3b8BbEDc4101Bc97f6812829816D6` |

**Test wallet** `0x0abcc45E20e1992502a1A9D1Fb2224295304eCe7`, injected as an
EIP-1193 provider so the app's own buttons are driven by something that really
signs.

**Known untestable up front** — recorded now so nothing is quietly marked PASS
later: mainnet behaviour (spends real money), real xStock and real USDT0
(neither is deployed on X Layer testnet), and the Chainlink sequencer uptime
guard (no feed exists on testnet; covered by unit tests instead).

---

## A · Polaris pages (10)

| # | Item | Correct means |
|---|---|---|
| A1 | `/` unconnected | ConnectGate copy, **plus** the pitch: "Spend the stock", four numbered steps, three design cards, and a working X Layer faucet link. No balances shown. |
| A2 | `/` connected | Two funding cards. "Against your shares" shows capacity = shares × price × effective LTV. "Against your record" shows score and limit. |
| A3 | `/` quote | 2 shares quotes: collateral value, ceiling, fee, merchant receives — and **ceiling − fee == merchant receives** to the cent. |
| A4 | `/` badge honesty | Card reads READY only when capacity > 0; otherwise NO SHARES YET. |
| A5 | `/activity` unconnected | Gate: "Connect to see what you owe". No positions. |
| A6 | `/activity` connected | Table of loans with id, shares, owed, health, due, status. Repay offered only on Active. |
| A7 | `/merchant` | Gate, then a QR encoding `/?merchant=…&ref=…&shares=…`. |
| A8 | `/docs` | Every contract address listed **has code on chain 1952**. |
| A9 | `/stock/book` | Four tiles + the print panel. Price controls disabled without the operator key. |
| A10 | `/merchants`, `/faucet` | 200, no console error, no page claims Sepolia or Ethereum. |

## B · Polaris API (22)

| # | Item | Correct means |
|---|---|---|
| B1 | `GET /api/stock/state?address=` | 200, `viewer.address` equals the address asked about. |
| B2 | `GET /api/stock/state` no address | 200, `viewer.address` absent — impersonates nobody. |
| B3 | `?address=garbage` | 400 with a sentence, not a stack. |
| B4 | `GET /api/stock/health` | 200 or 503, `checks` carries rpc, price and liquidity **separately**. |
| B5 | `POST /api/stock/quote` valid | 200 and `maxBorrow + feeOnMax <= collateralValue × ltvBps / 10000`. |
| B6 | quote `shares` = 0, −1, abc, 1e30 | 400 each. |
| B7 | quote `tenorDays` = 3 | 400 — outside the 7–14 bound. |
| B8 | quote malformed JSON | 400, not 500. |
| B9 | `POST /api/stock/price` no key | 401. |
| B10 | `POST /api/stock/price` wrong key | 401. |
| B11 | price `mode=move`, pct=−200 | 400. |
| B12 | Deleted routes `/checkout`, `/repay`, `/faucet` | 404 — no server-signed write path survives. |
| B13 | `GET /api/global-stats` | 200, `chainId` == 1952. |
| B14 | `GET /api/merchants` | 200, a list. |
| B15 | `GET /api/keeper/recent` | 200, `actions` is a list. |
| B16 | `GET /api/limits?address=` | 200 with `creditScore`. |
| B17 | `GET /api/limits` no address | 400. |
| B18 | `GET /api/credit/me?address=` | 200. |
| B19 | **CORS on reads** | `state`, `health` answer with `access-control-allow-origin: *` for a foreign Origin. |
| B20 | **CORS preflight on quote** | `OPTIONS` returns 204 with the header. |
| B21 | **CORS absent on the operator route** | `POST /api/stock/price` from a foreign origin returns 401 with **no** allow-origin header. |
| B22 | Redirects | `/credit`, `/plans`, `/limits`, `/stock/positions`, `/stock/merchant`, `/stock` all **308** to the merged paths. |

## C · Storefront pages (6)

| # | Item | Correct means |
|---|---|---|
| C1 | `/` | Three products with prices. Console clean. |
| C2 | `/` ticker | `tXAAPL $<price>` in the header, matching `/api/stock/state` to the cent, with the venue dot. |
| C3 | `/product/[id]` | The named product, its price, add-to-cart. |
| C4 | `/cart` | Line items and a total equal to the sum of price × quantity. |
| C5 | `/checkout` empty cart | "Cart_Empty" with a way back — not a blank page or a zero-dollar checkout. |
| C6 | `/orders` unconnected | Prompt to connect. No positions leaked. |

## D · Storefront flows (12)

| # | Item | Correct means |
|---|---|---|
| D1 | Add to cart | Item appears in `/cart`, total correct. |
| D2 | Checkout prices the basket | Shares to lock computed from the live mark; `merchantReceives >= basket total`. |
| D3 | Fee split | Origination + interest shown, summing **exactly** to the fee line. |
| D4 | Insufficient shares | Named in goods: needs X, holds Y, Z short — with a funding button. |
| D5 | Faucet from checkout | Signs, balance rises, quote becomes affordable. |
| D6 | **Pay with stock** | Real signed tx. On chain: shares move shopper → engine, and stablecoin moves pool → merchant **equal to the basket total**. |
| D7 | Confirmation | Merchant paid, shares locked, tx link, settle link. Cart cleared **only after** confirmation. |
| D8 | Double-tap Pay | Idempotent — the order ref is derived from the basket, so a second tap does not open a second loan. |
| D9 | `/orders` after buying | The new order appears with shares, owed, worth-now and since-checkout. |
| D10 | Liquidation preview | "Safe until $X, Y% below today" where X == owed × 10000 / thresholdBps spread over the shares. |
| D11 | **Settle** | Real signed tx. On chain: stablecoin shopper → pool, and **exactly the locked shares** return engine → shopper. |
| D12 | Settle with insufficient stablecoin | Refused with both numbers named, before any signing. |

## E · On-chain invariants (5)

| # | Item | Correct means |
|---|---|---|
| E1 | Pool accounting | `pool.outstanding == Σ principal of Active`. |
| E2 | No orphan collateral | engine share balance `== Σ shares of Active`. |
| E3 | LTV honoured | every active loan within its opening ceiling. |
| E4 | Conservation on liquidation | seized + returned == locked, for every liquidated loan. |
| E5 | Contracts verified | all five `exact_match` on Sourcify for chain 1952. |

## F · External dependencies (4)

| # | Item | Correct means |
|---|---|---|
| F1 | Price relayer | Railway service posting within the last ~5 minutes; `health.price.ok` true. |
| F2 | Venue feed | The posted source names a real venue and the price matches the oracle. |
| F3 | X Layer RPC | Answers `eth_chainId` = 1952. |
| F4 | Sourcify | Serves the engine's verified source. |

## G · Repo and hygiene (6)

| # | Item | Correct means |
|---|---|---|
| G1 | `pnpm test` | All suites pass, zero failures. |
| G2 | `pnpm typecheck` / `pnpm build` | exit 0. |
| G3 | Storefront typecheck + build | exit 0. |
| G4 | Storefront unit tests | pricing suite passes. |
| G5 | No mocks in shipped surfaces | every `mock|stub|fake` hit is a CSS class, an input placeholder, a `testing/` double, or a comment recording removal. |
| G6 | Public repo matches | `main` carries the storefront checkout and the pricing library. |

---

**Total: 65 items.**

---

## Results — 65/65 PASS

| Block | Result |
|---|---|
| A · Polaris pages | **10/10** |
| B · Polaris API | **22/22** |
| C · Storefront pages | **6/6** |
| D · Storefront flows | **12/12** |
| E · On-chain invariants | **5/5** |
| F · External dependencies | **4/4** |
| G · Repo and hygiene | **6/6** |

### Failures found, and what fixed them

| Item | Failure | Root cause and fix |
|---|---|---|
| D7 | **A purchase succeeded on chain and the shopper was shown an empty cart.** 0.118673 tXAAPL locked and $12.000000 paid to the merchant, with no receipt anywhere on screen. | `pay()` was re-entrant. Three clicks land before React re-renders the button as disabled, so several calls entered: the first opened the loan, a later one reverted on the engine's idempotency check and its error state overwrote the success. Fixed with a ref-based lock that flips synchronously, so the second call is refused in the same tick regardless of render timing. Re-tested: 3 clicks → exactly 1 transaction, receipt intact. |
| D8 | Buying the same basket twice was refused for ever — "you have already paid this order reference". | The order ref was derived from basket contents alone, so a second genuine purchase of the same item collided with the first. Now carries a checkout-session id generated once per visit: a double-tap still collapses to one loan, a fresh checkout is a new order. |
| A3 | The quote column did not add up: $204.72 − $2.49 displayed as $202.24. | Each figure was rounded to the cent independently, so the displayed values disagreed by a penny even though the exact ones reconcile. On a page whose whole job is to be checkable, that reads as an arithmetic error. The ceiling is now summed from the values as displayed. Verified across 2, 7 and 13 shares. |
| C1 | Hydration mismatch logged on every storefront page. | wagmi reconnects from storage after hydration, so the server rendered the disconnected header and the client the connected one. Wallet-dependent UI is held back until mount. |
| E4 | Reported "no liquidations yet on this deployment" while four sat in state. | The invariant script walked back a fixed 5000 blocks — about three hours on X Layer — so any liquidation older than that silently left the check. It now reads how many liquidations the loan book contains and pages until it has found them all. Found and verified loans 2, 5, 15 and 16, two of which had never been checked. |

### Confirmations

- **Zero mocks and zero stubs** in any tested surface. Every `mock|stub|fake`
  hit across `apps/core`, `shopping`, `services` and `packages/contracts` is a
  CSS class, an input placeholder, `SequencerFeedStub.sol` under `testing/`, or
  a comment recording that fakery was removed.
- **Zero console errors and zero failed network requests** across all sixteen
  pages, checked on freshly-opened tabs.
- Every on-chain claim was verified against the chain, not the UI: the
  storefront purchase moved **12.000000 pUSDC** to the merchant for a $12.00
  basket, and settling returned **the same 0.118673 tXAAPL** that was locked.

### Untested, and why

- **Mainnet behaviour** — spends real money.
- **Real xStock and real USDT0** — neither is deployed on X Layer testnet;
  `eth_getCode` returns `0x`. The stand-ins are labelled as such in the app.
- **The Chainlink sequencer uptime guard** — no feed exists on testnet, so the
  guard is inert there. Covered by unit tests instead.

### A note on the testing itself

Four items — A1, C2, C3 and D3 — initially read as failures and were not. In
each case the assertion was wrong rather than the product: matching prose that
happened to contain "You hold", grabbing a product price instead of the ticker,
expecting a button label the shop words differently, and reading a note instead
of a value. They are recorded here because a test that cries wolf costs as much
trust as one that misses a bug.
