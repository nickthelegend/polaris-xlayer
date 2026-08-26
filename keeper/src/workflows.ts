/**
 * Push the keeper's schedules into KeeperHub's workflow builder.
 *
 * The CLI keeper in this repo is one of two ways to run PolarisPay's schedules.
 * The other is KeeperHub's own builder: the same collection and liquidation
 * logic expressed as a hosted workflow, so the schedule survives this process
 * being stopped and shows its runs in the KeeperHub dashboard rather than only
 * in our logs.
 *
 * `keeper/workflows/*.json` is the source of truth for those, and this pushes
 * them. Pushing the same definition twice collapses onto the first result
 * rather than creating a duplicate; see workflowKey for why that is keyed on
 * the content and not the name.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type WorkflowFile = {
  name: string;
  description?: string;
  nodes: unknown[];
  edges: unknown[];
};

export type PushResult = {
  file: string;
  name: string;
  outcome: "created" | "already-exists" | "failed";
  workflowId?: string;
  error?: string;
};

/** Reads every workflow definition, sorted so a run's output is stable. */
export async function loadWorkflows(dir: string): Promise<Array<{ file: string; body: WorkflowFile }>> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const out: Array<{ file: string; body: WorkflowFile }> = [];

  for (const file of names) {
    const raw = await readFile(join(dir, file), "utf8");
    const body = JSON.parse(raw) as WorkflowFile;

    // Fail on a malformed file rather than letting the API reject it with a
    // less specific message, so the file at fault is named.
    if (!(body.name && Array.isArray(body.nodes) && Array.isArray(body.edges))) {
      throw new Error(`${file} needs a name, a nodes array and an edges array`);
    }
    out.push({ file, body });
  }
  return out;
}

/**
 * The idempotency key for a push, derived from the definition itself.
 *
 * Keying on the workflow's name looks right and is not: `/api/workflows/create`
 * only creates, so pushing an edited workflow under the same name is a
 * genuinely different request and KeeperHub rejects it as a conflict -- which
 * is the correct answer, and is what it did the first time this ran.
 *
 * Hashing the body gives the semantics idempotency is actually for: an
 * identical push, whether from a retry or from running the command twice,
 * collapses onto the first result; an edited one creates a new workflow,
 * because creating is the only thing this endpoint does.
 */
export function workflowKey(body: WorkflowFile): string {
  const canonical = JSON.stringify({
    name: body.name,
    nodes: body.nodes,
    edges: body.edges,
  });
  return `polaris-workflow-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

export async function pushWorkflows(opts: {
  dir: string;
  apiKey: string;
  baseUrl: string;
  dryRun?: boolean;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<PushResult[]> {
  const log = opts.log ?? console.log;
  const doFetch = opts.fetchImpl ?? fetch;
  const files = await loadWorkflows(opts.dir);
  const results: PushResult[] = [];

  for (const { file, body } of files) {
    if (opts.dryRun) {
      log(`[dry-run] would push ${body.name} (${body.nodes.length} nodes) from ${file}`);
      results.push({ file, name: body.name, outcome: "already-exists" });
      continue;
    }

    try {
      const res = await doFetch(`${opts.baseUrl}/api/workflows/create`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
          "Idempotency-Key": workflowKey(body),
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};

      if (!res.ok) {
        results.push({
          file,
          name: body.name,
          outcome: "failed",
          error: String(parsed.error ?? `HTTP ${res.status}`),
        });
        log(`  ${body.name}: failed -- ${parsed.error ?? res.status}`);
        continue;
      }

      // A replay carries the marker KeeperHub adds to a cached response, which
      // is how a re-push is distinguished from a first one.
      const replayed = parsed.idempotentReplay === true;
      const workflowId = String(
        (parsed.workflow as { id?: string } | undefined)?.id ?? parsed.id ?? ""
      );

      results.push({
        file,
        name: body.name,
        outcome: replayed ? "already-exists" : "created",
        workflowId: workflowId || undefined,
      });
      log(`  ${body.name}: ${replayed ? "already pushed" : "created"}${workflowId ? ` (${workflowId})` : ""}`);
    } catch (err) {
      results.push({ file, name: body.name, outcome: "failed", error: (err as Error).message });
      log(`  ${body.name}: failed -- ${(err as Error).message}`);
    }
  }

  return results;
}
