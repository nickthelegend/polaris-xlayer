import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import { connect, type Chain } from "../src/chain.ts";
import { createGateway } from "../src/server.ts";

/**
 * The point of these is that the transaction a wallet is handed actually
 * works. A test that asserted the response was base64 would pass on a
 * transaction the chain rejects.
 *
 * So: build one the way a Solana Pay wallet would, sign it the way a wallet
 * would, send it, and then check the chain moved.
 */
describe("solana pay", () => {
  let chain: Chain;
  let server: ReturnType<typeof createGateway>;
  let base: string;
  let merchantPda: PublicKey;
  let mint: PublicKey;

  before(async () => {
    chain = connect();
    server = createGateway(chain);
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;

    const seed = JSON.parse(
      await import("node:fs").then((fs) =>
        fs.promises.readFile(new URL("../../../deployments/localnet-seed.json", import.meta.url), "utf8")
      )
    );
    merchantPda = new PublicKey(seed.merchants[0].pda);
    mint = new PublicKey(seed.stablecoin);
  });

  after(() => server.close());

  /** A customer with SOL for rent and USDC to be charged, as a real one has. */
  async function fundedCustomer(usdc: bigint): Promise<Keypair> {
    const customer = Keypair.generate();
    await chain.connection.confirmTransaction(
      await chain.connection.requestAirdrop(customer.publicKey, 2 * LAMPORTS_PER_SOL),
      "confirmed"
    );

    const { createAssociatedTokenAccountIdempotent, mintTo } = await import("@solana/spl-token");
    const ata = await createAssociatedTokenAccountIdempotent(
      chain.connection,
      chain.underwriter,
      mint,
      customer.publicKey
    );
    if (usdc > 0n) {
      await mintTo(chain.connection, chain.underwriter, mint, ata, chain.underwriter, usdc);
    }
    return customer;
  }

  it("answers the spec's GET with a label and an icon", async () => {
    const res = await fetch(`${base}/pay/o1?merchant=${merchantPda}&amount=1000000`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { label: string; icon: string };
    assert.equal(body.label, "Polaris");
    assert.match(body.icon, /^https?:\/\/.+/);
  });

  it("hands a wallet a plan that the chain actually accepts", async () => {
    const customer = await fundedCustomer(500_000_000n);
    const order = `sp-${Date.now()}`;

    const res = await fetch(
      `${base}/pay/${order}?merchant=${merchantPda}&amount=180000000&installments=4&interval=604800`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: customer.publicKey.toBase58() }),
      }
    );
    const payload = (await res.json()) as { transaction: string; message: string };
    assert.equal(res.status, 200, JSON.stringify(payload));
    const { transaction, message } = payload;
    assert.match(message, /180\.00 USDC in 4 payments/);

    const tx = Transaction.from(Buffer.from(transaction, "base64"));

    // The customer never pays the fee. This is the sponsorship claim, checked
    // rather than asserted in a comment.
    assert.equal(
      tx.feePayer?.toBase58(),
      chain.underwriter.publicKey.toBase58(),
      "the gateway should be the fee payer"
    );

    // Two instructions, and both matter: a delegation without its loan is a
    // standing authorization the customer got nothing for.
    assert.equal(tx.instructions.length, 2, "approve and originate, in one transaction");

    const solBefore = await chain.connection.getBalance(customer.publicKey);
    const before = await chain.program.account.protocol.fetch(chain.pda([Buffer.from("protocol")]));

    // Exactly what a wallet does: add its signature to what it was handed.
    tx.partialSign(customer);
    const sig = await chain.connection.sendRawTransaction(tx.serialize());
    await chain.connection.confirmTransaction(sig, "confirmed");

    const after = await chain.program.account.protocol.fetch(chain.pda([Buffer.from("protocol")]));
    assert.equal(
      Number(after.loanCount.toString()),
      Number(before.loanCount.toString()) + 1,
      "a real loan should exist on chain"
    );

    const solAfter = await chain.connection.getBalance(customer.publicKey);
    assert.equal(solAfter, solBefore, "the customer should not have paid any SOL");

    // And the delegation the later instalments are drawn against is in place.
    const ata = getAssociatedTokenAddressSync(mint, customer.publicKey, true);
    const account = await getAccount(chain.connection, ata);
    assert.equal(
      account.delegate?.toBase58(),
      chain.pda([Buffer.from("protocol")]).toBase58(),
      "the protocol should be the delegate"
    );
    assert.ok(account.delegatedAmount > 0n);
  });

  it("underwrites a wallet it has never seen, mid-checkout", async () => {
    // The moment a payments product cannot afford to fail: a new customer
    // scanning a QR for the first time. There is no profile, so one is opened
    // from their own history before the plan is built.
    const customer = await fundedCustomer(300_000_000n);
    const profilePda = chain.pda([Buffer.from("profile"), customer.publicKey.toBuffer()]);
    assert.equal(
      await chain.program.account.creditProfile.fetchNullable(profilePda),
      null,
      "this wallet should start with no line at all"
    );

    const res = await fetch(
      `${base}/pay/new-${Date.now()}?merchant=${merchantPda}&amount=90000000`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: customer.publicKey.toBase58() }),
      }
    );
    assert.equal(res.status, 200, JSON.stringify(await res.json()));

    const opened = await chain.program.account.creditProfile.fetch(profilePda);
    assert.ok(opened.score >= 300 && opened.score <= 850);
    assert.ok(Number(opened.underwrittenAt) > 0, "the line was opened from chain history");
  });

  it("refuses a plan larger than the line it just underwrote", async () => {
    // A wallet with no history opens a 200 USDC line. Asking for 5,000 has to
    // fail at the chain, not be quietly trimmed to something affordable.
    const customer = await fundedCustomer(0n);
    const res = await fetch(
      `${base}/pay/big-${Date.now()}?merchant=${merchantPda}&amount=5000000000`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: customer.publicKey.toBase58() }),
      }
    );
    // The gateway builds it; the chain is what refuses it. Either the build
    // fails outright or the transaction does -- both are correct, and both are
    // better than a plan that opens over the limit.
    if (res.status === 200) {
      const { transaction } = (await res.json()) as { transaction: string };
      const tx = Transaction.from(Buffer.from(transaction, "base64"));
      tx.partialSign(customer);
      await assert.rejects(
        () => chain.connection.sendRawTransaction(tx.serialize()),
        /custom program error|InsufficientCredit|0x17ac|Error/
      );
    } else {
      assert.ok(res.status >= 400);
    }
  });

  it("says what is wrong with a malformed order rather than throwing", async () => {
    const cases: [string, RegExp][] = [
      [`/pay/x?amount=1000000`, /merchant is required/],
      [`/pay/x?merchant=${merchantPda}`, /amount is required/],
      [`/pay/x?merchant=${merchantPda}&amount=0`, /above zero/],
      [`/pay/x?merchant=${merchantPda}&amount=1000000&installments=99`, /between 1 and 24/],
      [`/pay/x?merchant=${merchantPda}&amount=1000000&interval=5`, /at least 60 seconds/],
    ];
    for (const [path, expected] of cases) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 400, path);
      assert.match(((await res.json()) as { error: string }).error, expected, path);
    }
  });

  it("serves a checkout page with a scannable code and no client javascript", async () => {
    const res = await fetch(
      `${base}/checkout?merchant=${merchantPda}&amount=180000000&order=page-1`
    );
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<svg/, "the QR should be rendered server-side");
    assert.match(html, /solana:/, "and encode a solana pay url");
    assert.ok(!/<script/i.test(html), "a checkout should not need a bundle to render");
  });
});
