# Recording the demo

Five minutes against a real validator. Nothing here is mocked or replayed:
every figure on screen is read from a program account, and every transaction
has a signature you can open in the explorer afterwards.

The EVM recording script — the original build, on Sepolia — is in
[`DEMO-EVM.md`](DEMO-EVM.md). This is the Solana one.

## Before you press record

One command stands the whole thing up: a fresh validator with the program
deployed, five merchants, a borrower with history, three loans in different
states and three subscription plans.

```bash
./scripts/reset-local.sh
```

Then two services, in two terminals:

```bash
pnpm --filter @polaris/gateway start
```

```bash
pnpm --filter polaris-mobile start
```

The gateway is the underwriter and the Solana Pay endpoint. The app is the
customer. Check the gateway agrees with the cluster before you start:

```bash
curl -s localhost:4100/health
```

## The five minutes

**1. A wallet nobody has ever underwritten.** Open the app on a fresh install.
It generates a signer on the device, and the credit screen fills in from
nothing: score 520, a 200 USDC line, and four lines saying why —

```
Wallet is less than a month old · +0
0 transactions signed · +0
No tokens held · +0
0.00 USDC on hand · +0
```

That is the whole argument on one screen. The limit was read off the chain, and
because every input is public, the reasons can be shown. Nobody filled in a
form.

To show the other end of it, underwrite a wallet that has actually been used.
`--read` scores it without opening anything:

```bash
pnpm --filter @polaris/gateway underwrite <address> --read
```

**2. Fund the wallet.** The app shows its address; give it something to spend.

```bash
pnpm exec tsx scripts/fund.ts <address>
```

**3. Check out.** Pick a merchant, split into four. One transaction carries the
SPL approval and the origination together, the merchant is paid in full
immediately out of protocol liquidity, and the plan appears on the Plans tab
with all four dates.

**4. Or check out by QR.** The merchant's side of the same thing:

```
http://localhost:4100/checkout?merchant=<merchant PDA>&amount=180000000
```

A Solana Pay transaction request. Any Solana Pay wallet scans it and is handed
one transaction to approve — and if that wallet has never borrowed, a line is
underwritten from its own history first, mid-checkout.

The line to point at is **Network fee — paid by Polaris**. The gateway is the
fee payer *and* the rent payer, so the customer opens a credit plan holding no
SOL at all. On EVM that was a product we bought; here it is a field on the
transaction.

Merchant PDAs are in `deployments/localnet-seed.json`.

**5. And the app reads the code.** Tap the scanner in the middle of the tab
bar and point it at the checkout page on another screen. It decodes the code,
fetches the transaction and shows the merchant's terms before anything is
signed. Without a second screen, hand the request straight to the app the way
a phone's OS would when the *Open in a wallet* link is tapped:

```bash
open "http://localhost:8085/scan?request=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote('solana:'+urllib.parse.quote(sys.argv[1],safe=''),safe=''))" "http://localhost:4100/pay/demo?merchant=<merchant PDA>&amount=40000000")"
```

**6. The keeper collects.** Loan #2 in the seed runs on a 60-second interval
precisely so a collection can happen inside a recording.

```bash
pnpm --filter @polaris/keeper-solana start
```

It reads what is due with one `getProgramAccounts` call — there is no database
behind it — simulates, then sends. The Activity tab updates, and the borrower
never signed anything.

**7. Default and liquidation.** The full arc, unattended, in about five
minutes: origination, four collections, then a second borrower who revokes
their delegation and is liquidated.

```bash
POLARIS_CLUSTER=localnet pnpm exec tsx scripts/lifecycle.ts
```

## What to say about failures

Leave them in. A liquidation that recovers nothing is not a bug — it is the
protocol booking bad debt against itself, which is what an undercollateralized
book does when it is wrong. `scripts/inspect.ts` prints that ledger, and a run
that only ever shows green is a marketing asset rather than a demo.
