# Polaris Merchant — Android

The merchant's terminal: your book, and the code you hand a customer.

**This is a separate app from the borrower's on purpose.** `fun.polaris.merchant`
installs alongside `fun.polaris.app`; the two never share a process, a package
or a keystore entry. A terminal on a counter and a wallet in a pocket are not
the same product wearing different tabs.

## It inherits the borrower app's design system rather than restating it

`src/theme` and `src/components` are the borrower app's, unchanged: the same
palette, the same type ramp, the same `Surface` with its inset top highlight,
the same `Figure` counting in base units, the same `AmbientBackground`.

The tab bar is a **port, not a lookalike**. One spring drives an indicator in
slot units and every glyph's colour is a function of its distance from that
spring, so a tab warms as the indicator travels toward it. Two apps that share
a palette but move differently do not read as one product, and motion is the
part people notice without being able to name it.

Two things are deliberately absent:

- **The raised centre button.** In the borrower app that is scan. A merchant
  hands codes out rather than reading them, so a lifted primary action with
  nothing behind it would be decoration.
- **The credit orb, the wallet row, the schedule ladder.** Those are the
  borrower's state. A merchant's screen is a book and a form.

## It holds no key

`src/chain/readonly.ts` builds the Anchor provider around a throwaway keypair
that exists only because the constructor requires a wallet to read, and whose
`signTransaction` throws. A merchant's book is public state under their own
address — that is why the web POS needs no login either, and it is why this app
cannot be made to sign even by mistake.

The code it shows is a **Solana Pay transaction request**: the QR carries a URL,
and the customer's wallet POSTs its own address to be handed a transaction. The
merchant never builds it.

## The quote must equal the checkout's

`src/chain/charge.ts` reproduces the gateway's `totalOwed` exactly — term in
seconds, integer division, ceiling on the instalment — and then rounds to the
two decimals actually displayed, because `Figure` truncates where the gateway
rounds.

An earlier version used a term in days and quoted `25.19 / 4 × 6.29` where the
checkout said `6.30`. A merchant reading a number off their own terminal that
the program then disagrees with is worse than showing no number at all.

## Screens

| | |
|---|---|
| **Book** | Financed, collected, outstanding, plan count, and every loan financed against this merchant — read with one `getProgramAccounts`, not from a database |
| **Charge** | Amount, mode, a live quote, and the QR |
