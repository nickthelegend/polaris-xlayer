# 100 features PolarisPay could ship on KeeperHub

Every entry names the KeeperHub primitive that powers it. Nothing here invents a
capability: each maps to a trigger, plugin action, protocol adapter or execution
surface that exists in the KeeperHub source today.

Where a feature is already built, it is marked **[shipped]**. Everything else is
a proposal, ordered by how much it would change the product rather than by how
easy it is.

Surfaces referenced throughout: **triggers** (Manual · Schedule · Webhook ·
Event · Block · Tempo Transfer), **web3** (19 actions), **protocol** (23
adapters), **tempo** (memo transfer · batch payout · hold payment · DEX swap),
**blockscout**, **cowswap**, **hyperliquid**, comms (**telegram · discord ·
slack · resend · sendgrid**), **code**, **math**, **ai-gateway**, plus
simulate, idempotency, gas sponsorship, private routing, spending caps and the
audit trail.

---

## I. Underwriting a borrower nobody has underwritten before

The hardest problem in undercollateralized credit is the first loan. These use
chain history as the credit file.

**1. Wallet-age underwriting.** Blockscout `get-address-counters` returns
transaction count and first-seen block. A wallet active for three years with
4,000 transactions is a different risk from one funded yesterday, and the
starting score should reflect it instead of everyone beginning at 600.

**2. Repayment history import from Aave.** `protocol-read` against Aave V3
health factor and borrow history. Someone who has serviced an Aave position for
a year has demonstrated exactly the behaviour Polaris underwrites.

**3. Morpho and Compound position attestation.** Same read, two more adapters.
Three independent lending histories triangulate far better than one.

**4. Liquidation-history penalty.** `query-events` for `LiquidationCall` across
Aave, Morpho and Compound with the borrower as user. A prior liquidation is the
single most predictive negative signal in lending and it is public.

**5. Stablecoin-balance stability score.** A scheduled `check-token-balance`
sampled daily builds a volatility series. A wallet that holds a steady balance
repays differently from one that empties every week.

**6. Counterparty-risk screening.** `assess-risk` on the borrower address before
origination, so a wallet flagged for sanctions or known exploit proceeds never
opens a plan.

**7. Sybil resistance via funding-source clustering.** `query-transactions`
walks the funding graph. Fifty fresh wallets funded from one address are one
borrower with fifty credit limits.

**8. Protocol-native reputation.** Aggregate positions across all 23 protocol
adapters into a single "DeFi tenure" input. Breadth of engagement is a proxy for
skin in the game.

**9. Live health-factor monitoring of external positions.** Block trigger +
`protocol-read`. A borrower whose Aave position is about to liquidate is about
to be short for their Polaris instalment too — that is a day of warning.

**10. Credit-limit decay on dormancy.** Scheduled sweep. A score earned two
years ago on behaviour that has since stopped is not evidence about today.

**11. Cross-chain history aggregation.** The same reads across every supported
chain. A borrower's Base history should count toward their Ethereum limit.

**12. Collateral quality tiers.** Different multipliers per asset via
`get-token-info` — a blue-chip stablecoin is not the same collateral as an
illiquid token, and one multiplier for both is mispricing.

**13. Real-time collateral revaluation.** Chainlink adapter + block trigger. If
collateral is ever non-stable, its credit boost has to move with its price.

**14. First-loan graduated limits.** New borrowers start capped regardless of
signals, and the cap lifts on demonstrated repayment. The most reliable
underwriting input is a completed plan.

---

## II. Collections that behave like a real credit operation

**15. Simulate-before-charge.** **[shipped]** Every collection dry-runs first,
so a shortfall is a signal rather than a burnt transaction.

**16. Failure-cause dunning ladder.** **[shipped]** Branches on why, not on how
many times.

**17. Partial collection on a shortfall.** **[shipped]** Take 38 of a 50
instalment rather than nothing.

**18. Balance-aware scheduling.** `check-token-balance` before the due date. If
the borrower is short today but was funded on the 1st of last month, collect on
the 2nd rather than failing on the 1st.

**19. Payday detection.** `query-transactions` finds recurring inbound transfers
and aligns the collection schedule to them. Collecting the day after money
arrives is worth more than any dunning ladder.

**20. Pre-due top-up nudge.** Telegram or email two days before an instalment
when the balance will not cover it. Cheap, and it prevents the failure.

**21. Self-cure link.** **[shipped as a primitive]** A one-click "I have topped
up, retry now" that bypasses the back-off.

**22. Grace-period extension for good history.** A borrower at 780 with twenty
on-time payments gets seven days; a borrower at 450 gets three.

**23. Instalment rescheduling.** Let a borrower move one due date per plan.
Nearly free, and it converts a default into a late payment.

**24. Partial early repayment with interest rebate.** Interest accrues
pro-rata, so paying early genuinely costs less and the contract can prove it.

**25. Consolidation.** Roll several small plans into one schedule via a single
`write-contract`. Fewer collection events, less to go wrong.

**26. Collection retry across chains.** If the borrower is short on Base but
funded on Arbitrum, prompt a bridge rather than recording a failure.

**27. Weekend and holiday awareness.** Do not fire the final-notice message at
2am on Christmas Day. Schedule triggers make this trivial and its absence is
what makes automated collections feel hostile.

**28. Escalating notification channels.** Email, then Telegram, then Discord,
then SMS. Each escalation is a separate plugin already wired.

**29. Borrower-set preferred collection day.** A borrower who knows their own
cash flow will pick better than a scheduler will.

**30. Dunning A/B testing.** Two message variants per stage, measured against
cure rate. Collections copy is a conversion problem.

**31. Automatic write-off after the ladder.** **[shipped]** `badDebt` is booked
on chain rather than silently zeroed.

**32. Recovery agent for written-off debt.** A long-tail keeper that keeps
watching a defaulter's balance and collects if they are ever funded again.

**33. Hardship pause.** A borrower-requested freeze that stops collection and
the clock, without a default. The alternative is that they default anyway.

---

## III. Treasury: earning on float instead of letting it sit

**34. Idle liquidity into Aave.** `protocol-write` supply. Merchant-payout
liquidity sits idle by construction; that is the float every payments company
earns on.

**35. Yield-source rotation.** Scheduled comparison across Aave, Morpho, Spark,
Compound and Yearn, moving to the best rate. Five adapters, one decision.

**36. Liquidity-buffer floor.** Never deploy below the next 24 hours of expected
merchant payouts. Yield that delays a settlement is not yield.

**37. Automated withdrawal on a payout shortfall.** Block trigger detects the
pool dipping and unwinds a position before a settlement fails.

**38. sUSDe cooldown ladder.** Ethena's unstaking cooldown is multi-day. Roll
tranches so withdrawable liquidity is always available — nobody has built this
and it is a real operational problem.

**39. Bad-debt reserve funded from interest.** A fixed share of protocol fees
routed to a reserve, automatically, every settlement cycle.

**40. Insurance-pool staking.** Third parties stake to backstop defaults and
earn a share of interest. The keeper handles the accounting.

**41. Treasury rebalancing across chains.** Liquidity follows origination
volume rather than sitting where it was first deployed.

**42. Sky/DAI conversion.** `convert-dai-to-usds` when the savings rate favours
it. One adapter, one scheduled decision.

**43. Interest-rate model responding to utilisation.** Raise borrower rates as
the pool empties. Reads utilisation, writes the rate.

**44. LP tokenisation.** Let outside capital fund the pool and earn interest,
with a keeper handling entry, exit and accrual.

**45. Stress-test simulation.** Scheduled `code` action modelling default
scenarios against the live book and alerting when the reserve looks thin.

---

## IV. Merchants

**46. Instant settlement.** **[shipped]** Paid at origination, not in 30 days.
That is the pitch.

**47. Batched payouts on Tempo.** One atomic transaction pays 200 merchants,
each with a memo carrying their reconciliation reference.

**48. Memo-based invoice reconciliation.** Tempo's memo is protocol-native and
indexed, so a merchant can verify a payout against an invoice from a block
explorer rather than trusting our dashboard.

**49. Merchant-funded 0% APR promotions.** The merchant absorbs the interest to
convert a sale. Standard BNPL economics, and the contract already splits it.

**50. Per-merchant risk appetite.** A merchant choosing higher approval rates
accepts a higher fee. Their cap already lives on chain.

**51. Settlement scheduling.** Daily, weekly, or on-threshold — a merchant's
preference, not ours.

**52. Multi-currency settlement.** Collect in USDC, settle in the merchant's
preferred stablecoin via CoW Swap `create-order`.

**53. Chargeback-free guarantee.** Pre-collateralised means there is nothing to
reverse. Worth stating plainly because it is the merchant's biggest cost
elsewhere.

**54. Merchant credit line.** A merchant borrows against receivables not yet
collected. The book already knows exactly what those are.

**55. Refunds.** Reverse a settled payment and unwind the borrower's plan
proportionally.

**56. Partial refunds.** The same, for one line item, with the schedule
recalculated.

**57. Dispute resolution backed by receipts.** Every charge already carries
trigger, simulation result, hash, gas and outcome. That is the evidence pack.

**58. Settlement export.** **[shipped]** CSV that a bookkeeper can open.

**59. Real-time webhooks.** **[shipped]** HMAC-signed, replay-windowed, with a
retry policy that does not hammer a broken endpoint.

**60. Merchant analytics.** Approval rate, average order value, collection rate,
cohort default curves — all derivable from the existing event log.

**61. Automatic merchant onboarding.** Register, activate and cap in one
workflow, gated on `assess-risk` against the payout address.

**62. Merchant health monitoring.** A merchant whose plans default at triple the
book average has their cap reduced automatically.

**63. Slack and Discord for merchant ops.** Settlement confirmations and dispute
alerts where the merchant's team already works.

---

## V. Agent-native commerce

This is where PolarisPay stops being a consumer product and becomes
infrastructure.

**64. Machine credit lines.** An agent posts collateral once and draws credit
all month. Agents cannot get credit cards; this is the closest equivalent.

**65. Agent checkout over MCP.** Expose `pay`, `subscribe` and `payLater` as MCP
tools so any agent can transact without a browser.

**66. x402-metered API billing.** Usage accrues, an invoice is issued, and a
mandate collects. x402 is prepay-per-call; real APIs bill in arrears.

**67. Agent reputation via ERC-8004.** Repayment history published as an
attestation other protocols can read.

**68. Autonomous merchant onboarding.** An agent registers as a merchant and
starts accepting BNPL without a human.

**69. Agent-to-agent net settlement.** Accumulate obligations, net them, settle
the residual in one Tempo batch. Ten thousand micropayments become fifty
transactions.

**70. Compute credit.** Underwrite an agent's GPU spend specifically, against
its earning history.

**71. Spending-cap enforcement per agent.** KeeperHub's org spend cap is a hard
ceiling a runaway agent cannot exceed.

**72. Listed collection workflow.** Publish the collection workflow to the
KeeperHub marketplace priced in USDC, so other credit protocols can rent it.

**73. Agent-initiated hardship pause.** An agent that detects its own runway
shortening can pause its plans before defaulting.

---

## VI. Tempo-native payments

**74. Sign-now, broadcast-later instalments.** A held payment is a signed,
unbroadcast transaction with an on-chain expiry that can fire only once — a
post-dated cheque, with no escrow contract to deploy or audit.

**75. Escrow with no escrow contract.** The same primitive: release on delivery,
expire back to the buyer otherwise.

**76. Scheduled payouts with an on-chain deadline.** The settlement cannot be
replayed and cannot linger.

**77. Stablecoin-fee operation.** Tempo charges fees in stablecoin, so a keeper
never needs a gas token at all.

**78. Native DEX swap for multi-currency settlement.** No third-party router.

**79. Memo-indexed audit trail.** Reconciliation that a merchant's auditor can
verify without our cooperation.

---

## VII. Fraud, security and abuse

**80. Velocity limits.** Three plans opened in ten minutes from one wallet is a
pattern, not a customer.

**81. Approval-drain detection.** `check-allowance` sweep. A borrower who has
granted a large allowance to an unknown contract is about to lose the balance we
plan to collect.

**82. Known-exploiter screening.** `assess-risk` at origination and again before
each settlement.

**83. Merchant collusion detection.** A merchant whose borrowers are mostly
wallets funded by that merchant is laundering credit, and the funding graph
shows it.

**84. Private-routing liquidations.** Flashbots Protect so a liquidation is not
front-run. Note it is mutually exclusive with gas sponsorship — that trade-off is
documented in KeeperHub's own gas docs.

**85. Anomalous-collection alerting.** A sudden drop in collection rate is
either a bug or an attack, and both want paging.

**86. Circuit breaker.** Halt origination automatically when the default rate
crosses a threshold.

**87. Multi-sig treasury via Safe.** `get-pending-transactions` surfaces what is
awaiting signature.

**88. Rate-limit-aware keeper fleet.** Stay inside 60 requests/minute per key
while collecting hundreds of instalments.

**89. Replay-safe idempotency.** **[shipped]** Per-attempt keys, because
KeeperHub caches failures as well as successes.

---

## VIII. Borrower experience

**90. Credit-score explainer.** Show which events moved the score and by how
much. `ScoreChanged` already carries the reason.

**91. Limit-increase simulator.** "Lock 200 and your limit becomes 800" —
computed, not promised.

**92. Payment calendar export.** An .ics feed of upcoming instalments.

**93. Autopay top-up.** Move funds from a savings position into the collection
wallet the day before an instalment.

**94. Spending insights.** Where the credit went, by merchant category.

**95. Early-payoff quote.** Exact figure to close a plan today, including the
interest rebate.

**96. Credit-score portability.** Export the score as a signed attestation the
borrower owns and can present elsewhere.

**97. Referral credit.** A real limit increase for a referral that repays, not a
points balance.

---

## IX. Operations

**98. Chain-to-book reconciliation.** **[shipped]** `db:sync` and `db:purge`
keep the book equal to chain, and purge deletes any row the chain does not back.

**99. Keeper heartbeat.** A missed pass is an incident. Alert on the absence of
work, not just on failures — a silent keeper is the failure mode that costs the
most.

**100. Public status page.** Collection rate, settlement latency and keeper
uptime, published. A payments company that will not show its numbers is asking
for trust it has not earned.

---

## What is already real

Marked **[shipped]** above: 15, 16, 17, 21, 31, 46, 58, 59, 89, 98 — plus the
credit engine, collateral vault, subscriptions, direct payments, merchant
registry, dunning ladder, settlement queue and the SDK, all verified on Sepolia
and covered by 107 tests. See [DEPLOYMENT.md](DEPLOYMENT.md) for the transaction
list and [FEATURES.md](FEATURES.md) for the current build state.

## What to build next, and why

If the goal is a product people run, the order is **34** (float yield turns the
treasury into a revenue line), **47** (batched Tempo payouts is the settlement
cost problem), **19** (payday detection beats every dunning improvement
combined), and **64** (machine credit is the only item here with no incumbent).

If the goal is the hackathon, **74** and **47** use the one KeeperHub surface —
Tempo — that no submission in the previous cohort touched at all.
