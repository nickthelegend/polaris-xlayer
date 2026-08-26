# @polarispay/keeper

The runnable keeper. Three jobs, each a pure pass over the loan book: read what is due, act through KeeperHub, write back what happened. Safe to run repeatedly and safe to run concurrently.

## Commands

```bash
pnpm --filter @polarispay/keeper doctor
```

Prints the resolved configuration and whether the chain is gas-sponsorship eligible. Run this first.

```bash
pnpm keeper:collect
```

Collects every installment that is due and is not parked in the dunning back-off.

```bash
pnpm keeper:liquidate
```

Tests each liquidation candidate with `checkLiquidatable` and liquidates the ones that qualify.

```bash
pnpm keeper:settle
```

Pays merchants from the escrow.

```bash
pnpm keeper:all
```

Runs all three on a loop every `KEEPER_INTERVAL_SECONDS`. A failing pass is logged and the loop continues — the next pass re-reads state and everything in flight is idempotent.

## Configuration

Copy `.env.example` to `.env`. `KEEPERHUB_API_KEY` and `POLARIS_LOAN_ENGINE` are required; everything else has a default.

**`KEEPER_DRY_RUN=true` is the default in the example file.** It prints intended actions without sending anything. Turn it off deliberately.

## The loan book

`LoanBook` is a narrow interface — due installments, liquidation candidates, record an attempt. The shipped `FileLoanBook` reads `keeper/data/loanbook.json` so the keeper runs end to end with no database. Production swaps in the Supabase store the Polaris apps already use, without touching the jobs.

Installment state machine:

```
scheduled ──collect ok──> paid
    │
    └──collect fails──> dunning ──ladder exhausted──> loan flagged liquidation candidate
                           │
                           └──retry at nextAttemptAt
```

`nextAttemptAt` is what stops the keeper re-charging a borrower who was short an hour ago. That back-off is a business schedule and lives here, not in the network client.

## Workflow definitions

`workflows/` holds KeeperHub workflow JSON for the same two jobs, for deployment through the KeeperHub builder rather than this process:

- `installment-collection.json` — hourly schedule → fetch due → repay → receipt, with a Telegram branch on failure
- `liquidation-keeper.json` — every 50 blocks → fetch candidates → `checkLiquidatable` → liquidate → Discord alert

Both are the same logic as the TypeScript jobs, expressed as workflows. Which one you run is an operational choice: the process gives you the dunning ladder and typed receipts, the workflows give you KeeperHub-hosted scheduling with no infrastructure at all.

## Verifying a charge

A sponsored execution runs through a smart account. The keeper wallet's **nonce, native balance and explorer transaction list will not change.** Check the execution status, not the wallet — `doctor` prints this reminder for a reason.
