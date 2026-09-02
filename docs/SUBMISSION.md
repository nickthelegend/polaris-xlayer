# Polaris — submission

**Spend the stock. Don't sell the stock.**
Collateralized checkout on X Layer.

**Live:** https://polaris-xlayer.vercel.app
**Code:** https://github.com/nickthelegend/polaris-xlayer
**Chain:** X Layer testnet, 1952

---

## One sentence

People already hold tokenized stock; merchants only take stablecoin. Polaris
lets a shopper pay the merchant **without selling the shares** — a short loan
backed by the stock, with the merchant paid immediately from a pre-funded pool.

## The problem

Tokenized equity on X Layer is a portfolio, not a payment method. Today a holder
has two bad options: sell and lose the position, or keep it and not check out.
Swap-to-pay is not a third option — it is the first one with extra steps.

## How it works

1. Scan the merchant's code.
2. Choose to pay with stock credit. Your shares lock in the engine.
3. The merchant is paid stablecoin **now**, from a pool that already held it.
4. You keep the position and its upside.
5. Repay inside 7–14 days and the shares unlock.
6. Miss it, and only what the debt needs is sold — the rest comes straight back.

## What is deployed

| | |
|---|---|
| PolarisEngine | `0xb649453f78b01F832d97fDD8a12Bf27ac5abf446` |
| LiquidityPool | `0x8a9b94F94aa8254e43B5b0e923B4F12FAE6Fc56C` |
| StockPriceOracle | `0xfc9Faf97234F2Dc45BAb93c187F393B149056e58` |
| PolarisLoanEngine (BNPL) | `0x06Ca46f78DB8712b5c698375B0fFf897165e67d2` |

## Three decisions that are the actual work

**Liquidation sells only what it needs.** A liquidator repays the debt and takes
collateral worth it plus a bonus; the remainder returns to the borrower in the
same transaction. Losing a whole position over a small shortfall is the failure
this product exists to prevent, so it is prevented in code, not promised in
copy. Verified against the live chain: `seized + returned == locked`, exactly.

**Two staleness bounds, not one.** Fifteen minutes while the venue is open, four
days while it is shut. When the market closes, the newest print *is* the closing
print and only gets older — a single tight bound would reject every price all
weekend and silently delete the after-hours path the product charges a haircut
for. Liquidation, separately, demands a *live* print: a position falling due over
a weekend waits for the open, because the collateral cannot actually be sold
while the venue is shut.

**Nothing is seized during a sequencer outage.** X Layer is an OP Stack L2 with
one sequencer. If it stalls, a borrower cannot reach the chain to repay while
the price moves, and every drifted position would be liquidatable the moment it
resumes. The engine reads Chainlink's L2 uptime feed and refuses to liquidate
during an outage and for an hour after — but never gates repayment, because
someone who can reach the chain should always be able to get out.

## X Layer integration

Not a deploy-and-claim. The chain id in OKX's own docs is **wrong** — they
publish 195; the live RPC answers **1952**, and 195 is deprecated with an empty
RPC list. Everything here was read off the chain:

- X Layer migrated from Polygon CDK to the **OP Stack** in Dec 2025, with ZK
  validity proofs. Confirmed via the OP predeploys and `optimism_syncStatus`.
- USDT0 on mainnet is `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, and its
  symbol is **`USD₮0` with U+20AE** — string-matching "USDT0" never finds it.
- Chainlink is on X Layer, but **all 26 push feeds are crypto**; there is no
  equity feed, and Data Streams is paid with no `StreamsLookup` support here.
- The OP standard bridge on X Layer is **disabled** — every deposit path reverts
  `not allow bridge`.
- The RPC caps log queries at 100 blocks and serves pre-transaction state right
  after a receipt. Both are handled.

## How it holds up

Five adversarial reviewers went at the contracts across accounting, decimals,
access control, oracle manipulation and liveness, and every claim was handed to
a separate reviewer whose job was to refute it. **24 attacks claimed, 2
survived** — both fixed:

- an attacker could permanently burn a merchant's order reference for a fraction
  of a cent, killing every checkout at it. Now keyed on the borrower too.
- a borrower blocked by the share issuer could freeze their own position
  forever, because both exits pushed shares back to them. Delivery is now
  credited to `claimable` if the token refuses the recipient, so settlement
  always completes.

48 contract tests. 23/23 end-to-end checks against the live production
deployment, with every write signed by a real wallet.

## What is real, and what is standing in

Real: the contracts, every transaction, the price (a live NasdaqGS print relayed
on chain with its source and timestamp), the merchant payment, the liquidation,
and a MongoDB loan book synced from chain.

Standing in: the share token and the stablecoin. **xStocks and USDT0 are not
issued on X Layer testnet** — verified with `eth_getCode`. The stand-ins are
named so they cannot be mistaken (`tXAAPL`, "Testnet Apple (NOT A SECURITY)")
and every deployment record lists them under `standIns`.

Not built: the oracle relayer is trusted, and said so rather than dressed up.
There is no public OKX Pay merchant API, so the QR is our own checkout link.

## Risks, said out loud

Tokenized equity is price exposure — no dividend, no vote. Max LTV 35%, with a
further haircut after hours and at weekends. 14-day tenor only. The merchant is
paid from a pre-funded warehouse, never from a future sale. Geo-gated; not for
US or EU users.

This is a collateralized checkout rail. It is not a bank.
