# Polaris

**Spend the stock. Don't sell the stock — on X Layer.**

A shopper holding tokenized equity checks out at a merchant who only takes
stablecoin. Rather than closing the position, the shares are locked, the
merchant is paid immediately from a pool, and the shopper still owns the stock.

Live: **https://polaris-xlayer.vercel.app** · X Layer testnet, chain **1952**

---

## What is actually deployed

| Contract | Address |
|---|---|
| `PolarisEngine` | `0xb649453f78b01F832d97fDD8a12Bf27ac5abf446` |
| `LiquidityPool` | `0x8a9b94F94aa8254e43B5b0e923B4F12FAE6Fc56C` |
| `StockPriceOracle` | `0x926cDFa64B6bF592DD73e71a1d915624f0FaF6FE` |
| `TestnetStock` (tXAAPL) | `0x5B74fdfE5943cC84Fe46f9a783b9AB9a2fD2Bec9` |
| Stand-in stablecoin (pUSDC) | `0x437D8039EaB3b8BbEDc4101Bc97f6812829816D6` |

The unsecured credit line — the earlier Polaris product — is also live on the
same chain: `PolarisLoanEngine` `0x06Ca46f78DB8712b5c698375B0fFf897165e67d2`,
`ScoreManager` `0x8b484257281EF42a9468f9271872Bd76fE399133`,
`MerchantRegistry` `0xeD5D615D2F289835240e3F0cb9Bf15abA317a82e`.

Off-chain: the app on Vercel, a price relayer on Railway, and a MongoDB the
merchant surfaces write to.

### Two stand-ins, named on the page

No real xStock and no USDT0 is deployed on X Layer testnet — `eth_getCode`
returns `0x` for both. The tokenized share and the stablecoin above are
stand-ins with the same decimals and interface, and the running app says so on
the checkout page rather than letting a reviewer assume otherwise.

---

## The product

One checkout, two ways to fund it.

- **Against your shares.** Lock tokenized equity, the merchant is paid from the
  pool, you keep the position. 35% LTV while the venue is open, with a 10%
  haircut on the LTV while it is shut.
- **Against your record.** An unsecured limit priced off repayment history.
  A merchant opens it at the till; you settle it under Activity.

Four routes, because the shopper only ever does four things:
`/` pay · `/activity` what you owe · `/merchant` get paid · `/docs`.

### Three decisions worth reading the code for

**Liquidation sells only what it needs.** The liquidator repays the debt and
takes collateral worth it plus a 5% bonus; the remainder goes back to the
borrower in the same transaction. Losing a whole position over a small
shortfall is the failure this product exists to prevent. Verified on chain: a
3.0-share position liquidated into **1.696154 seized and 1.303846 returned**.

**Two staleness bounds, not one.** Fifteen minutes while the venue is open,
four days while it is shut. When the market closes the newest print is the
closing print and only gets older — a single bound would reject every price all
weekend and silently delete the after-hours path.

**Nothing is seized during an outage.** X Layer is an L2 with one sequencer. If
it stalls you cannot reach the chain to repay while the price moves, so the
engine reads Chainlink's uptime feed and refuses to liquidate during an outage
and for an hour after — but never gates repayment. That feed does not exist on
X Layer testnet, so the guard is inert there and is covered by unit tests.

### Why the price is posted, not read from a feed

Chainlink cannot carry this one. X Layer has 26 push feeds and every one is
crypto; equity prices exist only as Data Streams, a paid subscription whose
on-chain `StreamsLookup` pattern X Layer does not support. So Polaris posts the
print itself **and posts its provenance with it** — the source string and the
venue's own timestamp go on chain, so the number can be checked against the
exchange rather than taken on trust.

`services/price-relayer` runs this on Railway every four minutes. It is a
service rather than a cron because Vercel's Hobby plan schedules once a day,
two orders of magnitude short of a fifteen-minute bound.

---

## Quick start

```bash
pnpm install
pnpm test                 # 356 tests across contracts, db, keeperhub, underwriting, mcp
```

Against the live chain:

```bash
pnpm --filter @polarispay/contracts exec hardhat run scripts/verify-invariants.js --network xlayerTestnet
```

That reads every loan the engine has ever written and checks conservation on
liquidation, pool accounting, orphaned collateral and the LTV ceiling — against
the deployed contracts, not a fixture.

Run the app:

```bash
pnpm --filter polaris-app dev
```

---

## Tests

| Suite | Count |
|---|---|
| `packages/contracts` — the engine, oracle, pool, liquidation, sequencer guard, hardening | 201 |
| `packages/db` | 82 |
| `packages/keeperhub` | 45 |
| `packages/underwriting` | 20 |
| `packages/mcp` | 8 |

Five adversarial reviewers went at the contracts across accounting, decimals,
access control, oracle manipulation and liveness, and every claim was handed to
a separate agent whose job was to refute it. 24 attacks were claimed, 2
survived, both are fixed.

`TEST-PLAN.md` is the product-level plan: 67 items covering every page, every
API route, every flow, the on-chain invariants and the external dependencies,
each with what "correct" means written down before it was run.

---

## Layout

| Path | What it is |
|---|---|
| `apps/core/` | The product. Checkout, activity, merchant, docs — this is what is deployed |
| `packages/contracts/` | The Solidity engine, oracle and pool, and their tests |
| `services/price-relayer/` | The always-on price relayer, deployed to Railway |
| `packages/db/` | Loan book and merchant records |
| `packages/keeperhub/`, `packages/underwriting/`, `packages/mcp/` | Settlement, credit scoring, agent tooling |
| `merchant-web/`, `shopping/`, `landing/` | Merchant platform, storefront, marketing site |
| `mobile/`, `merchant-app/` | Expo apps; the merchant terminal drives an iMin thermal printer |

### Code from earlier ports, kept deliberately

This repository carries two earlier incarnations of Polaris. They are **not**
part of the X Layer submission and nothing above depends on them:

- **Solana** — `programs/`, `keeper-solana/`, `packages/sdk-solana/`,
  `apps/gateway/`, `Anchor.toml`, `Cargo.toml`. Its README is
  `docs/SOLANA-README.md`. Building or testing these needs a Rust and Anchor
  toolchain; `pnpm test` does not touch them.
- **Sepolia with Fhenix FHE** — gone from the code. Where the old chain is
  named it is named as history.

---

## What is not done

- **Mainnet.** Everything above is X Layer testnet. Nothing here has moved real
  money.
- **Real tokenized equity.** No xStock exists on X Layer; the collateral token
  is a stand-in, labelled as one in the running app.
- **The sequencer guard is untested in production**, because X Layer testnet
  has no uptime feed to read.
- **The credit line cannot be drawn from a browser.** `createLoan` takes the
  borrower as an argument and is called by the merchant, so the app shows the
  limit as a real on-chain profile rather than giving it a checkout button that
  would not work.

## License

MIT.
