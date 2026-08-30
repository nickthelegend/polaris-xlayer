import type { Metadata } from "next";
import { Page, Block } from "../components/Page";
import { APPS, PROGRAM_ID } from "../components/Chrome";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How Polaris Pay works: the three payment modes, how a credit line is underwritten from on-chain history, and how instalments are collected without the buyer being online.",
};

const CONCEPTS = [
  {
    term: "Payment modes",
    body: "Pay in full settles immediately. Pay in 4 draws every 7 days at 10% APR. Subscribe charges every period. The merchant is paid the full amount up front in every case.",
  },
  {
    term: "Underwriting",
    body: "A line is opened by reading the wallet: age, transactions signed, tokens held, USDC on hand. Repayment is what raises it — 12 points per instalment paid on time, minus 40 for a late one.",
  },
  {
    term: "SPL delegate",
    body: "The buyer authorises once at checkout. Each instalment is a transfer signed by the delegate, and the allowance decrements automatically on use, so it cannot be spent twice.",
  },
  {
    term: "The keeper",
    body: "A scheduler, not an execution layer. It holds SOL and no USDC, touches no borrower balance, pays the network fee, and lands the collection. The signature is the receipt.",
  },
  {
    term: "Idempotency",
    body: "A payment PDA seeded by (merchant, order_ref) makes a retried checkout idempotent by addressing rather than by a check that could be forgotten.",
  },
  {
    term: "Solana Pay",
    body: "Checkout is a Solana Pay transaction request. The merchant's page shows a code; the app decodes it, builds the transaction, and submits it to the cluster.",
  },
];

export default function Docs() {
  return (
    <Page
      title="How Polaris Pay works."
      lede="The concepts behind the product, in the order they matter. Full reference lives at docs.polarispay.app."
    >
      <Block heading="Concepts">
        <dl className="mt-2 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
          {CONCEPTS.map((c) => (
            <div key={c.term} className="grid gap-2 py-6 md:grid-cols-[200px_1fr] md:gap-8">
              <dt className="font-medium text-ink">{c.term}</dt>
              <dd className="text-ink/60">{c.body}</dd>
            </div>
          ))}
        </dl>
      </Block>

      <Block heading="What replaced what">
        <p>
          Polaris is a port of five Solidity contracts plus an external keeper
          platform. Most of that platform turned out to be native to the runtime:
        </p>
        <ul className="mt-4 border-t border-[var(--color-rule)]">
          {[
            ["Simulate before execute", "simulateTransaction — a native RPC method"],
            ["Atomic check-and-execute", "the check is a require! on the line above the action, in one instruction"],
            ["Gas-sponsored send", "the fee payer is just a different signer"],
            ["Idempotency keys", "a signed transaction lands at most once per blockhash"],
            ["Receipts", "the signature is the receipt"],
          ].map(([was, now]) => (
            <li key={was} className="row flex flex-col gap-1 py-3 md:flex-row md:gap-6">
              <span className="min-w-[220px] text-ink/45 line-through decoration-ink/20">{was}</span>
              <span className="text-ink/75">{now}</span>
            </li>
          ))}
        </ul>
      </Block>

      <Block heading="Reference">
        <p className="font-mono text-sm text-ink/45">
          devnet · <span className="break-all">{PROGRAM_ID}</span>
        </p>
        <div className="flex flex-wrap gap-x-8 gap-y-2 pt-3">
          <a href={APPS.docs} className="text-lamp underline-offset-4 hover:underline">Full documentation →</a>
          <a href={APPS.github} className="text-lamp underline-offset-4 hover:underline">Source →</a>
          <a href={APPS.merchant} className="text-lamp underline-offset-4 hover:underline">Merchant dashboard →</a>
        </div>
      </Block>
    </Page>
  );
}
