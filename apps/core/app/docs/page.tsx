"use client"

import { useState } from "react"
import { Check, Copy, ExternalLink } from "lucide-react"

/**
 * Integration docs.
 *
 * The page this replaced described "a Confidential Lending Protocol built on
 * Fhenix's FHEVM" with homomorphically encrypted balances -- an accurate
 * description of a different project. Everything here is the API that actually
 * ships in packages/sdk, against the addresses actually deployed.
 */

const CONTRACTS: Array<[string, string]> = [
  ["PolarisLoanEngine", "0x21E9740DDe241f0653F699DAa206AfCE1FA25405"],
  ["ScoreManager", "0x81C333942eaEe7d3d724c6C2ea28100511934f3C"],
  ["CollateralVault", "0xDb6781ed843Ba07Af3321bB8C3952db643324b98"],
  ["PolarisPayments", "0x3BD1609abDC915eA9e01A399a26e2B8A2a06243f"],
  ["MerchantRegistry", "0xb2eCAD5bE07971deE1be161C39569705186AdFD6"],
  ["Test token (pUSDC)", "0x49C86277a91002c4943837bf20F6ED41976Db09F"],
]

const INSTALL = `npm install polarispay-sdk ethers`

const CHECKOUT = `import { PayWithPolarisBNPL } from "polarispay-sdk/react";

// One component. It reads the shopper's limit from the chain, shows the
// four-payment schedule, and opens the plan.
<PayWithPolarisBNPL
  merchant="0xYourPayoutAddress"
  amount="180.00"
  orderId="ORDER-1042"
  onSuccess={(r) => console.log(r.transactionHash)}
/>`

const HEADLESS = `import { createPolaris } from "polarispay-sdk";

const polaris = createPolaris();
await polaris.connect();

// Will this shopper's limit cover it?
const { eligible, limit } = await polaris.canPayLater("180.00");

if (eligible) {
  await polaris.payLater({
    merchant: "0xYourPayoutAddress",
    amount: "180.00",
    orderId: "ORDER-1042",
    installments: 4,
    intervalSeconds: 60 * 60 * 24 * 14, // fortnightly
  });
} else {
  await polaris.pay({ merchant: "0xYourPayoutAddress", amount: "180.00", orderId: "ORDER-1042" });
}`

const AGENT = `// The MCP server exposes the same operations to an AI agent.
// Point your client at packages/mcp and it gets:
polaris_get_credit          // score, limit, what is available
polaris_can_afford          // check before committing to a purchase
polaris_pay_now             // pay a merchant outright
polaris_pay_later           // open a four-payment plan
polaris_subscribe           // start a recurring plan
polaris_cancel_subscription
polaris_lock_collateral     // raise the limit`

const WEBHOOK = `import { verifySignature } from "@polarispay/db";

app.post("/polaris", (req, res) => {
  const check = verifySignature(
    process.env.POLARIS_WEBHOOK_SECRET,
    req.rawBody,
    req.headers["polaris-signature"]
  );
  if (!check.ok) return res.status(400).send(check.reason);

  // Delivery is at-least-once: key on eventId and treat a repeat as a no-op.
  handle(JSON.parse(req.rawBody));
  res.sendStatus(200);
});`

const EVENTS: Array<[string, string]> = [
  ["plan.opened", "A shopper split a checkout into instalments."],
  ["installment.collected", "The keeper charged one on schedule."],
  ["installment.failed", "A charge did not go through; dunning has started."],
  ["plan.completed", "Every instalment is paid."],
  ["plan.liquidated", "The plan defaulted and collateral was seized."],
  ["settlement.paid", "Collected funds landed in your payout address."],
]

export default function DocsPage() {
  return (
    <div className="space-y-12 pt-6 pb-16 max-w-3xl">
      <header className="space-y-3">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Integrate Polaris</h1>
        <p className="text-sm text-foreground/55">
          Buy now, pay later as a drop-in checkout. Your shopper's limit is underwritten from their
          own chain history, instalments are collected automatically by a keeper running on
          KeeperHub, and you are settled without chasing anyone.
        </p>
      </header>

      <Section title="Install">
        <Code text={INSTALL} lang="bash" />
        <p className="mt-3 text-[13px] leading-relaxed text-foreground/55">
          Published on npm as{" "}
          <a
            href="https://www.npmjs.com/package/polarispay-sdk"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-primary underline-offset-4 hover:underline"
          >
            polarispay-sdk
          </a>
          . Ships ESM and CommonJS builds with types. React is an optional peer dependency, so the
          headless client imports cleanly on a Node backend.
        </p>
      </Section>

      <Section
        title="Drop-in checkout"
        blurb="The fastest path: one component, no contract calls of your own."
      >
        <Code text={CHECKOUT} />
      </Section>

      <Section
        title="Headless"
        blurb="When you want your own UI. Fall back to paying in full when the limit will not stretch."
      >
        <Code text={HEADLESS} />
      </Section>

      <Section
        title="For agents"
        blurb="An agent with a wallet can transact against the same protocol over MCP."
      >
        <Code text={AGENT} />
      </Section>

      <Section
        title="Webhooks"
        blurb="Signed with an HMAC over timestamp.body, so a captured payload cannot be replayed forever."
      >
        <Code text={WEBHOOK} />
        <dl className="mt-4 divide-y divide-primary/10 rounded-2xl border border-primary/15 overflow-hidden">
          {EVENTS.map(([name, what]) => (
            <div key={name} className="flex flex-col sm:flex-row gap-1 sm:gap-4 px-4 py-3">
              <dt className="font-mono text-xs text-primary sm:w-52 shrink-0">{name}</dt>
              <dd className="text-sm text-foreground/60">{what}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Deployed on Sepolia">
        <dl className="divide-y divide-primary/10 rounded-2xl border border-primary/15 overflow-hidden">
          {CONTRACTS.map(([name, address]) => (
            <div
              key={address}
              className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-3"
            >
              <dt className="text-sm sm:w-48 shrink-0">{name}</dt>
              <dd className="min-w-0">
                <a
                  href={`https://sepolia.etherscan.io/address/${address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-foreground/55 hover:text-primary transition-colors inline-flex items-center gap-1 break-all"
                >
                  {address}
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="How collection works">
        <div className="space-y-3 text-sm text-foreground/60 leading-relaxed">
          <p>
            When an instalment comes due, a keeper checks the loan on chain and charges it through
            KeeperHub's execution API. Gas is sponsored, so the shopper never needs ETH to repay,
            which removes the single most common reason a repayment fails.
          </p>
          <p>
            A charge that fails enters dunning and is retried on a backoff rather than being written
            off. Once a plan has run past its grace period it becomes liquidatable, and the keeper
            recovers what it can from collateral.
          </p>
          <p>
            Every execution is idempotent per attempt, so a retried request never charges a shopper
            twice. Because a sponsored execution runs through a smart account, the keeper
            wallet's own nonce and balance never move. Confirm charges from the execution status,
            not from the relayer's transaction list.
          </p>
        </div>
      </Section>
    </div>
  )
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string
  blurb?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {blurb && <p className="text-sm text-foreground/60">{blurb}</p>}
      </div>
      {children}
    </section>
  )
}

function Code({ text, lang = "ts" }: { text: string; lang?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    // Long enough to register, short enough that the button is ready again
    // before anyone reaches for it a second time.
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="relative group rounded-2xl border border-primary/15 bg-black/50 overflow-hidden">
      <button
        onClick={copy}
        aria-label="Copy to clipboard"
        className="absolute right-3 top-3 z-10 rounded-lg border border-primary/20 bg-black/70 p-2 text-foreground/40 opacity-0 transition-all group-hover:opacity-100 hover:text-primary focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto px-4 py-4 text-xs leading-relaxed">
        <code className={`language-${lang} font-mono text-foreground/75`}>{text}</code>
      </pre>
    </div>
  )
}
