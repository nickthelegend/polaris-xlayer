# polarispay-sdk

Three payment modes, one object. Pay now, subscribe, or split into instalments.

```bash
npm install polarispay-sdk ethers
```

```ts
import { createPolaris } from "polarispay-sdk";

const polaris = createPolaris();
```

That is the setup. It defaults to the live Sepolia deployment, reads the token's
decimals from the token, approves only when the allowance is short, switches the
wallet to the right chain (and offers to add it if the wallet has never seen it),
and returns a plain result object instead of throwing.

## Pay now

```ts
const result = await polaris.pay({
  merchant: "0x...",
  amount: "25.00",
  orderId: "ORD-1042",
});

if (result.ok) console.log(result.explorerUrl);
else console.log(result.error);
```

The same `orderId` can never be charged twice. A retrying checkout gets a clean
rejection rather than a second charge.

## Subscribe

```ts
await polaris.subscribe({ planId: 1 });
await polaris.cancelSubscription({ subscriptionId: 1 });
```

The first period is charged on subscribe, so a plan is never active having
collected nothing. Cancelling is unilateral: it needs no merchant cooperation,
and collection stops immediately.

The approval covers one year of periods, not an unlimited allowance. That is the
difference between a subscription and handing a merchant your wallet.

## Split into instalments

```ts
const { eligible, limit, symbol } = await polaris.canPayLater("200.00");

if (eligible) {
  const result = await polaris.payLater({
    amount: "200.00",
    orderId: "ORD-1043",
    installments: 4,
  });
}
```

Check eligibility first and a buyer who is over their limit is told so, rather
than watching a wallet popup fail. The buyer signs one approval; your backend
opens the plan, so the buyer pays no gas to start it. A keeper collects each
instalment on schedule without them coming back.

`payLater` posts to `/api/checkout` by default. Point `endpoint` at your own.

## Reading credit without a wallet

Pass `rpcUrl` and the read methods never touch a wallet, which is what makes an
eligibility badge renderable on a product page before the buyer connects
anything:

```ts
const polaris = createPolaris({ rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com" });

const credit = await polaris.getCredit("0xBuyer...");
// { score: 612, limit: "950.00", baseLimit: "500.00",
//   collateralLocked: "300.00", collateralBoost: "450.00", ... }
```

Without `rpcUrl`, reads borrow the wallet's provider and connecting is the price
of that.

## Collateral

```ts
await polaris.lockCollateral({ amount: "300.00" });
await polaris.withdrawCollateral({ amount: "300.00" });
```

Locking collateral raises the limit by 150% of what is locked. Withdrawal is
blocked while a loan is outstanding, and `withdrawable` tells you when it is not.

## React

```tsx
import { PayWithPolarisBNPL } from "polarispay-sdk/react";

<PayWithPolarisBNPL apiKey={key} amount="200.00" orderId="ORD-1" />
```

The widget is a separate entry point on purpose. React is an optional peer
dependency, and a root barrel that re-exported the component would have made it
mandatory: a Node backend importing `createPolaris` would fail to resolve
`react/jsx-runtime` before running a line.

It is presentation only. Every chain interaction goes through the same
`createPolaris`, so the widget and a hand-rolled checkout cannot drift apart on
decimals, allowance headroom, or error copy.

Colours come from CSS custom properties with dark defaults, so it matches the
surrounding page without a stylesheet to import:

```css
.checkout {
  --polaris-bg: #fff;
  --polaris-fg: #0b0f14;
  --polaris-muted: #64748b;
  --polaris-border: #e2e8f0;
  --polaris-accent: #16a34a;
  --polaris-accent-fg: #fff;
  --polaris-radius: 14px;
}
```

## Errors

Every method returns `{ ok, transactionHash?, explorerUrl?, error? }`. Nothing
throws for an expected failure, and contract reverts arrive as sentences a buyer
can act on:

| Revert | What the buyer sees |
|---|---|
| `ExceedsCreditLimit` | This order is above your credit limit. |
| `DuplicatePayment` | This order has already been paid. |
| `MerchantNotEligible` | This merchant cannot accept the order. |
| user rejected | You cancelled the request. |

## Another deployment

```ts
import { createPolaris, SEPOLIA } from "polarispay-sdk";

createPolaris({ contracts: { ...SEPOLIA, loanEngine: "0x..." } });
```

## Note on decimals

Decimals are read from the token, never assumed, and cached for the lifetime of
the client. An earlier version hardcoded 18 against a 6-decimal stablecoin, which
overcharged by a factor of 10^12 -- the kind of bug that only surfaces in
production, so the assumption is gone rather than corrected.

## License

MIT
