# Polaris

**A payments layer with credit built in, on Solana.**

Three ways to pay: in full, on a subscription, or split into installments
against an undercollateralized credit line. Polaris decides who gets credit and
collects what is owed — installments drawn on the day they fall due, defaults
liquidated the moment they qualify, merchants paid up front. Every one of those
is a transaction that has to land, exactly once, or somebody loses money.

This is a port. The original is five Solidity contracts plus **KeeperHub**, an
external platform that made sure transactions landed. Porting it produced one
finding worth the whole exercise:

> **Most of what a keeper platform sells is native to Solana.** Simulation,
> atomic check-and-execute, fee sponsorship and replay protection are runtime
> features here, not a product. The keeper stops being an execution layer and
> becomes a scheduler — which is all it should ever have been.

`docs/SOLANA-PORT.md` is the full mapping. `packages/contracts` keeps the
Solidity original as the reference this was checked against.

---

## What changed, and why it matters

| KeeperHub primitive | Why EVM needed it | Solana |
|---|---|---|
| `simulate` before execute | Avoid burning gas on a revert | `simulateTransaction` — a native RPC method |
| `check-and-execute` (atomic) | `checkLiquidatable` then `liquidate` had a window where a last-second repayment got liquidated on a stale read | **The window does not exist.** The check is a `require!` on the line above the action, in one instruction |
| Gas-sponsored send | Keeper wallet needed ETH | **The fee payer is just a different signer.** The keeper holds SOL and no USDC, touches no borrower balance, and still lands the transaction |
| `Idempotency-Key` | Retry storms double-charging | **Replay protection is a runtime property.** A signed transaction lands at most once per blockhash |
| Terminal status reconciliation | Sponsored sends were invisible to the wallet | `getSignatureStatuses` at `finalized` |
| Receipts | Disputable evidence | The signature *is* the receipt |

Five contracts became one program. `setWriter`, `setSeizer`, `setOriginator`,
`setCollateralVault` and `setMerchantRegistry` exist on EVM only because
Solidity contracts are mutually distrustful and have to be granted permission
over each other's state. Inside one program that distrust is meaningless, and
so is the class of bug where a deployment half-wires itself and lending
silently breaks.

Two invariants come free from addressing rather than from a check that could be
forgotten: a payment PDA seeded by `(merchant, order_ref)` makes a retried
checkout idempotent, and a subscription PDA seeded by `(subscriber, plan)`
makes a double-subscribe impossible.

## The pull model

Every collection path rests on one mechanism. At checkout the borrower
authorizes the protocol once, and each installment is drawn later without them
being online. On EVM that was an ERC-20 allowance. Here it is an **SPL
delegate**, which is a close match with one difference that is a product
constraint rather than a bug:

|  | ERC-20 | SPL Token |
|---|---|---|
| Grant | `approve(spender, amount)` | `Approve { delegate, amount }` |
| Draw | `transferFrom` | `Transfer` signed by the delegate |
| Decrement on use | manual | **automatic** |
| **Concurrent spenders** | unlimited | **exactly one** |

A token account holds one delegate, so a borrower who authorizes Polaris cannot
simultaneously authorize another protocol on the same account. Losing that
delegate is therefore something the keeper has to handle as a first-class
failure, not an edge case — see the dunning ladder.

## Two things this build does that the original did not

**Origination is one transaction, signed by the borrower.** On EVM, `approve`
and `createLoan` were two transactions sent in order by a permissioned
originator, and a checkout that dropped the second left a standing allowance
with no loan attached. Solana puts both instructions in one transaction: they
both land or neither does, and the permissioned-originator role disappears.

**The permissionless instruction cannot choose an amount.** On EVM,
`repay(loanId, amount)` was permissionless *and* took an arbitrary amount, so
anyone could drain a borrower's entire standing allowance early.
`collect_installment` takes no amount — it collects exactly what the schedule
says is due today. Arbitrary amounts need the borrower's own signature.

## Layout

```
programs/polaris        the program — one Anchor program, 21 instructions
keeper-solana           the crank: collect · subscriptions · liquidate
packages/sdk-solana     createPolaris() — pay, subscribe, payLater
mobile/                 the Android app — Expo, signs on the device
scripts/lifecycle.ts    stand it up and run a loan through its whole life
tests/                  41 integration tests on bankrun
docs/SOLANA-PORT.md     the port plan and every decision in it
packages/contracts      the Solidity original, kept as the reference
```

## Quick start

```bash
pnpm install
```

```bash
anchor build && cargo test -p polaris --lib
```

Run the whole thing against a local validator — origination, four collections,
a default and a liquidation, in about five minutes:

```bash
solana-test-validator --bpf-program $(cat .program-id.txt) target/deploy/polaris.so --reset
```

```bash
POLARIS_CLUSTER=localnet pnpm exec tsx scripts/lifecycle.ts
```

The keeper reads what is due off the chain rather than a database, because the
whole book is one `getProgramAccounts` call:

```bash
KEEPER_DRY_RUN=true pnpm --filter @polaris/keeper-solana start
```

## Three payment modes

```ts
const polaris = createPolaris({ connection, wallet, idl });

await polaris.pay({ merchant, amount: 25_000_000n, orderId });    // in full
await polaris.subscribe({ plan });                                // recurring
await polaris.payLater({ merchant, amount: 200_000_000n });       // 4 installments
```

`payLater` bundles the SPL `Approve` and the origination into one transaction,
and sizes the delegation against **everything** the borrower owes — not just
this purchase. One delegate slot backs every open plan at once, so sizing it
for a single plan is how a book ends up with loans it cannot collect.

## The app

An Expo app that opens a plan against the deployed program from an Android
device — the credit line, the checkout, the schedule, and the activity feed all
read from accounts rather than from a server.

It generates its own signer on first launch and keeps it in the platform
keystore, so **no private key is carried in this repository**. It shows its
address on the home screen; fund that address on a test cluster with:

```bash
pnpm exec tsx scripts/fund.ts <address>
```

```bash
pnpm --filter polaris-mobile android
```

Every instruction is built in `mobile/src/chain`, never in a screen, so the
signer is the one piece a shipped build has to replace — see *What is not done*.

## Tests

```bash
pnpm run program:test        # 11 — the arithmetic that costs money
pnpm run anchor:test         # 41 — every exploit, on chain
pnpm --filter @polaris/keeper-solana test   # 11 — the dunning ladder
pnpm --filter @polaris/sdk-solana test      # 13 — the SDK against a live cluster
```

`anchor test` starts its own validator and will refuse if you still have the
one from the quick start on 8899. The bankrun suite does not need a validator
at all, so run it directly instead:

```bash
pnpm exec ts-mocha -p ./tsconfig.anchor.json -t 1000000 'tests/**/*.ts'
```


76 in total, and all of them green. The reference build carries its own 308 --
153 on the Solidity contracts, 82 on the database layer, 45 on KeeperHub, 20 on
underwriting, 8 on the MCP server -- run with `pnpm test` at the root.

The integration tests are named for the exploit rather than the function, so a
regression reads as *dust buys liquidation immunity again* rather than *repay
test 4 failed*. Each one is a bug the Solidity build was
hardened against, re-proved here:

- dust cannot buy liquidation immunity, or farm the credit score
- self-liquidation recovers instead of writing the debt off for free
- the real shortfall is booked as bad debt when there is nothing to take
- the protocol fee never exceeds the interest actually earned, at 7, 30 and 40 days
- one delegation cannot back more loans than it covers
- a missed subscription period is skipped rather than stacked, and lapses after three

They run on **bankrun**, not a validator, for one reason: every rule here is a
function of time. The default grace period is three days, so a suite that
cannot move the clock can only test origination.

## Status

| | |
|---|---|
| Program | `ApAHXF7U1Z8WKDYKM7ZvBMeho7tSkGQZS1LsaTNyzCra` |
| Devnet | **live** — deployed, initialised, and exercised |
| Localnet | full lifecycle verified, including a liquidation |
| Android | runs on an emulator against a live cluster — never on physical hardware |
| Size | 571 KB, clean SBF build |

Devnet carries the current build, an initialised protocol, a funded pool, and a
real plan opened against it. `scripts/prove.ts` is what put it there. It uses
one wallet for every role, so it costs almost no SOL and can be re-run against
any deployment to confirm it for yourself:

```bash
POLARIS_CLUSTER=devnet pnpm exec tsx scripts/prove.ts
```

To read the state of a deployment without touching it:

```bash
POLARIS_CLUSTER=devnet pnpm exec tsx scripts/inspect.ts
```

The last local lifecycle run, in `deployments/localnet.json`:

```
loan status      repaid
repaid           400.000304 of 400.000304   (interest pro-rated over 240s)
credit score     600 -> 648                 (4 installments, all on time)
protocol fees    0.000060 of 0.000304 interest — exactly the 20% cap
keeper spent     0.000020 SOL in fees
keeper USDC      none — it never held any

loan status      liquidated                 (second borrower, delegation revoked)
recovered        0.000000 of 200.000152
bad debt booked  200.000152
credit score     600 -> 450
```

## What is not done

**Mobile Wallet Adapter.** The app signs with a keypair it generates on the
device. Those are real signed transactions against the real program, but the
key belongs to the app rather than to a wallet the user already trusts. A
shipped build swaps `mobile/src/chain/wallet.ts` for MWA and nothing else
moves — every instruction is already built by the chain layer.

**The Solidity side is the reference, not the deliverable.** `packages/contracts`
and the Next.js apps around it are the original build, kept so the port can be
read against it. The Solana program is what this repository is for.

## License

MIT
