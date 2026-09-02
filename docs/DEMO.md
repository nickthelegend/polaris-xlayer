# The 3-minute demo

Every step is signed by a real wallet against X Layer testnet (chain 1952).
Nothing on this page is simulated, and there is no server key behind any of it.

**Before you start**
- A browser wallet on X Layer testnet. The app offers to add the network if the
  wallet has never seen it.
- A little OKB for gas: https://web3.okx.com/xlayer/faucet/xlayerfaucet
- Check `https://polaris-xlayer.vercel.app/api/stock/health` — it reports the
  RPC, the price age and the pool's liquidity separately, so a red light on
  stage points at the cause.

---

**0:00 — the problem, in one line.**
Open `polaris-xlayer.vercel.app`. Do not connect yet.

> "People already hold tokenized stock. Merchants take stablecoin. Today your
> only option is to sell — which closes a position you wanted to keep."

The page is honest before you connect: it shows no balance, because it does not
know who you are. Nothing is signed on anybody's behalf.

**0:20 — connect.**
Connect the wallet. The tiles fill in: the live NasdaqGS print for tXAAPL, your
share balance, the pool's available stablecoin, and the LTV in force. If the
venue is shut the LTV drops from 35% to 31.5% on its own — say that out loud,
it is the after-hours haircut doing its job.

**0:40 — the merchant's side.**
Open **Take a payment**. Enter an amount and a reference, and a QR appears. It
carries the checkout, not a payment: merchant address, order reference, share
count. Point out that the price is still quoted at scan time, so a code left on
a counter cannot lock in yesterday's number.

**1:00 — scan and pay.**
Scan it, or open the link. The checkout is pre-filled. Press **Get a quote**:
collateral value, the ceiling at the current LTV, the fee, and what the merchant
receives. Press pay, and **the wallet asks you to sign** — approve, then the
loan.

**1:30 — what just happened.**
The merchant has stablecoin. You still own the shares; they are locked, not
sold. Open **Positions**: the loan, what is owed, the health factor, the due
date. Open the explorer link and show the transaction was signed by the address
in the wallet, not by the site.

**2:00 — the part nobody demos.**
Open **Book & price**, paste the operator key, and move the price −45%. Watch
the health factor cross 1.00 on the positions page and the **Liquidate** button
appear.

Liquidate it. The liquidator takes what covers the debt plus a bonus — and the
remainder goes straight back to the borrower in the same transaction.

> "This is the whole point. A 45% move does not cost you the position. It costs
> you what the debt needed and not one share more."

**2:30 — why it holds up.**
Relay the live print again to clear the demo move. Then, briefly:

- Liquidation demands a *live* print — a position falling due over a weekend
  waits for the open, because the collateral cannot actually be sold while the
  venue is shut.
- Two staleness bounds, because when the market closes the newest price *is*
  the closing price and only gets older.
- The engine reads Chainlink's L2 sequencer uptime feed and refuses to
  liquidate during an outage and for an hour after — but never gates repayment.
- Five adversarial reviewers, 24 attacks claimed, 2 survived, both fixed.

**2:50 — close.**
> "Tokenized stocks on X Layer are a portfolio. This makes them a payment
> method, without ever making you close the trade."

---

## What is real, and what is standing in

Say this before anyone asks:

- Real: the contracts, the chain, every transaction, the price (live NasdaqGS
  print, relayed on chain with its source and timestamp), the merchant payment,
  the liquidation.
- Standing in: the share token and the stablecoin. **xStocks and USDT0 are not
  deployed on X Layer testnet** — verified with `eth_getCode`. The stand-ins are
  named so nobody can mistake them (`tXAAPL`, "Testnet Apple (NOT A SECURITY)")
  and the page lists them. On mainnet, USDT0 is
  `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` and swapping it in is a change of
  address in the deployment record.
- Not built: the oracle relayer is trusted. Chainlink has no equity feed on X
  Layer — all 26 of its push feeds there are crypto, and equity prices exist
  only as Data Streams, which is a paid subscription whose on-chain
  `StreamsLookup` X Layer does not support.

## If something breaks on stage

| Symptom | Cause | Fix |
|---|---|---|
| Quote returns "price is stale" | Nobody has relayed in 15 minutes | Book & price → Relay the live print |
| "Pool has no stablecoin" | Float drained | `pool.fund()` from the deployer |
| Wallet says wrong network | Not on 1952 | The connect button offers the switch, and adds the chain if unknown |
| Liquidate button missing | Position is healthy, or the venue is shut | Move the price further, or relay a print marked open |
