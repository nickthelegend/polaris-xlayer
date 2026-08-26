/**
 * On-chain event indexer.
 *
 * The keeper writes an event for every action it takes, but the chain is the
 * only place that records what actually happened -- including actions no keeper
 * took, like a borrower repaying directly or a third party liquidating. This
 * backfills the audit log from LoanEngine logs so the event history is complete
 * rather than only the parts we caused.
 *
 * Idempotent: events are keyed on (transactionHash, logIndex), so re-running
 * over an overlapping block range inserts nothing new.
 */

import { collections } from "./client.js";

export type IndexedEvent = {
  type: string;
  loanId: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
};

export type IndexResult = {
  fromBlock: number;
  toBlock: number;
  found: number;
  inserted: number;
};

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

type RawLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
};

/**
 * Index LoanEngine logs into the event collection.
 *
 * Topic filtering is deliberately not applied: the engine emits a small,
 * bounded set of events and a public RPC will happily return all of them for a
 * contract over a modest range. Filtering client-side keeps this working even
 * if an event signature changes, at the cost of a slightly larger response.
 */
export async function indexEvents(params: {
  rpc: string;
  loanEngine: string;
  chainId: number;
  fromBlock: number;
  toBlock?: number;
  /** Cap the span so a public RPC does not reject the request. */
  maxSpan?: number;
}): Promise<IndexResult> {
  const { events } = await collections();

  const latestHex = (await rpc(params.rpc, "eth_blockNumber", [])) as string;
  const latest = Number(BigInt(latestHex));
  const span = params.maxSpan ?? 10_000;
  const from = Math.max(0, params.fromBlock);
  const to = Math.min(params.toBlock ?? latest, from + span, latest);

  const logs = (await rpc(params.rpc, "eth_getLogs", [
    {
      address: params.loanEngine,
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
    },
  ])) as RawLog[];

  let inserted = 0;
  for (const log of logs) {
    const transactionHash = log.transactionHash;
    const logIndex = Number(BigInt(log.logIndex));

    // topics[1] is the first indexed arg, which is loanId on every LoanEngine
    // event that carries one.
    const loanId = log.topics[1] ? BigInt(log.topics[1]).toString() : undefined;

    const existing = await events.findOne({
      transactionHash,
      "payload.logIndex": logIndex,
    });
    if (existing) continue;

    await events.insertOne({
      type: "chain.log",
      loanId,
      chainId: params.chainId,
      transactionHash,
      blockNumber: Number(BigInt(log.blockNumber)),
      payload: {
        logIndex,
        topic0: log.topics[0],
        topics: log.topics,
        data: log.data,
      },
      createdAt: new Date(),
    });
    inserted++;
  }

  return { fromBlock: from, toBlock: to, found: logs.length, inserted };
}

/** Highest block already indexed, so a run can resume where it stopped. */
export async function lastIndexedBlock(chainId: number): Promise<number | null> {
  const { events } = await collections();
  const doc = await events
    .find({ chainId, type: "chain.log" })
    .sort({ blockNumber: -1 })
    .limit(1)
    .toArray();
  return doc[0]?.blockNumber ?? null;
}
