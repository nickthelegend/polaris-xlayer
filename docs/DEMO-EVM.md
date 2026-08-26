# Recording the demo

Everything below runs against Sepolia. Nothing is mocked, nothing is replayed:
each transaction in the recording is one you can open on Etherscan afterwards.

## Before you press record

Three processes, in three terminals:

```bash
mongod --dbpath <your-data-dir> --port 27077          # or point MONGODB_URI at Atlas
pnpm --filter @polarispay/core dev                    # http://localhost:3110
pnpm --filter @polarispay/merchant dev                # http://localhost:3111
```

Then confirm the keeper can reach KeeperHub and the book agrees with the chain:

```bash
cd keeper && npm run doctor && cd ../packages/db && npm run reconcile
```

`doctor` prints the API key prefix, the chain, the contracts, and whether the
chain is sponsorship-eligible. `reconcile` should say "No drift". If it does
not, run `npm run sync` first -- the chain is the source of truth and the book
follows it, never the other way around.

## The five minutes

**1. A shopper checks out.** `localhost:3111/store`. Pick an item, pay in four.
The loan opens on chain in one transaction and the response carries its hash.

The storefront posts to its own `/api/store/checkout`, which holds the merchant
API key server-side. The key is never in the page.

**2. Arm the plan.** A real plan does not have an instalment due for a
fortnight, and the contract refuses any interval under an hour, so there is
nothing to collect during a recording. Move the schedule instead:

```bash
cd packages/db && npm run demo:arm -- <loanId>
```

That shifts the plan's due dates into the past and prints the new schedule. The
loan, the money and the collection are all real; only the business calendar
moves, which is what "this customer checked out a fortnight ago" means. It
refuses to run on a plan that is not active, and it will not invent one.

**3. The keeper collects.** `cd keeper && npm run collect`. It simulates first,
then sends. One line comes back per instalment with the transaction hash and
whether gas was sponsored.

Sponsored execution runs through a smart account, so the keeper wallet's nonce,
balance and Etherscan transaction list do not move. Confirm charges with the
execution status or the receipt, never with the wallet -- this catches people
out every time.

**4. Watch it land.** `localhost:3110` shows the keeper's own receipts in the
hero, newest first, each linked to Etherscan. `localhost:3111/demo` is the
merchant's read-only console over the same live data: outstanding, at risk,
collection rate, and every plan's state.

**5. Close the loop.** The remaining jobs, each of which stands alone:

```bash
cd keeper
npm run subscriptions   # charges any subscription past its boundary
npm run settle          # pays merchants out of escrow
npm run liquidate       # checks health; sends nothing when every loan is fine
npm run close-out       # releases collateral on fully repaid loans
npm run health          # one screen: per-job status, exposure, incidents
```

`health` is the closing shot. It reports the last run of every job, what is
overdue, what is in dunning, and any incident -- and it will say DEGRADED if
something actually failed, which is the point of showing it.

## What to say about failures

Leave them in. The receipts feed shows failed actions in amber alongside the
successes, and a run that only ever shows green is a marketing asset rather
than evidence.

If a collection fails during the take, the interesting part is what happens
next: the failure is classified, and the keeper decides from the classification
whether the idempotency key may rotate. A revert is definite, so the key
rotates; a timeout or an in-flight duplicate is not, so the key is held. That
distinction is the subject of the upstream fix in
[KeeperHub#1922](https://github.com/KeeperHub/keeperhub/pull/1922), which came
out of this keeper double-charging nothing only because it was written to hold
the key.

## Resetting between takes

```bash
cd packages/db
npm run sync        # pull chain state into the book
npm run reconcile   # prove they agree
```

There is no reset that unwinds the chain, and there should not be. Open a fresh
plan for each take.
