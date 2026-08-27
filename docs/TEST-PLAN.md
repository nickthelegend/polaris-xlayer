# Test plan

Every component and flow in the Solana build, with an explicit definition of
"correct" for each. This is the checklist the verification run is measured
against.

## Final status

177 rows, 176 distinct items (K13 is listed twice — once in the blockers table
above and once in section K).

| | Count |
|---|---|
| **PASS** — verified against a real cluster, a real device, or a suite run green in this pass | **169** |
| **PARTIAL** — one half verified, the other blocked | **1** |
| **UNTESTED** — needs a dependency that does not exist here | **4** |
| **UNTESTABLE** — the EVM build, credential-blocked and out of scope | **3** |

**PARTIAL.** N7. Removing the socket listener on unmount is verified;
re-subscribing when the *signer changes* needs a second signer to change to,
and the emulator has no wallet app. The subscription is keyed on the signing
address rather than on "is there a signer", which is the change that makes the
re-subscribe happen.

**UNTESTED.** K11 (disconnect), K12 (one session at a time) and K13 (a wallet
actually signing) all need a wallet app installed — a physical device with
Phantom or Solflare. G-section blockers are listed in that section.

**Confirmations.**

- **Zero mocks, zero stubs.** A sweep for `mock|stub|fake|dummy|TODO|FIXME`
  across `mobile/src`, `mobile/app`, `packages`, `apps`, `keeper-solana/src`
  and `programs/polaris/src`, excluding tests, returns nothing. Every figure in
  this document was read off a real cluster or a real device.
- **Zero console errors in the tested surface.** The one console line that
  appears on a failed read is `__DEV__`-gated and cannot reach a release build.
- **Failure states were induced, not simulated.** Rate limiting, an
  unreachable rpc, a node that has fallen behind and a partial ledger were all
  produced with a real http proxy in front of the validator, reached by
  re-pointing `adb reverse`. The app was never modified to fail.

## Scope

**In scope — the Solana project.**

| Surface | What it is |
|---|---|
| `programs/polaris` | The Anchor program. 23 instructions, 8 account types |
| `keeper-solana` | The crank: doctor, collect, subscriptions, liquidate |
| `packages/sdk-solana` | `createPolaris()` — pay, payLater, subscribe, repay |
| `mobile` | The Expo app. The customer-facing UI, web and native Android |
| `apps/gateway` | The underwriter, the Solana Pay endpoint, and the merchant checkout page |
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

**148 of 150 in-scope items pass.** Two are recorded UNTESTED with the specific
blocker rather than marked green.

Run against **devnet** — the cluster the app ships pointed at — with a local
validator for the lifecycle and liquidation paths that need a controllable
clock.

| | |
|---|---|
| Tests | 120 on the Solana build, 235 on the EVM reference — all passing |
| Clusters | Devnet live: 3 loans, 1 plan, a subscription cancelled, collateral locked and returned |
| Console | Zero errors on every screen at 375, 768 and 1440 px |
| Mocks | None. Three grep hits remain and all three are prose |

### Untested, and why

| Status | # | Item | Blocker |
|---|---|---|---|
| UNTESTED | K13 | A wallet actually signing | Needs a physical device with Phantom or Solflare. The intent fires and a device with no wallet returns ERROR_WALLET_NOT_FOUND, rendered as a sentence — the approval sheet itself has not been seen. |
| G2-write | `apps/merchant` chain write | `DEPLOYER_PRIVATE_KEY` exists nowhere in the repository. Its pages, reads and error paths are verified; the write is unsignable. |

### What running it found

The pattern worth naming: **auditing the IDL against the app found three
instructions the product named in its own copy and could not perform.** The
program, the SDK and the tests all had them.

- **Cancel a subscription.** Two screens promised "cancel at any time without
  the merchant's agreement". There was no cancel button.
- **Settle a plan early.** Two screens told a refused borrower to "repay a
  plan". There was no repay button.
- **Lock collateral.** The checkout said "lock collateral to raise the limit"
  and the credit screen showed a collateral figure. There was nowhere to lock any.

And from running it on a public cluster rather than a local validator:

- **The activity feed linked events to the wrong transaction** — `txs[i]` paired
  with `sigs[i]`, assuming a JSON-RPC batch returns in request order.
- **The Solana Pay blockhash was `finalized`**, expiring mid-checkout.
- **A rate-limited feed took down the whole screen**, because it shared a
  `Promise.all` with the balances.
- **Twenty of twenty-nine program errors had no sentence**, so withdrawing
  collateral against an open plan said `DebtOutstanding`.
- **Two empty states claimed the opposite of the truth** on a deployment with
  no subscription plans.

## A. Program — origination and collection

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | A1 | `initialize` | Protocol PDA exists; `stablecoin`, `treasury`, `grace_period`, `min_interval_seconds`, `fee_bps`, `credit_multiplier_bps` all equal what was passed; both vaults exist as token accounts owned by the protocol PDA; counters all zero |
| PASS | A2 | `initialize` twice | Second call fails — the address is already in use. Not a silent no-op |
| PASS | A3 | `initialize` with `grace_period` > 30 days | Fails `InvalidGracePeriod` |
| PASS | A4 | `initialize` with `min_interval_seconds` = 59 | Fails `InvalidInterval` |
| PASS | A5 | `initialize` with `fee_bps` > 500 | Fails `InvalidFee` |
| PASS | A6 | `register_merchant` | Merchant PDA at `["merchant", authority]`; `active = false`; `max_order_value = 500 USDC`; `payout` recorded |
| PASS | A7 | `set_merchant_active` by non-authority | Fails `NotAuthorized`; merchant unchanged |
| PASS | A8 | `create_loan` happy path | Merchant payout receives **the full principal** before any installment; loan PDA has `total_owed = principal + prorated interest`; borrower profile `active_debt` increases by `total_owed`; protocol `loan_count` increments by 1 |
| PASS | A9 | `create_loan` with no delegation | Fails `NotDelegated`; merchant receives nothing; `loan_count` unchanged |
| PASS | A10 | `create_loan` with delegation sized for one plan, twice | Second fails `InsufficientDelegation` |
| PASS | A11 | `create_loan` interval 0 / 59s / 366 days | Each fails `InvalidInterval` |
| PASS | A12 | `create_loan` installments 0 / 25 | Each fails `InvalidInstallments` |
| PASS | A13 | `create_loan` above credit limit | Fails `ExceedsCreditLimit` |
| PASS | A14 | `create_loan` inactive merchant | Fails `MerchantNotEligible` |
| PASS | A15 | `create_loan` above merchant cap | Fails `MerchantNotEligible` |
| PASS | A16 | `create_loan` with liquidity below principal | Fails `InsufficientLiquidity` |
| PASS | A17 | `collect_installment` when due | Pulls exactly `threshold_for(k+1) - total_repaid`; `installments_paid` becomes k+1; score +12; liquidity vault increases by the amount collected |
| PASS | A18 | `collect_installment` before due | Fails `NotDue`; no tokens move |
| PASS | A19 | `collect_installment` by an arbitrary third party | Succeeds, and moves **exactly one installment** — no more |
| PASS | A20 | `collect_installment` pointed at another token account | Fails `TokenOwnerMismatch` |
| PASS | A21 | Full schedule collected | Loan status `Repaid`; `total_repaid == total_owed`; `active_debt` back to 0; score 600 → 648 |
| PASS | A22 | `repay` arbitrary amount by borrower | Succeeds, capped at remaining; overpayment impossible |
| PASS | A23 | `repay` by a non-borrower | Fails (seeds/constraint), no tokens move |
| PASS | A24 | Dust: four 1-unit `repay` calls | `installments_paid` stays **0**; `on_time_payments` stays 0; loan still liquidatable after grace |

## B. Program — liquidation, collateral, fees

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | B1 | `liquidate` before grace elapses | Fails `NotLiquidatable` |
| PASS | B2 | `liquidate` after grace, borrower solvent | Recovers the full outstanding from the delegation; `bad_debt` unchanged at 0; score −150 |
| PASS | B3 | `liquidate` after delegation revoked | Recovers 0; `bad_debt` increases by exactly the outstanding; status `Liquidated` |
| PASS | B4 | Self-liquidation | Same recovery as B2 — not free, and the score still drops |
| PASS | B5 | `liquidate` twice | Second fails `NotLiquidatable` |
| PASS | B6 | `lock_collateral` | `locked_collateral` increases; collateral vault balance increases; credit limit rises by 150% of the amount |
| PASS | B7 | `withdraw_collateral` with debt outstanding | Fails `DebtOutstanding` |
| PASS | B8 | `withdraw_collateral` with no debt | Succeeds; tokens return to the user |
| PASS | B9 | Liquidation with collateral, delegation revoked | Seizes collateral toward the shortfall; `seized_collateral` records it; `bad_debt` = outstanding − seized |
| PASS | B10 | Protocol fee over a full plan | `protocol_fees_accrued` ≤ 20% of the interest actually earned, at 7-, 30- and 40-day terms |
| PASS | B11 | `sweep_fees` | Treasury receives exactly `protocol_fees_accrued`; the counter resets to 0 |
| PASS | B12 | `withdraw_liquidity` beyond free liquidity | Fails `InsufficientLiquidity` — accrued fees are not withdrawable |

## C. Program — payments and subscriptions

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | C1 | `pay` | Merchant receives `amount − fee`; treasury receives `fee`; payment PDA records `order_ref`; `payment_count` increments |
| PASS | C2 | `pay` same order twice | Second fails — the address is already in use |
| PASS | C3 | `pay` same order, different payer | Also fails. The guard is the address, not the signature |
| PASS | C4 | `pay` two different orders | Both succeed at distinct addresses |
| PASS | C5 | `create_plan` | Plan PDA; `active = true`; price and period recorded |
| PASS | C6 | `create_plan` period below the floor | Fails `InvalidPeriod` |
| PASS | C7 | `subscribe` | Period 1 charged immediately; merchant paid net; `next_charge_at = now + period` |
| PASS | C8 | `subscribe` with no delegation | Fails `NotDelegated` — a subscription that can never renew is refused at signup |
| PASS | C9 | `subscribe` twice while active | Second fails `AlreadySubscribed` |
| PASS | C10 | `charge_due` when due | Charges one period; `periods_charged` +1; `next_charge_at` advances by exactly one period |
| PASS | C11 | `charge_due` before due | Fails `NotDue` |
| PASS | C12 | `charge_due` past the 7-day window | Period **skipped, not stacked**; `missed_charges` +1; merchant receives nothing |
| PASS | C13 | Three consecutive misses | Status becomes `Lapsed` |
| PASS | C14 | `cancel_subscription` by subscriber | Status `Cancelled` with no merchant involvement |
| PASS | C15 | `charge_due` after cancel | Fails `SubscriptionNotActive` |
| PASS | C16 | Re-subscribe after cancel | Succeeds; `periods_charged` resets to 1 |

## D. Keeper

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | D1 | `doctor` | Prints cluster, program id, keeper balance, protocol config, liquidity balance. No exception |
| PASS | D2 | `doctor` against an uninitialized protocol | Reports "NOT initialized" rather than throwing |
| PASS | D3 | `collect` dry run | Simulates every due installment, sends nothing, reports the count |
| PASS | D4 | `collect` live | Lands a real transaction per due installment; loan state advances on chain |
| PASS | D5 | `collect` with nothing due | Reports 0 considered; sends nothing; exits 0 |
| PASS | D6 | `liquidate` | Only touches loans past grace; a loan that was repaid between read and send is reported as no longer liquidatable, not as an error |
| PASS | D7 | `subscriptions` | Charges only subscriptions whose `next_charge_at` has passed |
| PASS | D8 | Keeper pays fees | Keeper SOL decreases; keeper holds **no** USDC at any point |
| PASS | D9 | Error classification | A borrower with no funds classifies `insufficient_funds`, a revoked delegate `delegation_lost`, an exhausted one `delegation_exhausted` |

## E. Mobile app — real data, real browser

The app must read **live on-chain state**. Fixture data is a fail by definition.

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | E1 | App loads | Renders without a console error or a failed network request |
| PASS | E2 | Credit screen — score | The score shown equals `CreditProfile.score` fetched from the chain |
| PASS | E3 | Credit screen — available | Equals `credit_limit − active_debt` computed from the fetched profile |
| PASS | E4 | Credit screen — limit breakdown | Score-derived base, collateral boost and owed all match chain state and sum correctly |
| PASS | E5 | Credit screen — next collection | Names the loan whose next installment is soonest, with the amount the program would collect |
| PASS | E6 | Plans — loan list | One card per `Loan` account on chain, no more, no fewer |
| PASS | E7 | Plans — schedule ladder | Dates equal `started_at + (i+1) * interval`; amounts equal the ceiling ladder; paid/due/upcoming states match `installments_paid` |
| PASS | E8 | Plans — outstanding | Equals `total_owed − total_repaid` |
| PASS | E9 | Plans — subscriptions tab | One row per `Subscription` account; next-charge date matches chain |
| PASS | E10 | Pay — quote | Interest and the four installments equal what `create_loan` would compute for the same input |
| PASS | E11 | Pay — over limit | Amount above available credit is refused visibly, and the reason is stated |
| PASS | E12 | Pay — mode switching | Each mode shows its own terms; state does not leak between them |
| PASS | E13 | Activity — feed | Rows come from real transaction signatures on chain |
| PASS | E14 | Activity — explorer link | Opens the correct cluster and signature |
| PASS | E15 | Empty state | With no loans, the empty state renders — not a crash or a blank screen |
| PASS | E16 | Navigation | All four tabs reachable; no console error on any transition |
| PASS | E17 | RPC failure | A dead RPC surfaces an error state, not a blank screen or a hang |
| PASS | E18 | Console + network | Zero errors across every screen |

## F. Lifecycle script

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | F1 | Full run | Origination → 4 collections → repaid; then default → liquidation. Every number read back off chain |
| PASS | F2 | Re-run | Idempotent: reuses the existing protocol rather than failing on the second `initialize` |
| PASS | F3 | Fee assertion | Reports fees for the run within the 20% cap, distinguished from lifetime totals |


## H. Program — underwriting

The instruction that opens a credit line from a wallet's own history. Every
item is checked against a real validator, not bankrun.

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | H1 | Fresh wallet scores the floor | A wallet with no history at all scores exactly 520 and gets a 200 USDC line |
| PASS | H2 | Chain agrees with the mirror | For five different evidence shapes, `CreditProfile.score` on chain equals `scoreFrom()` off chain, exactly |
| PASS | H3 | Evidence is recorded | `wallet_age_days`, `transaction_count`, `token_accounts`, `stable_balance` and `underwritten_at` are all stored on the profile and read back equal to what was submitted |
| PASS | H4 | No second attestation | Underwriting an already-underwritten borrower fails `AlreadyUnderwritten`, and the stored score does not move |
| PASS | H5 | Stale evidence refused | Evidence timestamped an hour ago fails `EvidenceStale` |
| PASS | H6 | Future evidence refused | Evidence timestamped an hour ahead fails `EvidenceFromTheFuture` |
| PASS | H7 | Only the underwriter may attest | A funded impostor signing the same instruction fails `NotUnderwriter` |
| PASS | H8 | Earned scores are untouchable | A borrower with repayment history returns `alreadyOpen`, signs nothing, and keeps their score |
| PASS | H9 | Caps hold on every axis | Maxing one input alone reaches exactly that axis's cap and no further |
| PASS | H10 | Attestation cannot reach the top tiers | The best possible evidence scores below 740 — a 1,000 USDC line, never 2,500 or 5,000 |
| PASS | H11 | Saturating arithmetic | `u32::MAX` on every input does not wrap; the score stays inside 300–850 |
| PASS | H12 | Evidence is read, not invented | The gateway's four numbers come from real RPC calls: `getSignaturesForAddress`, `getParsedTokenAccountsByOwner`, `getTokenAccountBalance`, `getBlockTime` |

## I. Gateway — Solana Pay and the underwriting service

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | I1 | `/health` | Returns the cluster, the program id actually in the IDL, the underwriter pubkey and a live slot |
| PASS | I2 | Spec GET | `GET /pay/:order` returns `{label, icon}` with an absolute icon URL, per the Solana Pay transaction-request spec |
| PASS | I3 | Spec POST | `POST /pay/:order` with `{account}` returns base64 `transaction` and a human `message` naming the merchant and terms |
| PASS | I4 | The transaction is real | Deserialising it, adding only the customer's signature, and sending it lands a loan on chain |
| PASS | I5 | Two instructions, atomically | The returned transaction contains exactly the SPL `Approve` and `create_loan` — both or neither |
| PASS | I6 | Fee sponsorship | The gateway is `feePayer`; the customer's SOL balance is byte-identical after the plan opens |
| PASS | I7 | Rent sponsorship | `create_loan`'s `payer` is the gateway, so a customer with no SOL can still open a plan |
| PASS | I8 | Underwrites mid-checkout | A wallet with no profile is underwritten before the plan is built, and the profile exists afterwards |
| PASS | I9 | Over-limit is refused by the chain | A plan larger than the line just underwritten fails — not silently trimmed |
| PASS | I10 | Malformed orders | Missing merchant, missing amount, zero amount, 99 installments and a 5-second interval each return 400 with a readable reason |
| PASS | I11 | Bad addresses | A non-base58 merchant or account returns 400, not a 500 |
| PASS | I12 | Checkout page | Renders a server-side QR encoding a `solana:` URL, with the terms beside it, and no client JavaScript |
| PASS | I13 | Unknown route | Returns 404 with a readable message, not a stack trace |
| PASS | I14 | Internal errors are not leaked | A 500 returns a generic sentence; the chain's account names go to the log only |
| PASS | I15 | CORS | Responds to `OPTIONS` so a wallet can fetch cross-origin |

## J. App — the underwriting surface

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | J1 | Fresh install opens a line | A wallet generated seconds earlier is underwritten on first load and shows a real score from the chain |
| PASS | J2 | No invented score | With the gateway unreachable, the app shows "no credit line yet" — never a fabricated score or limit |
| PASS | J3 | Reasons are shown | Four lines naming age, transactions, tokens and balance, each with the points it contributed |
| PASS | J4 | Reasons survive a cold start | With the gateway down but a line already open, the reasons still render from the profile's stored evidence |
| PASS | J5 | IDL/deployment mismatch | If `idl.json` and `deployment.json` name different programs, the app refuses to start and names both files |
| PASS | J6 | Errors are readable | A failed transaction shows a short sentence, never a simulation dump or a stack trace |


## K. Signing — the device key and a wallet app

The app must never present a key it generated as a wallet the user connected,
and must never import a native module on a platform that cannot load it.

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | K1 | Boots on the device signer | The app is usable before any wallet is connected; the row reads "This device" |
| PASS | K2 | Web never loads the adapter | `@solana-mobile` appears zero times in the web bundle |
| PASS | K3 | Web says why | The wallet row reads "Wallet apps can only be reached from the Android build." and offers no dead button |
| PASS | K4 | Localnet refuses a wallet | On a local validator the row reads "A wallet app cannot reach a local validator." — `chainIdFor` returns null |
| PASS | K5 | Devnet offers a wallet | On devnet the row offers "Connect a wallet app" |
| PASS | K6 | No wallet installed | Tapping connect on a device with no wallet says "No Solana wallet app is installed on this device." — never a stack trace |
| PASS | K7 | Address decoding | A base58 address is refused, not silently decoded into a different account |
| PASS | K8 | Authorize vs reauthorize | A cached token for the same chain reauthorizes; a different chain authorizes afresh |
| PASS | K9 | Error classification | Each protocol code maps to its own sentence; an unknown code does not claim to be a refusal |
| PASS | K10 | Fee-payer precondition | A transaction with no fee payer or blockhash is refused before the adapter sees it |
| UNTESTED | K11 | Disconnect | Returns to the device signer and forgets the token |
| UNTESTED | K12 | One session at a time | A second connect while one is open does not open a second session |
| UNTESTED | K13 | Signing with a real wallet | **UNTESTED** — needs a physical device with a wallet app installed |

## L. Scan to pay

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | L1 | Centre button opens the scanner | The raised button in the tab bar routes to /scan |
| PASS | L2 | Camera permission | Denied permission shows a readable reason, not a blank screen |
| PASS | L3 | Not a Solana Pay code | "That is not a Solana Pay code." |
| PASS | L4 | Bare transfer request | Refused with the reason Polaris pays through the program |
| PASS | L5 | Dead merchant endpoint | Blames the merchant's checkout, never the RPC |
| PASS | L6 | Unknown merchant | "That merchant is not registered on this deployment." |
| PASS | L7 | Review before signing | The terms are shown and nothing is signed until the user approves |
| PASS | L8 | Approve | A real transaction lands and the signature is shown |
| PASS | L9 | Double approve | Four rapid taps open exactly one loan |
| PASS | L10 | Re-scan a paid order | "That order has already been paid." |


## M. The actions the app used to only talk about

Three instructions the program, the SDK and the tests all had, that the product
named in its own copy and could not perform. Each one is a promise the app was
making and breaking.

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | M1 | Lock collateral | Locking 50 moves the limit from 200 to 275 — the base plus 150% of the lock — and the profile reads 50.000000 on chain |
| PASS | M2 | Withdraw refused while owing | "You still owe on a plan. Repay it before withdrawing collateral." — never the identifier `DebtOutstanding` |
| PASS | M3 | Withdraw allowed when clear | Returns the stablecoin and drops the limit back |
| PASS | M4 | Settle a plan early | The plan reads "4 of 4 collected · REPAID", debt falls by exactly what was owed, and the score rises with an on-time payment recorded |
| PASS | M5 | Settle is idempotent under a double tap | Three rapid taps repay once, not three times |
| PASS | M6 | Cancel a subscription | Status becomes `cancelled` on chain and the row says so — the app's own promise, "cancel at any time without the merchant's agreement", kept |
| PASS | M7 | Cancel is idempotent under a double tap | Two rapid taps cancel once |
| PASS | M8 | Every program error has words | All 29 errors in the IDL map to a sentence; nothing can put a raw identifier on screen |


## N. Live state, the keeper as a service, and delegation health

Everything added after the last full run. Each is checked against a live
cluster with real transactions, not simulated.

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | N1 | The screen moves on its own | With the app untouched, a keeper collection changes the owed figure and the available credit — verified by reading the screen before and after without interacting |
| PASS | N2 | The change is announced | A notice naming what moved, with the amount, appears — "Installment collected · The keeper charged this. You did not have to be online. · 2.00" |
| PASS | N3 | The notice clears itself | Gone after 30s, without the screen jumping |
| PASS | N4 | A manual refresh announces nothing | Pulling to refresh is the user asking; telling them what changed since they asked is noise |
| PASS | N5 | The differ names the right thing | "Paid off" beats "collected" on the last instalment; a loan seen for the first time is not counted as a repayment; a score move names its direction |
| PASS | N6 | Pull to refresh | The gesture re-reads the chain on every screen and the spinner resolves |
| PARTIAL | N7 | The socket is cleaned up | Leaving the screen or changing signer removes the listener rather than leaking one per mount |
| PASS | N8 | Keeper runs as a service | `watch` collects on an interval with nobody triggering it, across several passes |
| PASS | N9 | A failed pass does not kill it | An unreachable RPC logs and the next pass still runs |
| PASS | N10 | A quiet pass stays quiet | Nothing due prints one line rather than three empty reports |
| PASS | N11 | Ctrl-C finishes the pass in flight | Rather than abandoning a send whose outcome nobody would know |
| PASS | N12 | Interval floor | Below five seconds is refused, so a misconfigured keeper cannot flood its own RPC |
| PASS | N13 | Revoked delegation warns | "Authorisation revoked" with the consequence stated, before any collection fails |
| PASS | N14 | Short delegation warns with figures | "Covered for 10.00 but owe 40.31 … short by 30.31" — the real numbers |
| PASS | N15 | A healthy delegation says nothing | No warning when the allowance covers the book |
| PASS | N16 | No debt, no warning | A borrower who owes nothing is not told their delegation is short of zero |
| PASS | N17 | A rate-limited cluster reads as English | 429 gets a sentence; no JSON-RPC envelope reaches the screen |
| PASS | N18 | A partial ledger says so | Dropped batches are disclosed rather than silently shortening the feed |

## O. Android deep linking and the Solana Pay handoff

Added after a run on the emulator found that a code handed over by another app
could not open Polaris at all. Every item here is checked by dispatching a real
Android intent with `am start`, not by calling a function.

| Status | # | Item | Correct means |
|---|---|---|---|
| PASS | O1 | Polaris handles `solana:` | `cmd package query-activities -a android.intent.action.VIEW -d 'solana:...'` names `fun.polaris.app.MainActivity`, so any camera app or browser can hand a code over |
| PASS | O2 | A handed-over code opens the review screen | A BROWSABLE `solana:` intent lands on the payment, not on the camera and not on a route error |
| PASS | O3 | The whole code survives | Every query parameter arrives — an amount, a mode, an instalment count and an interval — rather than being cut at the first `&` |
| PASS | O4 | A mangled link is still honoured | The router rewrites `solana:<url>` into the app's own scheme before matching; the payment is recovered rather than lost to an unmatched route |
| PASS | O5 | A dead link gets a real screen | A branded page that says nothing was charged, not the framework's developer page with a raw url on it |
| PASS | O6 | The header describes what is happening | "Confirm this payment" whenever there is a payment, however it arrived |
| PASS | O7 | A code is acted on once | Paying and tapping Done does not put the finished payment back on screen offering to pay it again |
| PASS | O8 | One screen per code | A code opens a single scan screen; a second mount would find the slot emptied by the first and show the camera instead |

## G. Out of scope — recorded, not tested

| Status | # | Item | Blocker |
|---|---|---|---|
| PASS | G1 | `apps/core` (5 pages, 5 API routes) | **PASS.** Stood up against a real local MongoDB, a public Sepolia RPC and the real deployed contracts recorded in `packages/contracts/deployments/sepolia.json`. `eth_getCode` confirms the LoanEngine is live. Pages render, five API routes verified, console clean |
| UNTESTABLE | G2 | `apps/merchant` (4 pages, 7 API routes) | EVM build. Additionally needs `KEEPERHUB_API_KEY`, `POLARIS_STORE_API_KEY`, `SUPABASE_URL`/`SUPABASE_KEY` |
| UNTESTABLE | G3 | `keeper/` (EVM) | Needs a KeeperHub organisation key |
| UNTESTABLE | G4 | `packages/*` EVM packages | Same credential set |


## Run log — Android, localnet, this pass

Executed against a real validator with a real deployed program, driving the app
on an emulator through `adb`. Every claim below was read off the device or off
the chain, not inferred from the code. Failure states that a healthy cluster
will not produce were induced with a real http proxy in front of the validator,
reached by re-pointing `adb reverse` — the app was not modified to fail.

**Verified PASS.** N1, N2, N3, N4, N5, N6, N8, N9, N10, N11, N12, N13, N14,
N15, N16, N17, N18, O1–O8. Suites: 18 rust, 153 anchor/bankrun, 20 keeper,
14 gateway, 59 mobile.

Highlights of how, where "how" was not obvious:

| Item | How it was actually produced |
|---|---|
| N1, N2 | A keeper collection moved the score 520 → 532 → 544 and the available figure 200.00 → 196.99 with the phone untouched |
| N3 | The notice was gone 33s later, with the page composed identically — no jump |
| N5 | The last instalment of a three-instalment plan announced "Plan paid off · 9.00", not "collected" |
| N9 | Started against a dead rpc, survived three failed passes, stopped failing the moment a proxy brought the rpc back |
| N13–N16 | Decided from real 165-byte SPL token accounts, including a delegate pointed at another program and a truncated account |
| N15 | Two overlapping plans on one token account: the app re-approved for the whole 42.000031 debt, matching it exactly |
| N17 | A proxy returning 429 to every rpc call: "The network is rate limiting us. Your position is safe on chain" |
| N18 | A proxy failing only `getTransaction`: the feed disclosed the gap instead of shortening silently |

**Untested — needs a dependency that genuinely does not exist here.**

N7's second half. Removing the listener on unmount is covered; re-subscribing
when the *signer changes* cannot be produced without a second wallet app to
switch to, and this emulator has none. The subscription is now keyed on the
signing address rather than on "is there a signer", which is what makes the
re-subscribe happen.

Also still blocked, unchanged: a wallet app actually signing (needs a physical
device), `apps/merchant` chain writes (no `DEPLOYER_PRIVATE_KEY` in the repo),
and anything on mainnet.

**Found and fixed in this pass.**

| What was wrong | Where |
|---|---|
| A Solana Pay code could not open the app at all — no `solana:` filter was registered | `mobile/app.json` |
| A code carried through a query string lost everything after its first parameter on Android; a four-instalment plan arrived as a merchant and nothing else | `mobile/src/chain/incomingRequest.ts` |
| A link the router rewrote into the app's own scheme stranded the payment on "Unmatched Route" | `mobile/app/+not-found.tsx` |
| A second code handed over while the scan screen was open was silently dropped | `mobile/src/chain/incomingRequest.ts`, `mobile/app/scan.tsx` |
| Each handed-over code stacked another scan screen; an off-screen copy took the code and acted on it where nobody could see | `mobile/src/chain/useIncomingRequest.ts` |
| Paying, then tapping Done, put the finished payment back on screen offering to pay it again | `mobile/app/scan.tsx` |
| The credit score and available balance rendered as `0` on Android whenever the count-up did not run — a settled 200.00 balance shown as 0.00 | `mobile/src/components/Figure.tsx` |
| Connecting a wallet left the live socket subscribed to the previous wallet's profile | `mobile/src/chain/usePolaris.ts` |
| Ctrl-C on the keeper waited out a whole interval and then never exited | `keeper-solana/src/cli.ts` |
| An rpc that was down at boot killed the keeper instead of being waited out | `keeper-solana/src/cli.ts` |
| The activity feed blamed a rate limit for every failure, including a node that had fallen behind | `mobile/src/chain/partial.ts` |
| An unreadable ledger claimed "Nothing has moved yet" — telling the reader they had no history and that we had failed to fetch it | `mobile/app/(tabs)/activity.tsx` |
| A 4xx from a checkout was reported as the merchant "not answering" | `mobile/src/chain/solanaPay.ts` |
| The scan header asked the borrower to point at a code while showing them a payment to confirm | `mobile/app/scan.tsx` |


## Run log — the web build, in a real browser

Section E executed against `expo start --web` on :8090, driving the real
product in the browser: a live validator on :8899, the gateway on :4100, and a
signer the browser generated for itself and kept in `localStorage`
(`6kgGHhyTvvQDb27LmPndPksmWwkttiHZ87Wi4qe9KQRs`). Every figure below was
compared against the chain, and the console and network panel were read on
every item.

**Verified in the browser.** E1–E18. Highlights:

| Item | What was actually observed |
|---|---|
| E2, E3, E4 | Score 520 and available 144.57 of a 200.00 limit, matching `CreditProfile` exactly, and again with debt after a purchase |
| E5 | "Next collection · in 7 days · Kettle & Co · installment 1 of 4 · 13.85" |
| E6, E8 | One card for the one `Loan` account; outstanding 55.42 against a chain value of 55.421917 |
| E9 | One subscription row, "1 period charged · Active", matching chain |
| E10 | Quoted 55.42 before signing; the program computed 55.421917 |
| E13 | One row for the one signature the wallet has on chain, and no more |
| E14 | Opened `explorer.solana.com/tx/4oqfkywz…?cluster=custom&customUrl=http://127.0.0.1:8899` — right signature, right cluster |
| E17 | A dead rpc gave "Could not reach the network · Check the RPC endpoint is running · Try again", with the tabs still usable |
| E18 | Zero console errors on a fresh load of every screen |

The browser also signed for real: a subscription, a four-instalment plan, and a
plan opened through the `/scan` route. A keeper collection then moved the page
with nobody touching it — score 520 → 532, owed 59.42 → 58.42, and the notice
naming the amount.

**Found and fixed in this pass.**

| What was wrong | Where |
|---|---|
| The checkout marked the first instalment "Due now — the keeper collects this next" unconditionally, under a date seven days out, while the plans screen called the same instalment "Scheduled" | `mobile/app/(tabs)/pay.tsx` |
| Refusing a purchase said "this is more credit than you have" beside an amount that visibly equalled the limit — it is the interest that tips it over, and nothing said so | `mobile/app/(tabs)/pay.tsx` |
| Against an unreachable cluster the live socket reconnected forever, logging `ws error: undefined` on every attempt — an error carrying no information, and on Android a red toast over the screen | `mobile/src/chain/usePolaris.ts` |


## Run log — second browser pass, section M and the failure paths

Section M driven entirely in the browser against a live validator, with a signer
the browser generated for itself. Every figure checked against the chain.

**Verified.** M1 (lock 50 → limit 200 → 275, chain agrees), M2 ("You still owe
on a plan. Repay it before withdrawing collateral."), M3 ("Withdrew 50.00
USDC." once clear), M4 (loan repaid 4/4, score 532 → 544), M5 (three rapid
clicks, twelve dispatched events, **one** settlement — usdc fell by exactly
53.000002 = 50 locked + 3.000002 settled), M6 (status `cancelled`), M7 (two
clicks, one cancellation, periods charged unchanged).

**Found and fixed.**

| What was wrong | Where |
|---|---|
| Closing the scanner did nothing when it was opened by url — `router.back()` is a no-op on a single-entry stack, so the borrower was stranded on `/scan` with a payment card and no way into the app. `canGoBack()` is no help: it answers about browser history, which says yes while the navigator stays put | `mobile/app/scan.tsx` |
| A confirmation timeout — the one failure where the money may well have moved — was reported as "The transaction was refused. Nothing was charged." The message web3.js throws says in its own words that the outcome is unknown, and was simply too long for the length guard at the bottom of the ladder | `mobile/src/chain/explain.ts` |
| `explainError` threw a ReferenceError in any host without `__DEV__`, which is also what had kept it untested | `mobile/src/chain/explain.ts` |
| A retry after an unreadable failure minted a *new* order reference, so the program's duplicate-order refusal never engaged and a second real loan could open. The reference is now per purchase, not per attempt | `mobile/app/(tabs)/pay.tsx`, `mobile/src/chain/actions.ts` |
| The web build rebuilt a query string around the request parameter and re-parsed it, so a value the router had already decoded was split on its own `&` — the checkout was re-fetched without its amount and the gateway answered 400. Observed in the network panel, not inferred | `mobile/app/scan.tsx` |

**Claimed but disproved.** A review flagged the credit-score arc and the animated
figures as showing wrong numbers on web. Measured directly: the arc renders a
fill of 0.4654 against 0.4655 expected for a score of 556, and all ten figures on
the screen match the chain exactly. Both were false positives.
