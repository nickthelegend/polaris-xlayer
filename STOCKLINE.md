# Stockline — spend the stock, don't sell the stock

**X Layer · tokenized stocks / RWA · collateralized checkout**

People already hold tokenized equity. Merchants still only take stablecoin.
Stockline lets a shopper pay the merchant **without selling the shares**: a
short loan backed by the stock.

```
scan merchant QR  →  pay with stock credit  →  shares lock in the engine
                  →  merchant is paid USDT0 now, from a pre-funded pool
                  →  shopper keeps the upside
                  →  repay in 7-14 days, shares unlock
                  →  miss it, and only what is needed is sold; the rest comes back
```

## Why this is not a swap

| | Swap | Stockline |
|---|---|---|
| Keep the shares | no | **yes** |
| Merchant cash | instant | instant |
| Repeat use | none | an open line |
| What we own | a router | the risk book and the merchant rail |

Swap-to-pay closes the trade. That is the thing the holder is refusing to do.

## Contracts

`packages/contracts/contracts/stockline/`

| Contract | What it is responsible for |
|---|---|
| `StocklineEngine` | quote, open, repay, liquidate; custodies collateral per loan |
| `LiquidityPool` | the USDT0 warehouse the merchant is paid out of |
| `StockPriceOracle` | the print, its timestamp, and whether the venue was open |
| `TestnetStock` | a clearly-labelled stand-in for a share, testnet only |

### The three decisions that shape it

**The merchant is never at risk.** They are paid in full, on the spot, out of
stablecoin the pool already held — never from the proceeds of a future
liquidation. `openLoan` takes collateral in before it pays money out.

**Liquidation sells only what is needed.** A liquidator repays the debt and
receives collateral worth the debt plus a bonus; the remainder returns to the
borrower in the same transaction. Losing a whole position over a small
shortfall is the failure this product exists to prevent, so it is prevented in
code rather than promised in copy. If the position is genuinely underwater the
liquidator takes all the collateral and the pool wears the shortfall — the
borrower is never chased for the difference.

**A stale price is not a price.** The oracle stores the timestamp of the
*print*, not of the block it was posted in, and reverts past `maxAge`. A lender
quietly using yesterday's close is how a book blows up on a gap open.

### Risk parameters

| | |
|---|---|
| Max LTV | 35% |
| Extra haircut when the venue is shut | 10% (so 31.5%) |
| Liquidation threshold | 50% |
| Liquidator bonus | 5% |
| Tenor | 7–14 days, nothing else |
| Origination | 1.0% |
| Interest | 12% APR on the float, charged for the tenor at open |

The threshold must sit above the ceiling or a loan would be liquidatable the
instant it opened; `setRiskParams` rejects any combination that would.

## What is real and what is standing in

X Layer is real: chain id **196** mainnet, **1952** testnet — confirmed by
`eth_chainId` against the live RPCs, not read off a docs page. The old X1
testnet on 195 is gone.

Tokenized equities are **not** issued on X Layer testnet, and USDT0 is not
deployed there either. So on testnet Stockline deploys a stand-in for each,
named so nobody can mistake them on an explorer (`tXAAPL`, "Testnet Apple
(NOT A SECURITY)"). Every contract above the token layer is the same code that
meets the real assets; swapping them in is a change of address in the
deployment and nothing else. Each deployment record lists its stand-ins
explicitly under `standIns` rather than glossing over them.

## The oracle, and why it is not Chainlink

Chainlink **is** on X Layer — Data Streams on both networks, and 26 push feeds
on mainnet. None of them is an equity. All 26 are crypto pairs. Equity prices
exist on Chainlink only as Data Streams, which is a paid subscription, and
whose on-chain `StreamsLookup` pattern X Layer does not support.

So `StockPriceOracle` carries a relayed print and records its provenance: the
venue's own timestamp, whether the venue was open, and a `source` string, all
on chain and all on the receipt. The relayer is trusted, and that is stated
rather than dressed up — but the number it publishes can be checked against
the exchange by anyone.

The scale is 1e8, the same as a Chainlink aggregator, so a real feed can drop
in behind this interface the day one exists.

### Two staleness bounds, not one

While the venue is open a price older than 15 minutes is rejected. While it is
shut, the bound is four days.

This is not laziness. When the market closes, the most recent print *is* the
closing print, and it only gets older until the venue reopens. A single
15-minute bound would reject every price all weekend, and the product's own
after-hours path — which exists and is priced for with a haircut — would
quietly stop working. The live AAPL print at the time of writing was 17 hours
old; under one bound, no Saturday checkout would have been possible at all.

## Running it

```bash
cd packages/contracts
npm install
npx hardhat test test/stockline.test.js              # 25 tests
npx hardhat run scripts/deploy-stockline.js --network xlayerTestnet
npx hardhat run scripts/relayer.js  --network xlayerTestnet   # carries the print
npx hardhat run scripts/keeper.js   --network xlayerTestnet   # clears bad positions
npx hardhat run scripts/e2e-stockline.js --network xlayerTestnet
```

`e2e-stockline.js` is the demo: it opens against the **live** venue print,
pays a merchant, repays and unlocks, then opens a second position and moves
the price through the threshold to show liquidation returning the remainder.
On a local chain it runs in full:

```
AAPL  $325.13  market CLOSED  source: NasdaqGS close
  10 shares are worth   $3251.30
  ceiling at 31.5% LTV  $1024.16      <- the after-hours haircut, applied
  merchant received     $512.08       (immediately, from the pool)
  health factor         3.14
  ... repay ...
  shopper holds         10.0000 shares — all of them
  pool earned           $6.30
  ... second position at the full ceiling, then price -45% ...
  price now $178.82  health 0.86  liquidatable: true
  shopper got back      3.9124 shares — only what was needed was sold
  seized + returned     10.0000 of 10.0000 locked
```

To deploy against real assets instead of stand-ins:

```bash
STOCK_TOKEN=0x... STABLE_TOKEN=0x... npx hardhat run scripts/deploy-stockline.js --network xlayer
```

## Risks, said out loud

Tokenized equity is price exposure — no dividend, no vote. Max LTV 35% with a
further haircut after hours and at weekends. 14-day tenor only. The merchant is
paid from a pre-funded warehouse, not from a future sale. Geo-gated; not for US
or EU users. The oracle relayer is trusted to publish honestly, and that is
stated rather than dressed up — `source` is recorded on chain and shown on the
receipt so the number can be checked against the venue.

This is a collateralized checkout rail. It is not a bank.
