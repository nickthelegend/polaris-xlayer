# Test plan

Every component and flow in the Solana build, with an explicit definition of
"correct" for each. This is the checklist the verification run is measured
against.

## Scope

**In scope — the Solana project.**

| Surface | What it is |
|---|---|
| `programs/polaris` | The Anchor program. 21 instructions, 7 account types |
| `keeper-solana` | The crank: doctor, collect, subscriptions, liquidate |
| `packages/sdk-solana` | `createPolaris()` — pay, payLater, subscribe, repay |
| `mobile` | The Expo app. The only UI in this build |
| `scripts/lifecycle.ts` | Stand-up and end-to-end run |

**Out of scope, and why.** `apps/core`, `apps/merchant`, `keeper/`, and
`packages/{contracts,keeperhub,db,mcp,sdk,underwriting,protocol}` are the
**EVM build**, kept as the reference this port was checked against — the README
says so explicitly. Their dependencies are `ethers`, `viem`, `wagmi` and
`mongodb`; none of them import a Solana library. Running them needs a MongoDB
instance, a Sepolia RPC key, a KeeperHub organisation key, a Supabase project
and five deployed Ethereum contract addresses. **The repository contains no
`.env` file** — only `keeper/.env.example` — so none of those credentials
exist here. They are recorded as UNTESTABLE with the specific blocker rather
than marked pass.

## Method

- **Cluster.** A local `solana-test-validator` with the program deployed from
  `target/deploy/polaris.so`. A real cluster, a real program account, real
  signed transactions, a real persisted ledger. Devnet was the first choice and
  the program is deployed there, but the upgrade to the current build needs a
  3.98 SOL transient buffer against a 3.03 SOL balance and the faucet has been
  rate-limited throughout this run.
- **Browser.** Every UI item is exercised in a real browser against the running
  app, with the console and network panel read on every item.
- **Pass.** The observed result matches the stated expectation exactly, and the
  console and network are clean. Anything else is a fail.

## Result

**82 of 82 in-scope items pass** — A (24), B (12), C (16), D (9), E (18), F (3).

**Verified twice over on the app**: in a browser against the live cluster, and
on a real Android emulator over `adb reverse`, which is the actual target and
which caught a fault no browser run could have.

**Section G was re-opened rather than left as "untestable".** `mongod` is
installed on this machine and the repository carries the real deployed Sepolia
addresses, so G1 was stood up for real: local MongoDB, a public Sepolia RPC,
and the genuinely deployed contracts. `GET /api/credit/me?address=0x7A2E…`
returns **score 648, limit 1850.00** read off the live ScoreManager, and
`/api/limits` reports **900 USDC of real locked collateral**. G1 now passes.
G2–G4 remain untestable and are listed with their exact blocker.

Every fix below was made at the root cause and re-verified against the same
item. The full plan was then re-run top to bottom.

### What was actually broken

| Found | Fix |
|---|---|
| The app rendered fixtures, not chain state | Deleted the fixture module; every screen now reads live accounts and decodes the program's own events |
| Anchor's `Wallet` is `NodeWallet` and is stripped from browser/RN bundles — the app threw on first paint | A three-member keypair signer |
| Event names are PascalCase; the mapper matched camelCase, so every event fell through and the feed rendered **empty** — indistinguishable from "no activity" | Matched on the IDL's names; unknown events now surface as a row rather than vanishing |
| Event fields are snake_case. Single-word fields matched, so events rendered correct money beside `Installment NaN` and `score undefined → undefined` | Normalised once at the boundary |
| The activity feed read signatures off the **protocol** PDA — every borrower touches it, so it would have shown one customer another's loans | Scoped to the borrower's own profile and token account |
| Sub-cent interest rendered as `0.00`, stating a loan was interest-free when it was not | Figures widen to full precision rather than round a real amount to zero |
| Four installments 60s apart all showed the same date | Sub-day schedules show the time |
| Installments the borrower paid early were captioned "collected by the keeper" | Attributed by instruction name — `Repay` vs `CollectInstallment` — not by fee payer, which Anchor sets to the provider wallet |
| `1 periods charged` | — |
| Titles rounded where `Figure` truncated, so one amount read two ways | Both truncate |
| **The keeper could not run at all**: its own scripts use `node --experimental-strip-types`, which rejects constructor parameter properties; and `TransactionSignature` was imported as a value from a CommonJS module | Explicit fields; `import type` |
| The keeper hardcoded `~/.config/solana/id.json` rather than reading the CLI config | Reads `solana config get` |
| The checkout's Subscribe mode listed subscriptions but could not subscribe | Wired to a real `subscribe` transaction against an available plan |
| `scripts/lifecycle.ts` waited out its **own** 30s grace constant while reusing a protocol with a 3-day grace, so liquidation failed `NotLiquidatable` | Adopts the deployment's real grace and interval; refuses to pretend when the wait is impractical |
| 12 plan items had no test at all | Written; 41 integration + 11 program + 11 keeper all green |
| `solana-test-validator` purges root slots at 10,000 shreds by default, silently emptying the activity feed | `reset-local.sh` raises retention |

### Counts

| | |
|---|---|
| Program unit tests | 11 pass |
| Program integration tests (bankrun) | 41 pass |
| Keeper tests | 11 pass |
| Browser items verified against live chain | 18 pass |
| Real transactions signed and landed during this run | 30+ |
| Console errors remaining | 0 |
| Failed network requests remaining | 0 |
| Mocks / stubs / fallback data remaining | 0 |

### Found only by running on the device

The browser cannot surface these, and all four were real:

| Found | Fix |
|---|---|
| **Every account decode failed on Android.** `Buffer.prototype.subarray` is inherited from `Uint8Array` and built through the species constructor; under Hermes that resolves to `Uint8Array`, so the view loses every Buffer method. Anchor strips the 8-byte discriminator with `subarray(8)`, and buffer-layout then calls `b.readUIntLE(...)` — thrown deep inside a borsh decode with nothing in the stack naming Buffer | Re-attach the prototype in the polyfill |
| The chain modules trusted the root layout to import polyfills first — an order expo-router's `require.context` does not promise | Each module imports them itself |
| `app.json` referenced `./assets/adaptive-icon.png`, which the SDK 57 template does not create | Points at the three files it does ship |
| `plans.tsx` animated its expand with `LayoutAnimation`, a **no-op on the New Architecture** — it did nothing and printed a warning toast over the UI | Reanimated layout transition |

### Found in the EVM app while re-opening G1

| Found | Fix |
|---|---|
| `apps/core` imports `@polarispay/db` in five API routes and **never declared it as a dependency** — a clean install could not run it | Declared `workspace:*` |
| `components/providers.tsx` imported `injected` from the `wagmi/connectors` barrel, which re-exports Safe, WalletConnect, Coinbase and Base, each pulling an uninstalled optional peer — four module-not-found errors on every page load | Import from `wagmi/connectors/injected` |
| lucide-react 0.454 against React 19 produced a hydration mismatch on every icon's `aria-hidden` | Upgraded |

---

## A. Program — origination and collection

| # | Item | Correct means |
|---|---|---|
| A1 | `initialize` | Protocol PDA exists; `stablecoin`, `treasury`, `grace_period`, `min_interval_seconds`, `fee_bps`, `credit_multiplier_bps` all equal what was passed; both vaults exist as token accounts owned by the protocol PDA; counters all zero |
| A2 | `initialize` twice | Second call fails — the address is already in use. Not a silent no-op |
| A3 | `initialize` with `grace_period` > 30 days | Fails `InvalidGracePeriod` |
| A4 | `initialize` with `min_interval_seconds` = 59 | Fails `InvalidInterval` |
| A5 | `initialize` with `fee_bps` > 500 | Fails `InvalidFee` |
| A6 | `register_merchant` | Merchant PDA at `["merchant", authority]`; `active = false`; `max_order_value = 500 USDC`; `payout` recorded |
| A7 | `set_merchant_active` by non-authority | Fails `NotAuthorized`; merchant unchanged |
| A8 | `create_loan` happy path | Merchant payout receives **the full principal** before any installment; loan PDA has `total_owed = principal + prorated interest`; borrower profile `active_debt` increases by `total_owed`; protocol `loan_count` increments by 1 |
| A9 | `create_loan` with no delegation | Fails `NotDelegated`; merchant receives nothing; `loan_count` unchanged |
| A10 | `create_loan` with delegation sized for one plan, twice | Second fails `InsufficientDelegation` |
| A11 | `create_loan` interval 0 / 59s / 366 days | Each fails `InvalidInterval` |
| A12 | `create_loan` installments 0 / 25 | Each fails `InvalidInstallments` |
| A13 | `create_loan` above credit limit | Fails `ExceedsCreditLimit` |
| A14 | `create_loan` inactive merchant | Fails `MerchantNotEligible` |
| A15 | `create_loan` above merchant cap | Fails `MerchantNotEligible` |
| A16 | `create_loan` with liquidity below principal | Fails `InsufficientLiquidity` |
| A17 | `collect_installment` when due | Pulls exactly `threshold_for(k+1) - total_repaid`; `installments_paid` becomes k+1; score +12; liquidity vault increases by the amount collected |
| A18 | `collect_installment` before due | Fails `NotDue`; no tokens move |
| A19 | `collect_installment` by an arbitrary third party | Succeeds, and moves **exactly one installment** — no more |
| A20 | `collect_installment` pointed at another token account | Fails `TokenOwnerMismatch` |
| A21 | Full schedule collected | Loan status `Repaid`; `total_repaid == total_owed`; `active_debt` back to 0; score 600 → 648 |
| A22 | `repay` arbitrary amount by borrower | Succeeds, capped at remaining; overpayment impossible |
| A23 | `repay` by a non-borrower | Fails (seeds/constraint), no tokens move |
| A24 | Dust: four 1-unit `repay` calls | `installments_paid` stays **0**; `on_time_payments` stays 0; loan still liquidatable after grace |

## B. Program — liquidation, collateral, fees

| # | Item | Correct means |
|---|---|---|
| B1 | `liquidate` before grace elapses | Fails `NotLiquidatable` |
| B2 | `liquidate` after grace, borrower solvent | Recovers the full outstanding from the delegation; `bad_debt` unchanged at 0; score −150 |
| B3 | `liquidate` after delegation revoked | Recovers 0; `bad_debt` increases by exactly the outstanding; status `Liquidated` |
| B4 | Self-liquidation | Same recovery as B2 — not free, and the score still drops |
| B5 | `liquidate` twice | Second fails `NotLiquidatable` |
| B6 | `lock_collateral` | `locked_collateral` increases; collateral vault balance increases; credit limit rises by 150% of the amount |
| B7 | `withdraw_collateral` with debt outstanding | Fails `DebtOutstanding` |
| B8 | `withdraw_collateral` with no debt | Succeeds; tokens return to the user |
| B9 | Liquidation with collateral, delegation revoked | Seizes collateral toward the shortfall; `seized_collateral` records it; `bad_debt` = outstanding − seized |
| B10 | Protocol fee over a full plan | `protocol_fees_accrued` ≤ 20% of the interest actually earned, at 7-, 30- and 40-day terms |
| B11 | `sweep_fees` | Treasury receives exactly `protocol_fees_accrued`; the counter resets to 0 |
| B12 | `withdraw_liquidity` beyond free liquidity | Fails `InsufficientLiquidity` — accrued fees are not withdrawable |

## C. Program — payments and subscriptions

| # | Item | Correct means |
|---|---|---|
| C1 | `pay` | Merchant receives `amount − fee`; treasury receives `fee`; payment PDA records `order_ref`; `payment_count` increments |
| C2 | `pay` same order twice | Second fails — the address is already in use |
| C3 | `pay` same order, different payer | Also fails. The guard is the address, not the signature |
| C4 | `pay` two different orders | Both succeed at distinct addresses |
| C5 | `create_plan` | Plan PDA; `active = true`; price and period recorded |
| C6 | `create_plan` period below the floor | Fails `InvalidPeriod` |
| C7 | `subscribe` | Period 1 charged immediately; merchant paid net; `next_charge_at = now + period` |
| C8 | `subscribe` with no delegation | Fails `NotDelegated` — a subscription that can never renew is refused at signup |
| C9 | `subscribe` twice while active | Second fails `AlreadySubscribed` |
| C10 | `charge_due` when due | Charges one period; `periods_charged` +1; `next_charge_at` advances by exactly one period |
| C11 | `charge_due` before due | Fails `NotDue` |
| C12 | `charge_due` past the 7-day window | Period **skipped, not stacked**; `missed_charges` +1; merchant receives nothing |
| C13 | Three consecutive misses | Status becomes `Lapsed` |
| C14 | `cancel_subscription` by subscriber | Status `Cancelled` with no merchant involvement |
| C15 | `charge_due` after cancel | Fails `SubscriptionNotActive` |
| C16 | Re-subscribe after cancel | Succeeds; `periods_charged` resets to 1 |

## D. Keeper

| # | Item | Correct means |
|---|---|---|
| D1 | `doctor` | Prints cluster, program id, keeper balance, protocol config, liquidity balance. No exception |
| D2 | `doctor` against an uninitialized protocol | Reports "NOT initialized" rather than throwing |
| D3 | `collect` dry run | Simulates every due installment, sends nothing, reports the count |
| D4 | `collect` live | Lands a real transaction per due installment; loan state advances on chain |
| D5 | `collect` with nothing due | Reports 0 considered; sends nothing; exits 0 |
| D6 | `liquidate` | Only touches loans past grace; a loan that was repaid between read and send is reported as no longer liquidatable, not as an error |
| D7 | `subscriptions` | Charges only subscriptions whose `next_charge_at` has passed |
| D8 | Keeper pays fees | Keeper SOL decreases; keeper holds **no** USDC at any point |
| D9 | Error classification | A borrower with no funds classifies `insufficient_funds`, a revoked delegate `delegation_lost`, an exhausted one `delegation_exhausted` |

## E. Mobile app — real data, real browser

The app must read **live on-chain state**. Fixture data is a fail by definition.

| # | Item | Correct means |
|---|---|---|
| E1 | App loads | Renders without a console error or a failed network request |
| E2 | Credit screen — score | The score shown equals `CreditProfile.score` fetched from the chain |
| E3 | Credit screen — available | Equals `credit_limit − active_debt` computed from the fetched profile |
| E4 | Credit screen — limit breakdown | Score-derived base, collateral boost and owed all match chain state and sum correctly |
| E5 | Credit screen — next collection | Names the loan whose next installment is soonest, with the amount the program would collect |
| E6 | Plans — loan list | One card per `Loan` account on chain, no more, no fewer |
| E7 | Plans — schedule ladder | Dates equal `started_at + (i+1) * interval`; amounts equal the ceiling ladder; paid/due/upcoming states match `installments_paid` |
| E8 | Plans — outstanding | Equals `total_owed − total_repaid` |
| E9 | Plans — subscriptions tab | One row per `Subscription` account; next-charge date matches chain |
| E10 | Pay — quote | Interest and the four installments equal what `create_loan` would compute for the same input |
| E11 | Pay — over limit | Amount above available credit is refused visibly, and the reason is stated |
| E12 | Pay — mode switching | Each mode shows its own terms; state does not leak between them |
| E13 | Activity — feed | Rows come from real transaction signatures on chain |
| E14 | Activity — explorer link | Opens the correct cluster and signature |
| E15 | Empty state | With no loans, the empty state renders — not a crash or a blank screen |
| E16 | Navigation | All four tabs reachable; no console error on any transition |
| E17 | RPC failure | A dead RPC surfaces an error state, not a blank screen or a hang |
| E18 | Console + network | Zero errors across every screen |

## F. Lifecycle script

| # | Item | Correct means |
|---|---|---|
| F1 | Full run | Origination → 4 collections → repaid; then default → liquidation. Every number read back off chain |
| F2 | Re-run | Idempotent: reuses the existing protocol rather than failing on the second `initialize` |
| F3 | Fee assertion | Reports fees for the run within the 20% cap, distinguished from lifetime totals |

## G. Out of scope — recorded, not tested

| # | Item | Blocker |
|---|---|---|
| G1 | `apps/core` (5 pages, 5 API routes) | **PASS.** Stood up against a real local MongoDB, a public Sepolia RPC and the real deployed contracts recorded in `packages/contracts/deployments/sepolia.json`. `eth_getCode` confirms the LoanEngine is live. Pages render, five API routes verified, console clean |
| G2 | `apps/merchant` (4 pages, 7 API routes) | EVM build. Additionally needs `KEEPERHUB_API_KEY`, `POLARIS_STORE_API_KEY`, `SUPABASE_URL`/`SUPABASE_KEY` |
| G3 | `keeper/` (EVM) | Needs a KeeperHub organisation key |
| G4 | `packages/*` EVM packages | Same credential set |
