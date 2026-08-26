# Test plan

Every component and flow in the Solana build, with an explicit definition of
"correct" for each. This is the checklist the verification run is measured
against.

## Scope

**In scope — the Solana project.**

| Surface | What it is |
|---|---|
| `programs/polaris` | The Anchor program. 23 instructions, 7 account types |
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

**117 of 119 in-scope items pass.** A (24) B (12) C (16) D (9) E (18) F (3)
H (12) I (15) J (6), plus G1. Two are recorded UNTESTED with the specific
blocker rather than marked green.

| | |
|---|---|
| Tests | 98 on the Solana build, 308 on the EVM reference — all passing |
| Clusters | Devnet **live**; a local validator for the lifecycle and liquidation |
| Console | Zero errors across every screen at 375, 768 and 1280 px |
| Mocks | None. Every grep hit for mock/stub/TODO is a comment explaining why something is *not* fake |

### Untested, and why

| # | Item | Blocker |
|---|---|---|
| J-MWA | Mobile Wallet Adapter | Needs a wallet app on a physical Android device. The emulator will not boot on this host — it wants 5.1 GB and there is 3.9 GB free, so it falls back to software GL and hangs the QEMU main loop. Shipping unverified signing code into a payments app is worse than the honest gap. |
| E-Android | Android re-verification at HEAD | Same emulator blocker. It was verified earlier in the session against an earlier commit; the only mobile file changed since is `usePolaris.ts`, which was re-verified in the browser. |

### What running it actually found

Nothing in this list came from reading code.

- **The same Solana Pay code, scanned twice, opened two loans.** 11 → 12 → 13
  for one basket. `pay` was never vulnerable — its payment account is seeded by
  (merchant, order). Plans had no equivalent guard. Now they do, and the
  re-test reads 3 → 4 → 4.
- **The checkout opened on a hardcoded 240** against a 200 limit, so every new
  user's first action was a refusal.
- **A dead merchant endpoint blamed the RPC**, sending the reader to debug the
  wrong machine.
- **Four rapid taps on Approve ran approve four times** — React state is not a
  lock.
- **The tab bar hugged the left edge** on anything wider than a phone.
- **An unregistered merchant returned a 500** — "something went wrong on our
  side" when it had not.
- **`prove.ts` could not prove a fresh deployment**: it fetched the protocol
  account immediately and died on a program that had just been deployed.
- **`packages/mcp` did not build** — it imported a workspace package it never
  declared.
- **`healthReport` reported a 100% collection rate over an empty book**, and
  the landing page printed it under the words "read from the live book".

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


## H. Program — underwriting

The instruction that opens a credit line from a wallet's own history. Every
item is checked against a real validator, not bankrun.

| # | Item | Correct means |
|---|---|---|
| H1 | Fresh wallet scores the floor | A wallet with no history at all scores exactly 520 and gets a 200 USDC line |
| H2 | Chain agrees with the mirror | For five different evidence shapes, `CreditProfile.score` on chain equals `scoreFrom()` off chain, exactly |
| H3 | Evidence is recorded | `wallet_age_days`, `transaction_count`, `token_accounts`, `stable_balance` and `underwritten_at` are all stored on the profile and read back equal to what was submitted |
| H4 | No second attestation | Underwriting an already-underwritten borrower fails `AlreadyUnderwritten`, and the stored score does not move |
| H5 | Stale evidence refused | Evidence timestamped an hour ago fails `EvidenceStale` |
| H6 | Future evidence refused | Evidence timestamped an hour ahead fails `EvidenceFromTheFuture` |
| H7 | Only the underwriter may attest | A funded impostor signing the same instruction fails `NotUnderwriter` |
| H8 | Earned scores are untouchable | A borrower with repayment history returns `alreadyOpen`, signs nothing, and keeps their score |
| H9 | Caps hold on every axis | Maxing one input alone reaches exactly that axis's cap and no further |
| H10 | Attestation cannot reach the top tiers | The best possible evidence scores below 740 — a 1,000 USDC line, never 2,500 or 5,000 |
| H11 | Saturating arithmetic | `u32::MAX` on every input does not wrap; the score stays inside 300–850 |
| H12 | Evidence is read, not invented | The gateway's four numbers come from real RPC calls: `getSignaturesForAddress`, `getParsedTokenAccountsByOwner`, `getTokenAccountBalance`, `getBlockTime` |

## I. Gateway — Solana Pay and the underwriting service

| # | Item | Correct means |
|---|---|---|
| I1 | `/health` | Returns the cluster, the program id actually in the IDL, the underwriter pubkey and a live slot |
| I2 | Spec GET | `GET /pay/:order` returns `{label, icon}` with an absolute icon URL, per the Solana Pay transaction-request spec |
| I3 | Spec POST | `POST /pay/:order` with `{account}` returns base64 `transaction` and a human `message` naming the merchant and terms |
| I4 | The transaction is real | Deserialising it, adding only the customer's signature, and sending it lands a loan on chain |
| I5 | Two instructions, atomically | The returned transaction contains exactly the SPL `Approve` and `create_loan` — both or neither |
| I6 | Fee sponsorship | The gateway is `feePayer`; the customer's SOL balance is byte-identical after the plan opens |
| I7 | Rent sponsorship | `create_loan`'s `payer` is the gateway, so a customer with no SOL can still open a plan |
| I8 | Underwrites mid-checkout | A wallet with no profile is underwritten before the plan is built, and the profile exists afterwards |
| I9 | Over-limit is refused by the chain | A plan larger than the line just underwritten fails — not silently trimmed |
| I10 | Malformed orders | Missing merchant, missing amount, zero amount, 99 installments and a 5-second interval each return 400 with a readable reason |
| I11 | Bad addresses | A non-base58 merchant or account returns 400, not a 500 |
| I12 | Checkout page | Renders a server-side QR encoding a `solana:` URL, with the terms beside it, and no client JavaScript |
| I13 | Unknown route | Returns 404 with a readable message, not a stack trace |
| I14 | Internal errors are not leaked | A 500 returns a generic sentence; the chain's account names go to the log only |
| I15 | CORS | Responds to `OPTIONS` so a wallet can fetch cross-origin |

## J. App — the underwriting surface

| # | Item | Correct means |
|---|---|---|
| J1 | Fresh install opens a line | A wallet generated seconds earlier is underwritten on first load and shows a real score from the chain |
| J2 | No invented score | With the gateway unreachable, the app shows "no credit line yet" — never a fabricated score or limit |
| J3 | Reasons are shown | Four lines naming age, transactions, tokens and balance, each with the points it contributed |
| J4 | Reasons survive a cold start | With the gateway down but a line already open, the reasons still render from the profile's stored evidence |
| J5 | IDL/deployment mismatch | If `idl.json` and `deployment.json` name different programs, the app refuses to start and names both files |
| J6 | Errors are readable | A failed transaction shows a short sentence, never a simulation dump or a stack trace |


## K. Signing — the device key and a wallet app

The app must never present a key it generated as a wallet the user connected,
and must never import a native module on a platform that cannot load it.

| # | Item | Correct means |
|---|---|---|
| K1 | Boots on the device signer | The app is usable before any wallet is connected; the row reads "This device" |
| K2 | Web never loads the adapter | `@solana-mobile` appears zero times in the web bundle |
| K3 | Web says why | The wallet row reads "Wallet apps can only be reached from the Android build." and offers no dead button |
| K4 | Localnet refuses a wallet | On a local validator the row reads "A wallet app cannot reach a local validator." — `chainIdFor` returns null |
| K5 | Devnet offers a wallet | On devnet the row offers "Connect a wallet app" |
| K6 | No wallet installed | Tapping connect on a device with no wallet says "No Solana wallet app is installed on this device." — never a stack trace |
| K7 | Address decoding | A base58 address is refused, not silently decoded into a different account |
| K8 | Authorize vs reauthorize | A cached token for the same chain reauthorizes; a different chain authorizes afresh |
| K9 | Error classification | Each protocol code maps to its own sentence; an unknown code does not claim to be a refusal |
| K10 | Fee-payer precondition | A transaction with no fee payer or blockhash is refused before the adapter sees it |
| K11 | Disconnect | Returns to the device signer and forgets the token |
| K12 | One session at a time | A second connect while one is open does not open a second session |
| K13 | Signing with a real wallet | **UNTESTED** — needs a physical device with a wallet app installed |

## L. Scan to pay

| # | Item | Correct means |
|---|---|---|
| L1 | Centre button opens the scanner | The raised button in the tab bar routes to /scan |
| L2 | Camera permission | Denied permission shows a readable reason, not a blank screen |
| L3 | Not a Solana Pay code | "That is not a Solana Pay code." |
| L4 | Bare transfer request | Refused with the reason Polaris pays through the program |
| L5 | Dead merchant endpoint | Blames the merchant's checkout, never the RPC |
| L6 | Unknown merchant | "That merchant is not registered on this deployment." |
| L7 | Review before signing | The terms are shown and nothing is signed until the user approves |
| L8 | Approve | A real transaction lands and the signature is shown |
| L9 | Double approve | Four rapid taps open exactly one loan |
| L10 | Re-scan a paid order | "That order has already been paid." |

## G. Out of scope — recorded, not tested

| # | Item | Blocker |
|---|---|---|
| G1 | `apps/core` (5 pages, 5 API routes) | **PASS.** Stood up against a real local MongoDB, a public Sepolia RPC and the real deployed contracts recorded in `packages/contracts/deployments/sepolia.json`. `eth_getCode` confirms the LoanEngine is live. Pages render, five API routes verified, console clean |
| G2 | `apps/merchant` (4 pages, 7 API routes) | EVM build. Additionally needs `KEEPERHUB_API_KEY`, `POLARIS_STORE_API_KEY`, `SUPABASE_URL`/`SUPABASE_KEY` |
| G3 | `keeper/` (EVM) | Needs a KeeperHub organisation key |
| G4 | `packages/*` EVM packages | Same credential set |
