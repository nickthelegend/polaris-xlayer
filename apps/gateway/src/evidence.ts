import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * What the underwriter reads off the cluster before opening a line.
 *
 * Every field here is a fact anyone can check against the same RPC. That is
 * the point: the program applies the weights, so the underwriter's job is to
 * report honestly rather than to decide, and a borrower who disputes their
 * limit can re-read their own wallet and get the same four numbers.
 */
export type Evidence = {
  walletAgeDays: number;
  transactionCount: number;
  tokenAccounts: number;
  stableBalance: bigint;
  /** Cluster time the reading was taken at. The program refuses stale ones. */
  observedAt: number;
  /** True when the signature history hit the walk limit and was not exhausted. */
  transactionCountTruncated: boolean;
};

/**
 * How far back to walk a wallet's signatures.
 *
 * Signature history is paginated at 1,000 and a busy wallet has years of it.
 * Walking all of it would make underwriting take minutes and hammer the RPC,
 * and it would not change the answer: activity points cap out at 1,250
 * transactions, so anything past a couple of pages is already at the ceiling.
 * The walk stops early for that reason, and says so in the evidence rather
 * than reporting a truncated count as if it were complete.
 */
const PAGE = 1_000;
const MAX_PAGES = 3;

/** Enough to reach the activity cap several times over. */
const ACTIVITY_CEILING = 1_250;

export async function readEvidence(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey
): Promise<Evidence> {
  const [history, tokenAccounts, stableBalance, observedAt] = await Promise.all([
    walkSignatures(connection, wallet),
    countTokenAccounts(connection, wallet),
    readStableBalance(connection, wallet, mint),
    clusterTime(connection),
  ]);

  return {
    walletAgeDays: history.ageDays,
    transactionCount: history.count,
    tokenAccounts,
    stableBalance,
    observedAt,
    transactionCountTruncated: history.truncated,
  };
}

async function walkSignatures(
  connection: Connection,
  wallet: PublicKey
): Promise<{ count: number; ageDays: number; truncated: boolean }> {
  let before: string | undefined;
  let count = 0;
  let oldestBlockTime: number | null = null;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await connection.getSignaturesForAddress(wallet, {
      limit: PAGE,
      ...(before ? { before } : {}),
    });
    if (batch.length === 0) break;

    count += batch.length;
    const last = batch[batch.length - 1]!;
    /*
     * blockTime is null on entries the node has pruned the block for. Keeping
     * the last non-null one is right: signatures come back newest-first, so a
     * null at the tail means "older than this", never "newer".
     */
    for (const entry of batch) {
      if (entry.blockTime != null) oldestBlockTime = entry.blockTime;
    }

    if (batch.length < PAGE) break;
    before = last.signature;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  // A wallet whose history we stopped walking is at least this active. Saying
  // so is more honest than reporting the partial count as the whole.
  const reported = truncated ? Math.max(count, ACTIVITY_CEILING) : count;

  const now = Math.floor(Date.now() / 1000);
  const ageDays =
    oldestBlockTime === null ? 0 : Math.max(0, Math.floor((now - oldestBlockTime) / 86_400));

  return { count: reported, ageDays, truncated };
}

async function countTokenAccounts(connection: Connection, wallet: PublicKey): Promise<number> {
  const { value } = await connection.getParsedTokenAccountsByOwner(wallet, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });
  /*
   * Only accounts that actually hold something count. An empty token account
   * is free to create, so counting them would make breadth the cheapest signal
   * on the list to farm -- open forty accounts, hold nothing, take the cap.
   */
  return value.filter((a) => {
    const amount = a.account.data.parsed?.info?.tokenAmount?.amount;
    return typeof amount === "string" && amount !== "0";
  }).length;
}

async function readStableBalance(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(mint, wallet, true);
  try {
    const balance = await connection.getTokenAccountBalance(ata);
    return BigInt(balance.value.amount);
  } catch {
    // No account for this mint at all. Not an error -- it is a borrower who
    // has never held the protocol stablecoin, which is worth zero points and
    // nothing more sinister than that.
    return 0n;
  }
}

/**
 * Cluster time, not wall time.
 *
 * The program checks the evidence timestamp against its own clock. On a local
 * validator those two can be minutes apart, and using the host's clock made
 * the freshness check fail against a chain that was perfectly happy.
 */
async function clusterTime(connection: Connection): Promise<number> {
  const slot = await connection.getSlot();
  const time = await connection.getBlockTime(slot);
  return time ?? Math.floor(Date.now() / 1000);
}
