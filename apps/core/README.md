# Polaris — the app

This is the product: **https://polaris-xlayer.vercel.app**, on X Layer testnet
(chain **1952**).

One checkout, two ways to fund it. Pay a merchant in stablecoin against
tokenized equity you keep — the shares lock, the merchant is paid now from a
pre-funded pool, and you still own the position. Or draw on an unsecured limit
priced off your repayment record, which a merchant opens at the till.

Four routes, because a shopper only ever does four things:

| Route | What it is |
|---|---|
| `/` | Pay. Capacity from both funding sources, then the checkout |
| `/activity` | Everything outstanding, and where you settle it |
| `/merchant` | Get paid. The QR a customer scans |
| `/docs` | Integration, plus the merchant directory, faucet and the book |

`/merchants`, `/faucet` and `/stock/book` are reachable from Docs rather than
the nav. Everything the products used to occupy — `/credit`, `/plans`,
`/limits`, `/stock/positions`, `/stock/merchant` — is a permanent 308 redirect,
so already-printed merchant codes and old bookmarks still land somewhere real.

## Contracts it talks to

Deployed on X Layer testnet and **verified** — the source is readable at
`repo.sourcify.dev/1952/<address>`:

| Contract | Address |
|---|---|
| `PolarisEngine` | `0xb649453f78b01F832d97fDD8a12Bf27ac5abf446` |
| `LiquidityPool` | `0x8a9b94F94aa8254e43B5b0e923B4F12FAE6Fc56C` |
| `StockPriceOracle` | `0x926cDFa64B6bF592DD73e71a1d915624f0FaF6FE` |
| `TestnetStock` (tXAAPL) | `0x5B74fdfE5943cC84Fe46f9a783b9AB9a2fD2Bec9` |
| Stand-in stablecoin (pUSDC) | `0x437D8039EaB3b8BbEDc4101Bc97f6812829816D6` |

Addresses come from `lib/polaris-deployment.json`, copied from the deployment
record rather than typed out here twice.

**Two stand-ins, named on the page.** No real xStock and no USDT0 is deployed
on X Layer testnet — `eth_getCode` returns `0x` for both — so the tokenized
share and the stablecoin above are stand-ins with the same decimals and
interface. The checkout says so rather than letting a reviewer assume otherwise.

## Running it

```bash
pnpm --filter polaris-app dev
```

Everything a user does is signed by their own wallet. The one server-side
signer left is the price relayer, which is an operator role behind
`RELAYER_KEY`, not a user action.

## Tests

```bash
pnpm --filter polaris-app e2e     # Playwright, against the deployed app
pnpm --filter polaris-app demo    # re-record the demo video
node ../../scripts/smoke.mjs      # API contract, redirects, every page
```

The e2e suite drives the real product with a wallet that really signs, so it
costs testnet gas and needs the chain up — which is why it is not part of
`pnpm test`. It needs `E2E_PRIVATE_KEY` (a funded testnet wallet with tXAAPL)
and skips rather than fails without one.

## What is not done

- **Mainnet.** This is testnet. Nothing here has moved real money.
- **The credit line cannot be drawn from a browser.** `createLoan` takes the
  borrower as an argument and is called by the merchant, so the app shows the
  limit as a real on-chain profile rather than a button that would not work.
- **The sequencer guard is untested in production**, because X Layer testnet
  carries no uptime feed. It is covered by unit tests instead.
