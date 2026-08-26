/**
 * The loan book -- what the keeper reads to decide what to do this pass.
 *
 * In production this is backed by the same Supabase/Convex store the Polaris
 * apps already use. The interface is deliberately narrow so a deployment can
 * swap it without touching the keeper jobs, and the file-backed implementation
 * keeps the keeper runnable end to end with no database.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export type InstallmentState = "scheduled" | "paid" | "dunning" | "written_off";

export type Installment = {
  index: number;
  /** ISO date this installment becomes collectable. */
  dueAt: string;
  /** Base units, already scaled to the token's decimals. */
  amountRaw: string;
  amountDisplay: string;
  state: InstallmentState;
  attempts: number;
  /** Set while in the dunning ladder; the keeper skips until this passes. */
  nextAttemptAt?: string;
  lastFailureKind?: string;
  /**
   * The transaction that paid this instalment.
   *
   * The collection job has always written this, but the type did not declare
   * it, and the keeper runs under Node's strip-only TypeScript mode -- which
   * removes annotations without checking them. So the field was dropped on
   * every write and no collected instalment carried a link to its transaction,
   * which is precisely the thing an on-chain payments product exists to offer.
   */
  transactionHash?: string;
};

export type Loan = {
  loanId: string;
  borrower: string;
  merchantId?: string;
  /** Set once the ladder is exhausted; the liquidation job picks these up. */
  liquidationCandidate?: boolean;
  installments: Installment[];
};

export interface LoanBook {
  /** Installments due now and not already paid or parked in dunning. */
  dueInstallments(now: Date): Promise<Array<{ loan: Loan; installment: Installment }>>;
  /** Loans worth testing for liquidation this pass. */
  liquidationCandidates(): Promise<Loan[]>;
  recordAttempt(
    loanId: string,
    index: number,
    patch: Partial<Installment>
  ): Promise<void>;
  markLiquidationCandidate(loanId: string): Promise<void>;
  all(): Promise<Loan[]>;
}

export class FileLoanBook implements LoanBook {
  // Declared explicitly rather than as a constructor parameter property: the
  // keeper runs under Node's strip-only TypeScript mode, which rejects those.
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  private async read(): Promise<Loan[]> {
    if (!existsSync(this.path)) {
      return [];
    }
    return JSON.parse(await readFile(this.path, "utf8")) as Loan[];
  }

  private async write(loans: Loan[]): Promise<void> {
    await writeFile(this.path, `${JSON.stringify(loans, null, 2)}\n`, "utf8");
  }

  async all(): Promise<Loan[]> {
    return await this.read();
  }

  async dueInstallments(
    now: Date
  ): Promise<Array<{ loan: Loan; installment: Installment }>> {
    const loans = await this.read();
    const out: Array<{ loan: Loan; installment: Installment }> = [];
    for (const loan of loans) {
      for (const inst of loan.installments) {
        if (inst.state === "paid" || inst.state === "written_off") {
          continue;
        }
        if (new Date(inst.dueAt) > now) {
          continue;
        }
        // Respect the dunning back-off: a borrower who was short an hour ago is
        // probably still short, and re-charging burns rate limit for nothing.
        if (inst.nextAttemptAt && new Date(inst.nextAttemptAt) > now) {
          continue;
        }
        out.push({ loan, installment: inst });
      }
    }
    return out;
  }

  async liquidationCandidates(): Promise<Loan[]> {
    const loans = await this.read();
    return loans.filter((l) => l.liquidationCandidate === true);
  }

  async recordAttempt(
    loanId: string,
    index: number,
    patch: Partial<Installment>
  ): Promise<void> {
    const loans = await this.read();
    const loan = loans.find((l) => l.loanId === loanId);
    const inst = loan?.installments.find((i) => i.index === index);
    if (!inst) {
      return;
    }
    Object.assign(inst, patch);
    await this.write(loans);
  }

  async markLiquidationCandidate(loanId: string): Promise<void> {
    const loans = await this.read();
    const loan = loans.find((l) => l.loanId === loanId);
    if (loan) {
      loan.liquidationCandidate = true;
      await this.write(loans);
    }
  }
}
