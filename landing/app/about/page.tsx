import type { Metadata } from "next";
import { Page, Block } from "../components/Page";
import { APPS, PROGRAM_ID } from "../components/Chrome";

export const metadata: Metadata = {
  title: "About",
  description:
    "Polaris Pay is a payments layer with credit built in, on Solana — three ways to pay, a line underwritten from on-chain history, and instalments collected without the buyer being online.",
};

export default function About() {
  return (
    <Page
      title="A payments layer with credit built in."
      lede="Three ways to pay: in full, on a subscription, or split into four against an undercollateralized credit line. Polaris decides who gets credit and collects what is owed — merchants paid up front, instalments drawn on the day they fall due."
    >
      <Block heading="What it actually does">
        <p>
          At checkout a buyer chooses how to pay. If they split into four, the
          merchant is paid the full amount that day and Polaris carries the
          instalments — four draws of{" "}
          <span className="figure font-medium text-ink">50.38</span> against a
          $200 purchase, seven days apart, repaying{" "}
          <span className="figure font-medium text-ink">201.53</span> in total.
        </p>
        <p>
          The credit line behind that is underwritten from the wallet&rsquo;s own
          record: how long the address has existed, what it has signed, what it
          holds, what it can cover. No application, no bureau, nothing the buyer
          had to tell us. Every instalment paid on time is worth 12 points; a
          late one costs 40.
        </p>
      </Block>

      <Block heading="The pull model">
        <p>
          Every collection path rests on one mechanism. At checkout the borrower
          authorises the protocol once, and each instalment is drawn later
          without them being online. On EVM that was an ERC-20 allowance; here it
          is an <span className="font-mono text-ink/80">SPL delegate</span> —
          close, with one difference that is a product constraint rather than a
          bug: the allowance decrements automatically on use, so it cannot be
          spent twice.
        </p>
        <p>
          The authorisation and the purchase go in a single transaction. They
          both land or neither does.
        </p>
      </Block>

      <Block heading="What porting it taught us">
        <p>
          This is a port. The original was five Solidity contracts plus an
          external platform whose job was making sure transactions landed.
          Porting it produced one finding worth the whole exercise:
        </p>
        <p className="py-1 text-[17px] leading-[1.5] text-ink/85">
          Most of what a keeper platform sells is native to Solana. Simulation,
          atomic check-and-execute, fee sponsorship and replay protection are
          runtime features here, not a product. The keeper stops being an
          execution layer and becomes a scheduler — which is all it should ever
          have been.
        </p>
        <p>
          Five contracts became one program. Two invariants come free from
          addressing rather than from a check that could be forgotten: a payment
          PDA seeded by{" "}
          <span className="font-mono text-ink/80">(merchant, order_ref)</span>{" "}
          makes a retried checkout idempotent, and a subscription PDA seeded by{" "}
          <span className="font-mono text-ink/80">(subscriber, plan)</span> makes
          a double-subscribe impossible.
        </p>
      </Block>

      <Block heading="Where it runs">
        <p>
          On devnet, against the program below, deployed and exercised. Open the
          app and it underwrites the wallet your browser generates from that
          wallet&rsquo;s own history — no sign-up, no key to bring. The merchant
          dashboard needs no key either: a merchant&rsquo;s trade is public state
          under their own address.
        </p>
        <p className="font-mono text-sm text-ink/45">
          devnet · <span className="break-all">{PROGRAM_ID}</span>
        </p>
        <p className="pt-2">
          <a href={APPS.dashboard} className="text-lamp underline-offset-4 hover:underline">
            Open the app →
          </a>
        </p>
      </Block>
    </Page>
  );
}
