/**
 * Drift detection between the chain and the book.
 *
 * `db:sync` overwrites the book with chain truth, which fixes drift but hides
 * that it happened. A credit book needs the opposite too: a read-only pass that
 * reports every disagreement without touching anything, so drift is visible
 * before it is silently repaired.
 *
 * Drift is not hypothetical. The keeper writes an installment as paid the
 * moment KeeperHub reports a terminal success; if that write lands and a later
 * reorg unwinds the transaction, the book claims money that the chain says was
 * never collected. This is the check that catches it.
 */

import { collections } from "./client.js";
import { formatUnits } from "./loanbook.js";

const SEL = {
  loanCount: "0xce63094d",
  getLoan: "0x504006ca",
} as const;

export type Drift = {
  loanId: string;
  field: "installmentsPaid" | "totalRepaid" | "status" | "missing" | "orphaned";
  chain: string;
  book: string;
  /** How much money the disagreement is worth, when it is measurable. */
  materialRaw?: string;
};

export type ReconcileReport = {
  chainLoans: number;
  bookLoans: number;
  checked: number;
  drift: Drift[];
  clean: boolean;
};

async function ethCall(rpc: string, to: string, data: string): Promise<string> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? "0x";
}

const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const slot = (hex: string, i: number) =>
  BigInt(`0x${hex.slice(2 + i * 64, 2 + (i + 1) * 64)}`);

const STATUS = ["active", "repaid", "liquidated"] as const;

/**
 * Compare every loan the chain knows about against the book. Read-only.
 */
export async function reconcile(params: {
  rpc: string;
  loanEngine: string;
  chainId: number;
}): Promise<ReconcileReport> {
  const { loans } = await collections();

  const countHex = await ethCall(params.rpc, params.loanEngine, SEL.loanCount);
  const chainCount = BigInt(countHex === "0x" ? "0x0" : countHex);
  const bookDocs = await loans.find({ chainId: params.chainId }).toArray();
  const byId = new Map(bookDocs.map((d) => [d.loanId, d]));

  const drift: Drift[] = [];
  let checked = 0;

  for (let id = 1n; id <= chainCount; id++) {
    const raw = await ethCall(params.rpc, params.loanEngine, SEL.getLoan + word(id));
    if (raw === "0x" || raw.length < 130) continue;

    const totalRepaid = slot(raw, 4);
    const installmentsPaid = Number(slot(raw, 6));
    const status = STATUS[Number(slot(raw, 9))] ?? "active";

    const doc = byId.get(id.toString());
    if (!doc) {
      drift.push({
        loanId: id.toString(),
        field: "missing",
        chain: `exists, ${installmentsPaid} paid`,
        book: "absent",
      });
      continue;
    }
    checked++;

    const bookPaid = doc.installments.filter((i) => i.state === "paid").length;
    if (bookPaid !== installmentsPaid) {
      drift.push({
        loanId: doc.loanId,
        field: "installmentsPaid",
        chain: String(installmentsPaid),
        book: String(bookPaid),
      });
    }

    if (BigInt(doc.totalRepaidRaw) !== totalRepaid) {
      const delta =
        BigInt(doc.totalRepaidRaw) > totalRepaid
          ? BigInt(doc.totalRepaidRaw) - totalRepaid
          : totalRepaid - BigInt(doc.totalRepaidRaw);
      drift.push({
        loanId: doc.loanId,
        field: "totalRepaid",
        chain: formatUnits(totalRepaid, 6),
        book: formatUnits(BigInt(doc.totalRepaidRaw), 6),
        materialRaw: delta.toString(),
      });
    }

    if (doc.status !== status) {
      drift.push({
        loanId: doc.loanId,
        field: "status",
        chain: status,
        book: doc.status,
      });
    }
  }

  // A book row above the chain's loan count has no counterpart at all.
  for (const doc of bookDocs) {
    const id = Number(doc.loanId);
    if (!Number.isFinite(id) || BigInt(Math.max(id, 0)) > chainCount) {
      drift.push({
        loanId: doc.loanId,
        field: "orphaned",
        chain: "absent",
        book: `${doc.orderId} (${doc.status})`,
      });
    }
  }

  return {
    chainLoans: Number(chainCount),
    bookLoans: bookDocs.length,
    checked,
    drift,
    clean: drift.length === 0,
  };
}

/** Total value the book claims that the chain does not agree with. */
export function materialExposure(report: ReconcileReport): bigint {
  return report.drift.reduce(
    (sum, d) => sum + (d.materialRaw ? BigInt(d.materialRaw) : 0n),
    0n
  );
}
