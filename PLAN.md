# Polaris on X Layer — build plan

**Written:** 3 September 2026. Supersedes the previous plan, kept at
`docs/PLAN-previous.md`. Every status below was checked against the running
product, the deployed contracts and the public repository — not against the
last plan's claims.

## Where this actually stands

| | |
|---|---|
| Live | https://polaris-xlayer.vercel.app |
| Repo | https://github.com/nickthelegend/polaris-xlayer — `main` matches what is deployed |
| Chain | X Layer testnet, **1952** |
| Engine | `0xb649453f78b01F832d97fDD8a12Bf27ac5abf446` |
| Pool / Oracle | `0x8a9b94F94aa8254e43B5b0e923B4F12FAE6Fc56C` / `0x926cDFa64B6bF592DD73e71a1d915624f0FaF6FE` |
| tXAAPL / pUSDC | `0x5B74fdfE5943cC84Fe46f9a783b9AB9a2fD2Bec9` / `0x437D8039EaB3b8BbEDc4101Bc97f6812829816D6` |
| BNPL engine / scores | `0x06Ca46f78DB8712b5c698375B0fFf897165e67d2` / `0x8b484257281EF42a9468f9271872Bd76fE399133` |
| Relayer | Railway service `price-relayer`, posting every 240s |
| Tests | 356 passing, 0 failing (`pnpm test`) |
| Invariants | `pnpm verify:live` — all hold against the deployed contracts |
| Build | `pnpm build`, `pnpm typecheck` — exit 0 |

The checkout works end to end with a real wallet: shares lock, the merchant is
paid from the pool, repayment returns every share. That is proven on chain, not
asserted.

---

## 1. Goals — what "done" and "winning" mean here

**Done** — five things, none of which are true of a demo that merely runs:

1. A stranger with a wallet and no context can pay a merchant against their
   stock and get their shares back, without being told how.
2. Every number the product shows can be checked by the person reading it —
   against the chain, the venue, or the source.
3. Nothing in the tree is mocked, stubbed, or standing in for a real thing
   except where the network genuinely lacks it, and those are named on the page.
4. The repository a reviewer clones is the product they just used.
5. The failure paths are as finished as the success path — no gas, no shares,
   stale price, wrong chain, sequencer down.

**Winning** is a narrower thing, and this project's odds turn almost entirely
on one unresolved question (G1 below):

6. **The track is satisfied.** X Layer's Build X lists AI as a *qualification*,
   requires a mainnet launch, and closed 21 Aug 2026. If that is the event,
   items 1–5 are irrelevant. This is the single highest-value open question in
   the project and it cannot be answered from inside the repo.
7. A judge with five minutes reaches "shares locked, merchant paid, position
   kept" without reading documentation, and can verify the contract work when
   they go looking for it.
8. The contract engineering is legible: partial liquidation, two staleness
   bounds, the sequencer guard, the adversarial audit, 201 contract tests.

---

## 2. Phases

Ordered by what unblocks what. Phase 0 gates everything about winning; phases
1–3 are the product; 4–6 are how it is judged.

### PHASE 0 — Resolve the track  ·  **BLOCKED on a human decision**

- **0.1 — BLOCKED** — Establish which event this is entering. Build X
  (https://www.okx.com/en-us/xlayer/build-x-hackathon) requires AI in the
  product, a mainnet launch, and closed 21 Aug 2026. The brief in this repo
  says "OKX Dev Day", which may be a later event with different rules. Nobody
  inside the repo can settle this. **Everything in 0.2–0.4 is conditional on
  the answer.**
- **0.2 — NOT STARTED, conditional** — If AI is required: design one honest AI
  component that does real work rather than decoration. The defensible option
  is underwriting — `packages/underwriting` already scores addresses from
  on-chain history and has 20 passing tests; an AI layer that explains or
  adjusts the limit from wallet behaviour would be a genuine feature, not a
  bolted-on chatbot. Do not ship a chat widget to tick a box.
- **0.3 — NOT STARTED, conditional** — If mainnet is required: deploy to X
  Layer mainnet (chain 196). **Spends real money — needs explicit approval.**
  Blockers to resolve first: real USDT0 is at
  `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` (6 decimals, symbol `USD₮0`
  with U+20AE, not ASCII T), there is no real xStock on X Layer, and the pool
  needs real stablecoin to pay merchants from.
- **0.4 — NOT STARTED, conditional** — If required: create the project X
  account, post, and mention @XLayerOfficial.

### PHASE 1 — Correctness of what is claimed  ·  mostly DONE

- **1.1 — DONE** — Wallet-signed writes. Every state change is signed by the
  connected wallet; no server key signs on a user's behalf.
- **1.2 — DONE** — X Layer chain config, `wallet_addEthereumChain`, chain 1952.
- **1.3 — DONE** — Custom errors decoded to sentences (19 mapped in
  `apps/core/lib/polaris-client.ts`).
- **1.4 — DONE** — Read-lag handled: X Layer serves pre-transaction state after
  a receipt; `waitForAllowance` and timed re-reads cover it.
- **1.5 — DONE** — 100-block log cap handled by paging `queryFilter`.
- **1.6 — DONE** — Quote refuses shares the wallet does not hold.
- **1.7 — DONE** — No-gas failure names OKB and links the faucet.
- **1.8 — NOT STARTED** — **The footer says `SEPOLIA` on every page of the live
  site** (`apps/core/components/footer.tsx:32`). Replace with the active chain
  read from `ACTIVE_CHAIN` in `apps/core/lib/chains.ts` so it cannot drift
  again. Blocks goal 2 and goal 5.
- **1.9 — DONE** — The dot reads `/api/stock/health` on a 60s interval and is
  grey until that answers: green healthy, amber degraded, red unreachable, with
  the reason in its `title`. Verified live: *"RPC, price and liquidity all
  healthy"*.

### PHASE 2 — The product is one product  ·  DONE

- **2.1 — DONE** — Stock credit and the credit line merged into one checkout;
  nav is Pay · Activity · Get paid · Docs.
- **2.2 — DONE** — Old paths are permanent 308 redirects in `next.config.mjs`.
- **2.3 — DONE** — `/activity` carries stock positions and credit-line plans.
- **2.4 — NOT STARTED** — The credit line cannot be drawn from a browser:
  `createLoan(address user, uint256 amount, address poolToken)` takes the
  borrower as an argument and is merchant-called. Either build the merchant-side
  origination flow in `/merchant`, or state on the card that it is opened at the
  till. Currently the card says "at the till" — which is honest — so this is a
  feature decision, not a defect.

### PHASE 3 — Make the work verifiable  ·  the highest-leverage remaining work

- **3.1 — DONE, via Sourcify rather than OKLink** — OKLink's verify endpoint
  needs an `OKLINK_API_KEY` that exists nowhere in this repository, and it
  refuses keyless submissions. Sourcify supports X Layer testnet (1952), takes
  no key, and is where `hardhat-verify` already points. **All five contracts
  are now `exact_match`**, compiled `solc 0.8.24+commit.e11b9ed9`, `viaIR`,
  cancun. `packages/contracts/scripts/verify-sourcify.js` re-runs it. The
  OKLink config is left in place so a single key switches that on too.
- **3.2 — DONE** — The footer's `CONTRACTS` link points at
  `repo.sourcify.dev/1952/<engine>`, which renders *Exact Match ·
  PolarisEngine · solc 0.8.24 · cancun* with the full source tree. Verified in
  the browser.
- **3.3 — BLOCKED, not skipped** — Recording a screen capture needs a screen
  recorder driving a real browser session; there is no way to produce one from
  here. Everything it depends on is ready: `docs/DEMO.md` has the script, and
  the flow is proven end to end on chain. **This is the one task in the plan
  that needs a person.**
- **3.4 — DONE** — `.github/workflows/ci.yml` runs typecheck, package build,
  the full 356-test suite and the app build on every push to `main` and every
  pull request. Verified by running exactly those four commands locally: all
  pass.

### PHASE 4 — Clean the repository a judge reads  ·  partly done

- **4.1 — DONE** — README describes X Layer; the Solana original is preserved
  at `docs/SOLANA-README.md`.
- **4.2 — DONE** — `pnpm start` runs this product, not the Solana gateway;
  Solana entry points renamed `solana:*`.
- **4.3 — DONE** — `apps/gateway`'s `test` script is now a guard that asks the
  configured cluster whether the Polaris program account actually exists, and
  skips with a plain explanation when it does not. Checking the port alone was
  not enough — a validator can be up with no program on it, which is exactly
  the state that produced the original `IncorrectProgramId`. `test:solana` runs
  the suite regardless. Verified: exits 0 with the reason, instead of failing.
- **4.4 — NOT STARTED** — `merchant-web` has **47 Sepolia references**,
  including `chainId: 11155111` in `app/api/bills/create/route.ts:50` and
  `network: 'sepolia'` in `app/api/apps/route.ts:83`, plus "Mock USDC on
  Sepolia". The README lists it as part of the repo. Either port it to X Layer,
  or mark it in the README as a prior-chain surface the way the Solana code is.
- **4.5 — NOT STARTED** — Same for `shopping` (14 refs) and `apps/merchant`
  (22 refs).
- **4.6 — DONE, made real rather than deleted** — `InsurancePool` now takes an
  immutable token, `stakeCTC` does a real `safeTransferFrom` and credits only
  what actually arrived (so a fee-on-transfer token cannot put the accounting
  ahead of the balance), `slashInsurance` moves real tokens to a named
  recipient, and stakers can `unstake` what they put in. 7 new tests in
  `packages/protocol/test/insurance-pool.test.js`, all passing, including
  "refuses a stake that was never approved, instead of crediting it".
  **`packages/protocol` did not compile at all before this** — its config
  offered solc 0.8.20/0.8.23 while the installed OpenZeppelin needs ^0.8.24,
  and `mcopy` needs cancun. Both fixed; 42 files compile.

### PHASE 5 — Honest limits  ·  disclosed rather than fixed

- **5.1 — DONE** — Stand-in tokens are named on the checkout page. No real
  xStock or USDT0 exists on X Layer testnet — `eth_getCode` returns `0x` for
  both.
- **5.2 — DONE** — The relayer's role is stated in the README and
  `docs/SUBMISSION.md`.
- **5.3 — DONE** — `StockPriceOracle` carries a circuit breaker:
  `maxDeviationBps`, default 2000, bounded to 1%–90% so it can be neither
  tightened into a denial of service on the relayer nor widened into no bound
  at all. A relayer can no longer mark the book down in one post; a genuine
  gap-down goes through owner-only `postPriceOverride`, which emits
  `PriceOverridden` so a human decision is a fact on chain rather than an
  indistinguishable relayer post.

  Shipped to X Layer without touching a single open position: the engine holds
  the oracle behind `setOracle`, so the new one was deployed, seeded with the
  live print, then repointed. New oracle
  `0x926cDFa64B6bF592DD73e71a1d915624f0FaF6FE` (previous kept in the deployment
  record as `oraclePrevious`). 11 new tests; **the full suite is 212 passing,
  0 failing**, up from 201 — the 6 liquidation tests that crash the price now
  route through the override, which is what the product does. Verified after
  the swap: relayer repointed, checkout signed and paid on chain
  (`0xd855c052…`, 2.0 tXAAPL locked, 202.237008 pUSDC to the merchant), and all
  live invariants still hold.
- **5.4 — DONE** — The sequencer guard is inert on testnet (no uptime feed) and
  covered by unit tests instead; the README says so.

### PHASE 6 — Regression safety

- **6.1 — DONE** — `TEST-PLAN.md` covers 84 items across three runs, each with
  its definition of correct.
- **6.2 — DONE** — `scripts/smoke.mjs` asserts the API contract, all six
  redirects that keep already-printed merchant QR codes alive, and that every
  page answers; it exits non-zero on failure so CI can gate on it, and
  `BASE=… node scripts/smoke.mjs` points it at any deployment. Run against
  production: **35 passed, 0 failed, exit 0.**
- **6.3 — NOT STARTED** — No browser-level regression test. The checkout and
  repay flows are proven by hand via an injected EIP-1193 provider; that harness
  lives only in session transcripts. Commit it as a Playwright spec that injects
  the same provider and drives quote → approve → openLoan → repay.

---

## 3. Gaps, tied to the task they block

Ordered by what costs most. Status is as of the execution pass.

| # | Gap | Status |
|---|---|---|
| G1 | **The track is unresolved.** No AI in the product; Build X lists it as a qualification, requires mainnet, and closed 21 Aug 2026. | **OPEN — needs you.** Cannot be answered from inside the repo. |
| G2 | Contract source unverified — the best work unreadable where a judge looks. | **CLOSED.** All five `exact_match` on Sourcify. OKLink needs a key that does not exist; Sourcify needs none. |
| G3 | The live footer said `SEPOLIA` on every page. | **CLOSED.** Reads `ACTIVE_CHAIN.name`; live footer now `POLARIS_PROTOCOL \| X LAYER TESTNET \| DOCS \| CONTRACTS`. |
| G4 | No demo video. | **OPEN — needs a person.** Screen capture cannot be produced from here. |
| G5 | No CI; 356 tests, nothing ran them. | **CLOSED.** `.github/workflows/ci.yml`; all four commands verified locally. |
| G6 | `InsurancePool.stakeCTC` credited a stake with no transfer — free arbitrary stake. | **CLOSED.** Real `safeTransferFrom`, credit-what-arrived, `unstake`, slashing moves real tokens. 7 tests. |
| G7 | `merchant-web` is still a Sepolia app — 47 references, mock USDC. | **OPEN.** Not ported. It is a prior-chain surface; the README lists it without claiming it is live on X Layer. |
| G8 | `apps/gateway` tests fail — Solana, needs a validator. | **CLOSED.** Guarded on the program actually being deployed; skips with a reason, exit 0. |
| G9 | `shopping` (14) and `apps/merchant` (22) carry Sepolia references. | **OPEN.** Same call as G7. |
| G10 | The oracle had one trusted writer and no deviation bound. | **CLOSED.** 20% circuit breaker plus an owner override that emits `PriceOverridden`. New oracle live and verified. |
| G11 | OKLink's address page shows no activity, so `CONTRACTS` looked like a dead contract. | **CLOSED.** Points at the Sourcify record instead. |
| G12 | The credit line cannot be drawn from a browser. | **ACCEPTED.** `createLoan` is merchant-called by design; the card says "at the till", which is honest. |
| G13 | Stand-in tokens, testnet only. | **ACCEPTED.** Inherent to the network, disclosed on the page. |
| G14 | The manual test plan is not automated. | **PARTLY.** `scripts/smoke.mjs` written (30+ checks) but never executed — see 6.2. Browser regression still open. |
| G15 | Solana code still in the tree. | **ACCEPTED.** Named and scoped in the README; its test command no longer fails. |

### Not gaps, recorded so they are not re-litigated

- **Zero TODO/FIXME/HACK** in tracked source across every language.
- **No mocks in the shipped product.** Every `mock|stub|fake` hit in
  `apps/core`, `packages/contracts` and `services` is a CSS `placeholder:`
  class, a real input placeholder, `SequencerFeedStub.sol` under `testing/`, or
  a comment recording that fakery was removed. G6 is in an undeployed package
  outside the build.
- **Score 600 / limit $500 for every address is real**, not hardcoded —
  `scoreOf` and `baseLimitOf` return the contract's default for an address with
  no history. Verified directly against `ScoreManager` on chain. It is now
  labelled on the page so it does not read as invented.

---

## 4. What is left

Everything in phases 1–6 that a machine could close is closed and verified.
Three things remain, and none of them are code:

1. **0.1 — settle the track.** No AI, no mainnet, and Build X closed on
   21 August. Everything else is a bet until this is answered, and nobody
   inside the repository can answer it.
2. **3.3 / G4 — record the demo.** The script is written and the flow is proven
   on chain; it needs somebody to press record.
3. **6.2 — run `node scripts/smoke.mjs` once.** It is written and reviewed but
   never executed, because the host's disk filled before it could run. Until it
   goes green it is the only claim in this plan not backed by a run.

Deferred deliberately, not forgotten: `merchant-web`, `shopping` and
`apps/merchant` are still Sepolia surfaces (G7, G9). Porting three apps is a
larger piece of work than the submission needs, and the README does not claim
they run on X Layer.

---

## 5. Uncommitted at the end of the execution pass

The shell died mid-run — the host's root volume filled and the harness could no
longer write task output — so the following is on disk and **not yet committed
or pushed**:

- `apps/core/components/footer.tsx` — chain name, health dot, Sourcify link
- `packages/contracts/contracts/polaris/StockPriceOracle.sol` — circuit breaker
- `packages/contracts/scripts/verify-sourcify.js`, `scripts/upgrade-oracle.js`
- `packages/contracts/test/oracle-deviation.test.js` (11 tests)
- `packages/contracts/test/polaris-credit.test.js` — crash posts via override
- `packages/protocol/` — real `InsurancePool`, solc 0.8.24, 7 new tests
- `apps/gateway/scripts/test-guard.mjs` + `package.json`
- `.github/workflows/ci.yml`
- `scripts/smoke.mjs`
- `apps/core/lib/polaris-deployment.json`, `packages/contracts/deployments/…`
  — new oracle address
- `README.md`, `TEST-PLAN.md`, `docs/SUBMISSION.md`, this file

The deployed app, the deployed contracts and the Railway relayer are all
already updated and verified — only the repository is behind.
