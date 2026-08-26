import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { connect, type Chain } from "./chain.ts";
import { readEvidence, type Evidence } from "./evidence.ts";
import { baseLimit, explain, formatUnits, scoreFrom, type Band } from "./score.ts";

export type UnderwriteResult = {
  borrower: string;
  score: number;
  creditLimit: string;
  evidence: Evidence;
  reasons: string[];
  signature: string | null;
  /** True when the line already existed and was left exactly as it was. */
  alreadyOpen: boolean;
};

/**
 * Open a borrower's first credit line from their own history.
 *
 * Idempotent by design rather than by accident: the program refuses a second
 * attestation against a borrower with any record, so a client that retries --
 * or two clients that race -- cannot move a line that is already open. This
 * checks first so the common case returns the existing line rather than an
 * error a caller would have to parse.
 */
export async function underwrite(borrower: PublicKey, chain?: Chain): Promise<UnderwriteResult> {
  const c = chain ?? connect();
  const protocolPda = c.pda([Buffer.from("protocol")]);
  const profilePda = c.pda([Buffer.from("profile"), borrower.toBuffer()]);

  const protocol: any = await c.program.account.protocol.fetch(protocolPda);
  const mint = new PublicKey(protocol.stablecoin);

  const existing = await c.program.account.creditProfile.fetchNullable(profilePda);
  if (existing && !isUnproven(existing)) {
    const evidence = evidenceFromProfile(existing);
    // The limit comes from the score the borrower actually has, which by now
    // is the one they earned -- not from re-running the opening model over
    // evidence that may be months old.
    return {
      borrower: borrower.toBase58(),
      score: existing.score,
      creditLimit: formatUnits(baseLimit(existing.score)),
      evidence,
      reasons: explain(evidence, scoreFrom(evidence)),
      signature: null,
      alreadyOpen: true,
    };
  }

  const evidence = await readEvidence(c.connection, borrower, mint);
  const band: Band = scoreFrom(evidence);

  const signature = await c.program.methods
    .underwrite(
      evidence.walletAgeDays,
      evidence.transactionCount,
      evidence.tokenAccounts,
      new BN(evidence.stableBalance.toString()),
      new BN(evidence.observedAt)
    )
    // protocol and profile are both PDAs Anchor resolves from their seeds; only
    // the two keys it cannot derive are passed.
    .accounts({
      underwriter: c.underwriter.publicKey,
      borrower,
    })
    .rpc();

  const opened = await c.program.account.creditProfile.fetch(profilePda);

  return {
    borrower: borrower.toBase58(),
    score: opened.score,
    creditLimit: formatUnits(band.limit),
    evidence,
    reasons: explain(evidence, band),
    signature,
    alreadyOpen: false,
  };
}

function isUnproven(p: any): boolean {
  return (
    Number(p.onTimePayments) === 0 &&
    Number(p.latePayments) === 0 &&
    Number(p.liquidations) === 0 &&
    BigInt(p.activeDebt.toString()) === 0n &&
    Number(p.underwrittenAt) === 0
  );
}

function evidenceFromProfile(p: any): Evidence {
  return {
    walletAgeDays: Number(p.walletAgeDays ?? 0),
    transactionCount: Number(p.transactionCount ?? 0),
    tokenAccounts: Number(p.tokenAccounts ?? 0),
    stableBalance: BigInt((p.stableBalance ?? 0).toString()),
    observedAt: Number(p.underwrittenAt ?? 0),
    transactionCountTruncated: false,
  };
}
