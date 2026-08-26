import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import { connect, type Chain } from "../src/chain.ts";
import { scoreFrom } from "../src/score.ts";
import { underwrite } from "../src/underwrite.ts";

/**
 * These run against a live validator, because the thing worth testing is that
 * the program and the off-chain mirror agree. A test double for the chain
 * would assert only that this file agrees with itself.
 *
 *   ./scripts/reset-local.sh
 *   pnpm --filter @polaris/gateway test
 */
describe("underwriting", () => {
  let chain: Chain;
  let protocolPda: PublicKey;

  before(async () => {
    chain = connect();
    protocolPda = chain.pda([Buffer.from("protocol")]);
    await chain.program.account.protocol.fetch(protocolPda);
  });

  const profileOf = (b: PublicKey) => chain.pda([Buffer.from("profile"), b.toBuffer()]);

  async function clusterNow(): Promise<number> {
    const slot = await chain.connection.getSlot();
    return (await chain.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  }

  async function attest(
    borrower: PublicKey,
    e: { age: number; tx: number; accounts: number; balance: bigint },
    opts: { observedAt?: number; signer?: Keypair } = {}
  ) {
    const observedAt = opts.observedAt ?? (await clusterNow());
    const signer = opts.signer;
    const builder = chain.program.methods
      .underwrite(e.age, e.tx, e.accounts, new BN(e.balance.toString()), new BN(observedAt))
      .accounts({
        underwriter: signer ? signer.publicKey : chain.underwriter.publicKey,
        borrower,
      });
    return signer ? builder.signers([signer]).rpc() : builder.rpc();
  }

  it("opens the smallest line for a wallet with no history at all", async () => {
    const fresh = Keypair.generate().publicKey;
    const r = await underwrite(fresh, chain);

    assert.equal(r.alreadyOpen, false);
    assert.equal(r.score, 520, "a wallet with nothing behind it starts at the floor");
    assert.equal(r.creditLimit, "200.00");
    assert.ok(r.signature, "a real attestation lands a real transaction");
  });

  it("agrees with the program on every shape of evidence", async () => {
    // The whole reason the mirror is allowed to exist. If a weight moves in
    // constants.rs and not in score.ts, this is what catches it.
    const shapes = [
      { age: 0, tx: 0, accounts: 0, balance: 0n },
      { age: 45, tx: 30, accounts: 1, balance: 150_000_000n },
      { age: 1_095, tx: 4_000, accounts: 12, balance: 3_000_000_000n },
      { age: 400, tx: 1_000_000, accounts: 100, balance: 10_000_000_000_000n },
      { age: 29, tx: 24, accounts: 0, balance: 99_999_999n },
    ];

    for (const shape of shapes) {
      const borrower = Keypair.generate().publicKey;
      await attest(borrower, shape);
      const onChain: any = await chain.program.account.creditProfile.fetch(profileOf(borrower));

      const mirrored = scoreFrom({
        walletAgeDays: shape.age,
        transactionCount: shape.tx,
        tokenAccounts: shape.accounts,
        stableBalance: shape.balance,
        observedAt: 0,
        transactionCountTruncated: false,
      });

      assert.equal(
        onChain.score,
        mirrored.score,
        `chain and mirror disagree on ${JSON.stringify({ ...shape, balance: shape.balance.toString() })}`
      );
    }
  });

  it("records the evidence it scored, so a limit can be explained later", async () => {
    const borrower = Keypair.generate().publicKey;
    await attest(borrower, { age: 365, tx: 500, accounts: 7, balance: 2_500_000_000n });
    const p: any = await chain.program.account.creditProfile.fetch(profileOf(borrower));

    assert.equal(p.walletAgeDays, 365);
    assert.equal(p.transactionCount, 500);
    assert.equal(p.tokenAccounts, 7);
    assert.equal(p.stableBalance.toString(), "2500000000");
    assert.ok(Number(p.underwrittenAt) > 0);
  });

  it("refuses to underwrite the same borrower twice", async () => {
    // Otherwise an underwriter could re-attest a borrower into a better band
    // every time their balance happened to look good.
    const borrower = Keypair.generate().publicKey;
    await attest(borrower, { age: 0, tx: 0, accounts: 0, balance: 0n });

    await assert.rejects(
      () => attest(borrower, { age: 3_000, tx: 999_999, accounts: 99, balance: 9_000_000_000n }),
      /AlreadyUnderwritten/,
      "a second attestation must not move an open line"
    );

    const p: any = await chain.program.account.creditProfile.fetch(profileOf(borrower));
    assert.equal(p.score, 520, "the line stayed exactly where it opened");
  });

  it("refuses evidence that is too old to mean anything", async () => {
    const borrower = Keypair.generate().publicKey;
    const stale = (await clusterNow()) - 3_600;
    await assert.rejects(
      () => attest(borrower, { age: 900, tx: 5_000, accounts: 9, balance: 5_000_000_000n }, { observedAt: stale }),
      /EvidenceStale/
    );
  });

  it("refuses evidence timestamped in the future", async () => {
    const borrower = Keypair.generate().publicKey;
    const ahead = (await clusterNow()) + 3_600;
    await assert.rejects(
      () => attest(borrower, { age: 900, tx: 5_000, accounts: 9, balance: 5_000_000_000n }, { observedAt: ahead }),
      /EvidenceFromTheFuture/
    );
  });

  it("refuses anyone who is not the underwriter", async () => {
    // The attack this stops: anyone opening themselves a line at any score the
    // model will produce, for the cost of a signature.
    const impostor = Keypair.generate();
    await chain.connection.confirmTransaction(
      await chain.connection.requestAirdrop(impostor.publicKey, LAMPORTS_PER_SOL),
      "confirmed"
    );

    const borrower = Keypair.generate().publicKey;
    await assert.rejects(
      () => attest(borrower, { age: 3_000, tx: 999_999, accounts: 99, balance: 9_000_000_000n }, { signer: impostor }),
      /NotUnderwriter/
    );
  });

  it("leaves an established borrower's earned score alone", async () => {
    // The seeded borrower has repaid instalments, so their score is theirs.
    const seed = JSON.parse(
      await import("node:fs").then((fs) =>
        fs.promises.readFile(new URL("../../../deployments/localnet-seed.json", import.meta.url), "utf8")
      )
    );
    const borrower = new PublicKey(seed.seededBorrower);

    const before: any = await chain.program.account.creditProfile.fetch(profileOf(borrower));
    const r = await underwrite(borrower, chain);
    const after: any = await chain.program.account.creditProfile.fetch(profileOf(borrower));

    assert.equal(r.alreadyOpen, true);
    assert.equal(r.signature, null, "nothing should have been signed");
    assert.equal(after.score, before.score, "an earned score must not be re-attested");
  });
});
