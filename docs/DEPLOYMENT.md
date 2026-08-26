# Live deployment

**Ethereum Sepolia (11155111).** Deployed and exercised on 2026-08-03.

## Contracts

| Contract | Address |
|---|---|
| PolarisLoanEngine | [`0xF8DA73d32778f623D33C5D75c7359CbA1DA584ED`](https://sepolia.etherscan.io/address/0xF8DA73d32778f623D33C5D75c7359CbA1DA584ED) |
| ScoreManager | [`0x4e9e7EEF855BFE2c44608A9613E955fC67035312`](https://sepolia.etherscan.io/address/0x4e9e7EEF855BFE2c44608A9613E955fC67035312) |
| MerchantRegistry | [`0xb2eCAD5bE07971deE1be161C39569705186AdFD6`](https://sepolia.etherscan.io/address/0xb2eCAD5bE07971deE1be161C39569705186AdFD6) |
| MockUSDC (pUSDC, 6dp) | [`0x49C86277a91002c4943837bf20F6ED41976Db09F`](https://sepolia.etherscan.io/address/0x49C86277a91002c4943837bf20F6ED41976Db09F) |

Deployer / originator: [`0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67`](https://sepolia.etherscan.io/address/0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67)

The LoanEngine holds 100,000 pUSDC of protocol liquidity so merchants can be paid up front. `MockUSDC.faucet()` dispenses 1,000 pUSDC per address per hour.

## Proven on chain

`pnpm contracts:e2e` drives the full lifecycle against the live deployment and asserts state at each step. Every assertion passed:

| Step | Transaction |
|---|---|
| Merchant registered | [`0x28bf9a1b…`](https://sepolia.etherscan.io/tx/0x28bf9a1b39454a13929964981b502a0aebbe0983a5bbc112d034ca378ac47230) |
| Merchant activated | [`0x6a79d83d…`](https://sepolia.etherscan.io/tx/0x6a79d83da0fcf3bd18e6a8f30ec2e7e7765d644e16d9b1fbcaef078bfe31b11d) |
| Checkout approval | [`0x1723ff03…`](https://sepolia.etherscan.io/tx/0x1723ff03de9f6257faa04b81ea6a3097f61759709909964484bf020b73bbff15) |
| Plan opened (loan #1, 200 pUSDC / 4 instalments) | [`0x455c957e…`](https://sepolia.etherscan.io/tx/0x455c957e7414f7556009f4a0ba55287428352fd875482114d9de69637d4fe750) |
| Instalment 1 collected by a third party | [`0xee2ec476…`](https://sepolia.etherscan.io/tx/0xee2ec476acf4ba9ab6e9499da17bf931c01d96e95dea995f673aa69e622c7570) |
| Instalment 2 collected | [`0x786e9b5d…`](https://sepolia.etherscan.io/tx/0x786e9b5decc5f13f31a3159e269b6b142f6cdbed4f588964805dd112f0168255) |

What that run asserted, not merely printed:

- The merchant received the full 200.00 principal **at origination**, before any instalment was collected.
- `checkLiquidatable` returned **false** on a current loan, so a keeper correctly takes no action.
- Instalment collection succeeded when called by **a third party**, not the borrower — the keeper path, pulling against the single checkout approval.
- The borrower's balance moved by exactly the instalment amount.
- The credit score rose on each on-time payment: **600 → 612 → 624**, and the derived credit limit read back from chain.
- The loan stayed un-liquidatable after payment.

Live state after the run: loan #1, **2 of 4** instalments collected, 100.00 pUSDC outstanding.

## Reproducing

```bash
pnpm contracts:deploy
```

```bash
pnpm contracts:e2e
```

```bash
pnpm db:sync
```

`db:sync` reads every loan from the LoanEngine and reconciles MongoDB to it. The chain is the source of truth for what is owed; Mongo carries the instalment schedule and dunning state the contract does not store. A re-sync preserves any in-flight retry schedule rather than wiping it.

## The product loop, closed end to end

Every stage below ran against the live deployment, in order, with the result of
each verified before the next. No fixtures, no seeded rows — the database holds
only loans the LoanEngine has issued.

| Stage | What happened |
|---|---|
| Checkout | `POST /api/checkout` opened **loan #2** on chain — 60.00 over 3 instalments |
| Merchant paid | Principal transferred at origination, before any collection |
| Collection | Instalment drawn against the buyer's checkout approval: 0/3 → **1/3**, 60.00 → **40.00** outstanding |
| Scoring | Borrower score moved **474 → 486** on the on-time payment |
| Reconciliation | `db:sync` read both loans back from chain into Mongo |
| Merchant ledger | **140.00 outstanding, 42.9% collection rate**, both plans correct |
| Borrower ledger | **score 486, 200.00 limit, 59.99 available, 3 on-time** |

Both ledgers were read from the running apps, and every figure traces to a
Sepolia transaction. `db:purge` removes any row the chain does not back; it was
run, and the book now holds exactly the two loans that exist on chain.

## Executed through KeeperHub

`pnpm keeper:collect` with `KEEPER_DRY_RUN=false`. Three instalments collected in one pass, **every one gas-sponsored by KeeperHub's Gas Station** — the keeper wallet paid nothing.

| Action | Transaction | Block | Gas |
|---|---|---|---|
| loan 2, instalment 3 | [`0xb8847031…`](https://sepolia.etherscan.io/tx/0xb88470313f58f4c19e44560c2c295adcdf50bcca148e306f2f447eb29e5bc5db) | 11415202 | 149,540 |
| loan 1, instalment 3 | [`0x07e4bc06…`](https://sepolia.etherscan.io/tx/0x07e4bc06ba7e7267b85cd58d9fd23fadf136abdb0853f987fb513535ea42b9ee) | 11415203 | 109,952 |
| loan 1, instalment 4 | [`0x38e2126e…`](https://sepolia.etherscan.io/tx/0x38e2126efdff6ef5d0ab561abfd39592fd3081fcd365800c389ef1473000615b) | 11415204 | 114,647 |

All three confirmed `status: SUCCESS` on chain. **Loan #1 closed at 4/4 with zero outstanding** — a BNPL plan opened at checkout and retired entirely by the keeper.

Each charge ran the full path: simulate against current state, broadcast with a per-attempt idempotency key, poll `/api/execute/{id}/status` to a terminal state, write a receipt. The keeper wallet's nonce and balance did not move, because a sponsored execution runs through a smart account — which is exactly why the client never infers success from wallet state.

State after the pass, read back from chain and rendered by both apps:

| | |
|---|---|
| Merchant ledger | 20.00 outstanding, **85.7% collection rate**, 1 active plan |
| Borrower ledger | score **522**, 179.99 available of a 200.00 limit, 6 on-time |
| Loan 1 | `repaid`, 4/4, 0.00 outstanding |
| Loan 2 | `active`, 2/3, 20.00 outstanding |

The live test suite runs authenticated too: `pnpm --filter @polarispay/keeperhub test:live` — 7 passing, none skipped.

## Remaining gap

**Liquidation fired *by the keeper*.** Liquidation itself is proven on chain — the demo engine at `0x032d5241F0761a593fe3595c7418153dA7d5f70d` walked the condition through all three phases and executed a real liquidation, and the path is covered by contract tests using time travel including the case that motivates the design, where a last-second repayment makes a loan un-liquidatable again.

What has not happened is the keeper firing that liquidation through KeeperHub's `check-and-execute` against the production engine, because its 3-day grace period means a plan has to sit unpaid for three days first. The code path is identical to the collection path that is now fully exercised; only the trigger condition differs.

Collection through KeeperHub is complete: simulate, sponsored broadcast, terminal reconciliation, receipt.
