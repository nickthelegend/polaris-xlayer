import type { Metadata } from "next";
import { Page, Block } from "../components/Page";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What Polaris Pay reads, what it stores, and what it never sees. Underwriting is done from public on-chain state; there is no account and no key held on your behalf.",
};

export default function Privacy() {
  return (
    <Page
      title="What we read, and what we never see."
      lede="Polaris is non-custodial and there is no sign-up. Almost everything it knows about you is state you already published to a public chain."
    >
      <Block heading="What underwriting reads">
        <p>
          A credit line is derived from public on-chain state for the address you
          connect: how long it has existed, how many transactions it has signed,
          what tokens it holds, and its USDC balance. All of it is already
          readable by anyone with the address. We do not ask for a name, an
          email, a document, or a bank connection, and there is no credit-bureau
          lookup.
        </p>
      </Block>

      <Block heading="What we never hold">
        <p>
          We never hold your private key or your funds. The authorisation you
          give at checkout is an SPL delegate with a fixed allowance that
          decrements as it is used — it permits collection of what you agreed to
          and nothing else, and you can revoke it.
        </p>
        <p>
          The camera is used only to decode a payment code. The frame is decoded
          and discarded; no image is stored or transmitted.
        </p>
      </Block>

      <Block heading="What is public by design">
        <p>
          Payments, plans, collections and score changes are transactions on a
          public chain. Anyone can read them, including a merchant&rsquo;s own
          book, which is why the merchant dashboard needs no key. This is a
          property of settling on a public ledger, not a choice we made about
          your data — treat an address as pseudonymous rather than private.
        </p>
      </Block>

      <Block heading="Analytics">
        <p>
          This site runs no advertising trackers and sets no marketing cookies.
        </p>
      </Block>

      <Block heading="Status">
        <p>
          Polaris currently runs on devnet. Balances are test funds and nothing
          here is a regulated financial product or an offer of credit. Contact
          us through the repository if you need something removed or explained.
        </p>
      </Block>
    </Page>
  );
}
