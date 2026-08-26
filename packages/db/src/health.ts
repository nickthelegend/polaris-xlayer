/**
 * Keeper health.
 *
 * The failure mode that costs the most is not a keeper that errors — errors get
 * noticed. It is a keeper that stops. Nothing throws, no alert fires, and money
 * quietly stops moving until a merchant asks where their settlement is.
 *
 * So the signal here is the *absence* of work: a heartbeat written on every
 * pass, and a staleness check that treats silence as an incident. Everything
 * else — collection rate, overdue instalments, settlement backlog — is derived
 * from the book rather than self-reported, so a keeper cannot report itself
 * healthy while failing.
 */

import { collections } from "./client.js";
import { formatUnits } from "./loanbook.js";

export type KeeperJob =
  | "collection"
  | "subscriptions"
  | "close-out"
  | "liquidation"
  | "settlement";

export type Heartbeat = {
  job: KeeperJob;
  at: Date;
  considered: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
};

export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

export type HealthReport = {
  status: HealthStatus;
  checkedAt: string;
  jobs: Array<{
    job: KeeperJob;
    status: HealthStatus;
    lastRunAt: string | null;
    minutesSinceLastRun: number | null;
    lastResult: string | null;
  }>;
  book: {
    activeLoans: number;
    overdueInstalments: number;
    overdueValue: string;
    inDunning: number;
    liquidationCandidates: number;
    unsettledValue: string;
    collectionRate: number;
  };
  incidents: string[];
};

/**
 * How long a job may be silent before it counts as down. Generous relative to
 * the keeper's own interval so a single slow pass does not page anyone, tight
 * enough that a stopped keeper is caught within one collection window.
 */
export const STALE_AFTER_MINUTES: Record<KeeperJob, number> = {
  collection: 90,
  // Subscription periods are days or months, so silence here is far less
  // urgent than a missed instalment -- but a keeper that has not looked all
  // day is still a keeper that has stopped.
  subscriptions: 720,
  // Nothing urgent depends on a sweep running promptly; it only matters that
  // it runs at all, so a plan is never left permanently open over dust.
  "close-out": 1440,
  liquidation: 180,
  settlement: 360,
};

export async function recordHeartbeat(beat: Heartbeat): Promise<void> {
  const { events } = await collections();
  await events.insertOne({
    type: `keeper.heartbeat.${beat.job}`,
    chainId: 0,
    payload: {
      job: beat.job,
      considered: beat.considered,
      succeeded: beat.succeeded,
      failed: beat.failed,
      skipped: beat.skipped,
      durationMs: beat.durationMs,
    },
    createdAt: beat.at,
  });
}

/**
 * Assemble a health report from the book, not from anything the keeper says
 * about itself.
 */
export async function healthReport(chainId: number): Promise<HealthReport> {
  const { events, loans } = await collections();
  const now = new Date();
  const incidents: string[] = [];

  const jobs = await Promise.all(
    (["collection", "subscriptions", "close-out", "liquidation", "settlement"] as KeeperJob[]).map(
      async (job) => {
      const last = await events
        .find({ type: `keeper.heartbeat.${job}` })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();

      const beat = last[0];
      if (!beat) {
        return {
          job,
          status: "unknown" as HealthStatus,
          lastRunAt: null,
          minutesSinceLastRun: null,
          lastResult: null,
        };
      }

      const minutes = Math.floor((now.getTime() - beat.createdAt.getTime()) / 60_000);
      const p = beat.payload as Record<string, number>;
      const stale = minutes > STALE_AFTER_MINUTES[job];

      // A pass that acted and failed everything is degraded even if it ran.
      const allFailed = (p.failed ?? 0) > 0 && (p.succeeded ?? 0) === 0;
      const status: HealthStatus = stale ? "down" : allFailed ? "degraded" : "healthy";

      if (stale) {
        incidents.push(
          `${job} has not run for ${minutes} minutes (threshold ${STALE_AFTER_MINUTES[job]}).`
        );
      }
      if (allFailed) {
        incidents.push(`${job} last pass failed every attempt (${p.failed} failures).`);
      }

      return {
        job,
        status,
        lastRunAt: beat.createdAt.toISOString(),
        minutesSinceLastRun: minutes,
        lastResult: `${p.considered ?? 0} considered · ${p.succeeded ?? 0} ok · ${p.failed ?? 0} failed`,
      };
      }
    )
  );

  const docs = await loans.find({ chainId }).toArray();

  let overdue = 0;
  let overdueValue = 0n;
  let inDunning = 0;
  let unsettled = 0n;
  let due = 0;
  let collected = 0;

  for (const loan of docs) {
    for (const inst of loan.installments) {
      if (inst.dueAt <= now) {
        due += 1;
        if (inst.state === "paid") collected += 1;
      }
      if (loan.status === "active" && inst.dueAt <= now && inst.state !== "paid") {
        overdue += 1;
        overdueValue += BigInt(inst.amountRaw);
      }
      if (inst.state === "dunning") inDunning += 1;
      if (inst.state === "paid" && !(inst as { settledAt?: Date }).settledAt) {
        unsettled += BigInt(inst.amountRaw);
      }
    }
  }

  const activeLoans = docs.filter((l) => l.status === "active").length;
  const candidates = docs.filter((l) => l.liquidationCandidate && l.status === "active").length;
  const collectionRate = due === 0 ? 100 : (collected / due) * 100;

  // A collection rate that has fallen through the floor is either a bug or an
  // attack, and both want paging.
  if (due >= 5 && collectionRate < 60) {
    incidents.push(`Collection rate is ${collectionRate.toFixed(1)}% across ${due} due instalments.`);
  }

  const worst = jobs.some((j) => j.status === "down")
    ? "down"
    : jobs.some((j) => j.status === "degraded")
      ? "degraded"
      : jobs.every((j) => j.status === "unknown")
        ? "unknown"
        : incidents.length > 0
          ? "degraded"
          : "healthy";

  return {
    status: worst,
    checkedAt: now.toISOString(),
    jobs,
    book: {
      activeLoans,
      overdueInstalments: overdue,
      overdueValue: formatUnits(overdueValue, 6),
      inDunning,
      liquidationCandidates: candidates,
      unsettledValue: formatUnits(unsettled, 6),
      collectionRate,
    },
    incidents,
  };
}

/** Terminal-friendly rendering, for `pnpm keeper:health`. */
export function renderHealth(report: HealthReport): string {
  const mark = { healthy: "OK  ", degraded: "WARN", down: "DOWN", unknown: "??  " };
  const lines = [
    `PolarisPay keeper — ${report.status.toUpperCase()}`,
    "",
  ];
  for (const j of report.jobs) {
    const age =
      j.minutesSinceLastRun === null ? "never run" : `${j.minutesSinceLastRun}m ago`;
    lines.push(`  ${mark[j.status]} ${j.job.padEnd(12)} ${age.padEnd(14)} ${j.lastResult ?? ""}`);
  }
  lines.push(
    "",
    `  active loans           ${report.book.activeLoans}`,
    `  overdue instalments    ${report.book.overdueInstalments} (${report.book.overdueValue})`,
    `  in dunning             ${report.book.inDunning}`,
    `  liquidation candidates ${report.book.liquidationCandidates}`,
    /*
     * `unsettledValue` is still computed and still on the report object, because
     * it is a real quantity: instalments collected and not yet paid out. It is
     * no longer printed as an operational figure, because under the deployed
     * contracts nobody is owed it. PolarisLoanEngine.createLoan pays the
     * merchant the full principal at origination out of protocol liquidity, so
     * a collected instalment is a repayment to the protocol, not a merchant
     * balance. Printing it beside "overdue" and "in dunning" invited the reader
     * to treat it as a debt the keeper was failing to clear.
     */
    `  collected, not paid out ${report.book.unsettledValue} (repayments, not merchant debt)`,
    `  collection rate        ${report.book.collectionRate.toFixed(1)}%`
  );
  if (report.incidents.length > 0) {
    lines.push("", "incidents:");
    for (const i of report.incidents) lines.push(`  - ${i}`);
  }
  return lines.join("\n");
}
