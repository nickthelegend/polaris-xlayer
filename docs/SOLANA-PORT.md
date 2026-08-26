# Porting Polaris to Solana

The EVM build is five Solidity contracts plus KeeperHub, an external execution
platform that made sure transactions actually landed. This document is the plan
for the Solana build: what maps across, what collapses, and the one thing that
genuinely gets harder.

The short version: **most of what we paid KeeperHub for is native to Solana.**
Simulation, atomic check-and-execute, fee sponsorship and replay protection are
runtime features here, not a product. The keeper stops being an execution
platform and becomes a scheduler — which is all it should ever have been.

---

## 1. The one hard problem: the standing allowance

Every collection path in Polaris rests on one mechanism. At checkout the
borrower calls `approve(loanEngine, totalOwed)` once, and each installment is
drawn later with `transferFrom` — without the borrower being online. That is
the entire product. Recurring crypto payments normally die on exactly this
point.

Solana has no ERC-20 allowance. It has something close:

| | ERC-20 | SPL Token |
|---|---|---|
| Grant | `approve(spender, amount)` | `Approve { delegate, amount }` |
| Draw | `transferFrom(owner, to, amt)` | `Transfer` signed by `delegate` |
| Decrement on use | manual | **automatic** (`delegated_amount`) |
| Revoke | `approve(0)` | `Revoke` |
| **Concurrent spenders** | **unlimited** | **exactly one** |

The first four rows are a clean match — SPL's auto-decrement is strictly better
than ERC-20, where a careless contract forgets to decrease the allowance.

The last row is the real difference, and it is a **product constraint, not a
bug**: an SPL token account holds one delegate. A borrower who delegates their
USDC account to Polaris cannot simultaneously delegate it to another protocol.
Approving again overwrites rather than adds.

**Decision: use the SPL delegate, and own the constraint.**

Three consequences the design has to respect:

1. **One delegation backs the whole book.** The Solidity code already learned
   this the hard way — `createLoan` checks the allowance against
   `activeDebtOf[borrower] + totalOwed`, not just the new loan, because one
   approval sized for a single plan otherwise supported as many loans as the
   credit limit allowed. That check ports over unchanged and matters more here.
2. **A borrower can be un-delegated at any time** by any other app that asks
   for a delegate on the same account. On EVM that was a deliberate act; here
   it can be collateral damage. Liquidation already handles "the allowance is
   gone" as a partial recovery, so the failure mode is priced in — but the
   borrower app must detect a lost delegate and re-prompt.
3. **Delegation is per-token-account.** A borrower who wants to keep their main
   USDC account free can delegate a dedicated one instead. The design permits
   any token account the borrower owns, not just the ATA.

The rejected alternatives, for the record: pre-funded escrow defeats the point
of BNPL (the borrower would prefund the loan they took out to avoid prefunding);
Token-2022 permanent delegate is a mint-level authority we do not hold over
USDC and never will.

---

## 2. What KeeperHub was for, and what replaces it

| KeeperHub primitive | Why EVM needed it | Solana |
|---|---|---|
| `simulate` before execute | Avoid burning gas on a revert | `simulateTransaction` RPC — a native method, same result, no vendor |
| `check-and-execute` (atomic read+write) | `checkLiquidatable` then `liquidate` had a window where a last-second repayment got liquidated on a stale read | **The window does not exist.** The check is a `require!` inside `liquidate`. One instruction, one state view |
| Gas-sponsored send | Keeper wallet needed ETH | **Fee payer is just a different signer.** The keeper pays fees; the borrower's account is debited by delegate. Native, no smart account |
| `Idempotency-Key` | Retry storms double-charging | **Replay protection is a runtime property.** A signed transaction lands at most once per blockhash. Durable nonces make a signed-once retry safe |
| Terminal status reconciliation | Sponsored sends were invisible to the wallet | `getSignatureStatuses` at `finalized` commitment |
| Receipts | Disputable evidence | The transaction signature *is* the receipt |

What genuinely still needs writing off-chain:

- **Scheduling.** Nothing on Solana wakes up and calls you. Clockwork is no
  longer maintained, so this is an off-chain crank on a cron — honest, boring,
  and the same shape as the existing `keeper/` jobs.
- **The dunning ladder.** Pure business logic. Ports across untouched: it
  branches on *why* a charge failed, and those causes still exist.
- **Priority fees.** Replaces "gas spike" handling. A compute-budget instruction
  with a fee scaled to recent congestion.

The failure taxonomy shifts, and one branch changes meaning rather than just
changing name. `insufficient_funds` survives verbatim — it still dominates a
credit book. `would_revert` becomes a simulation error.

`auth` and `spend_cap` do **not** map across cleanly, which is worth being
precise about. On EVM both were purely operator-side: our KeeperHub credentials
were wrong, or the platform's own spend limit stopped us. The borrower had done
nothing and the ladder deliberately routed those away from customer
notifications. The nearest Solana surface is the SPL delegation — and losing it
is the *borrower's* action, not ours. They revoked it, or another app took the
single delegate slot on the same token account.

So they become two new kinds with their own short ladder: **delegation lost**
and **delegation exhausted**. Both notify the borrower promptly, because there
is exactly one action that fixes them and until it is taken every retry fails
identically. Filing them under "operator problem, stay quiet" would leave a
borrower silently defaulting on a plan they believed was running.

That leaves a genuinely operator-side kind — keeper wallet out of SOL, RPC
credentials rejected — which keeps the old behaviour of never reaching a
customer.

---

## 3. Contracts become one program

EVM split Polaris into five contracts, wired together with `setWriter`,
`setSeizer`, `setOriginator`, `setCollateralVault` and `setMerchantRegistry`.
Those setters exist because Solidity contracts are mutually distrustful — the
LoanEngine has to be granted permission to move the ScoreManager's state.

Inside one Solana program that distrust is meaningless. **All five setters
disappear**, along with the class of bug where a deployment half-wires itself
and lending silently breaks. `collect_installment` updates the loan and the
credit score in one instruction because they are the same program's accounts.

One program, `polaris`, with modules mirroring the old contract boundaries.

### Account model

Solidity mappings become PDAs. Two of them make an invariant free that the
EVM code had to enforce by hand:

| Solidity | PDA seeds | Note |
|---|---|---|
| `loans[loanId]` | `["loan", loan_seq_le]` | counter on `Protocol` |
| `activeDebtOf[user]` + `_profiles[user]` | `["profile", user]` | **merged** — score and live debt in one account |
| `lockedOf[user]` | `["collateral", user]` + PDA-owned vault ATA | |
| `_merchants[m]` | `["merchant", authority]` | |
| `plans[planId]` | `["plan", plan_seq_le]` | |
| `subscriptions[subId]` | `["sub", subscriber, plan]` | **one-live-sub-per-pair is free** — the PDA already exists |
| `payments[keccak(m, orderId)]` | `["payment", merchant, hash(order_id)]` | **duplicate-payment guard is free** — `init` fails if it exists |
| `Ownable` | `authority` on `["protocol"]`, `has_one` | |

`ScoreManager` merging into the credit profile is the biggest structural
change. On EVM it was a separate contract so the limit could be read by the
SDK and both UIs without a cross-contract hop; here it is one account fetch.

### Type and semantics changes

- `uint128` amounts → `u64`. USDC supply is far below `u64::MAX`. Every
  intermediate product (`principal * RATE_BPS * term`) widens to `u128` and
  narrows back with a checked cast — the interest formula overflows `u64` at
  realistic inputs otherwise.
- `block.timestamp` → `Clock::get()?.unix_timestamp`, which is `i64`, not
  `u64`. Every comparison in the schedule ladder gets signed types.
- `nonReentrant` → **dropped**. Solana has no mid-instruction callback into the
  calling program. State writes still precede token CPIs, because
  checks-effects-interactions is right regardless.
- Balance-delta measurement around transfers → **kept**. Classic SPL USDC has no
  transfer fee, but Token-2022 does, and the original's instinct — credit what
  actually arrived, not what was asked for — costs one extra account read.
- `keccak256(abi.encodePacked(merchant, orderId))` → the order id is hashed
  into PDA seeds, capped at 32 bytes.
- Events: `emit!`. Program logs are truncated under load, so anything the
  indexer must not miss also lands in account state.

### The invariants that must survive the port

These are the bugs the Solidity code was hardened against. Each one gets a
regression test on the Solana side:

1. **Dust cannot buy liquidation immunity.** Installments-paid is *derived*
   from money received via one canonical `threshold_for` ladder, never
   incremented per call.
2. **Self-liquidation cannot write off debt for free.** Liquidation recovers
   from the delegation and then collateral, and books the shortfall as bad debt.
3. **The protocol fee comes out of interest, not principal.** Pro-rated against
   actual annualised interest, or short-term loans lose the pool money.
4. **One approval cannot back unlimited loans.** Delegation is checked against
   total active debt at origination.
5. **A zero interval is rejected.** Otherwise the loan is due in full at
   origination against a schedule that never existed.
6. **Ceil-rounded thresholds.** The schedule and the progress check read the
   same function, or a full payment lands a unit short of its own threshold.

---

## 4. Build order

1. `programs/polaris` — accounts, errors, math, then instructions
2. Tests against `solana-test-validator`, including all six invariants above
3. `keeper-solana/` — the crank: collect, subscriptions, liquidate, settle
4. `packages/sdk-solana` — `pay` / `subscribe` / `pay_later`
5. Devnet deployment against circulating devnet USDC

The EVM contracts stay in `packages/contracts` as the reference the port is
checked against, and as the record of which bugs were already found once.
