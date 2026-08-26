/**
 * KeeperHubClient -- the single path from a PolarisPay credit decision to a
 * transaction that is actually mined.
 *
 * Everything PolarisPay does on chain (collect an installment, liquidate a
 * defaulted loan, settle a merchant) goes through here so that all four of the
 * properties a credit product needs are enforced in one place:
 *
 *   1. simulate before broadcast   -- never spend gas to discover a revert
 *   2. idempotent writes           -- a retry storm must not double-charge
 *   3. terminal reconciliation     -- "did it land?" always has an answer
 *   4. an auditable receipt        -- every charge is disputable evidence
 *
 * The KeeperHub side of that is documented at https://docs.keeperhub.com --
 * direct execution, `simulate`, `Idempotency-Key`, and the `/status` route.
 */

import {
  classifyFailure,
  errorFromResponse,
  KeeperHubError,
} from "./errors.js";
import type {
  CheckAndExecuteInput,
  ConditionNotMet,
  ContractCallInput,
  ExecuteAccepted,
  ExecutionStatusResponse,
  SimulationResult,
  TransferInput,
} from "./types.js";
import { isTerminal } from "./types.js";

export type KeeperHubClientOptions = {
  /** Organization API key. Starts with `kh_`. */
  apiKey: string;
  /** Override for self-hosted deployments. */
  baseUrl?: string;
  /** Per-request network timeout. */
  requestTimeoutMs?: number;
  /** How long `waitForTerminal` will poll before giving up. */
  statusTimeoutMs?: number;
  /** Poll interval for `waitForTerminal`. */
  statusPollMs?: number;
  /** Network-level retries for transient failures (429/5xx/timeouts). */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  onEvent?: (event: KeeperHubEvent) => void;
};

export type KeeperHubEvent =
  | { type: "request"; method: string; path: string; attempt: number }
  | { type: "retry"; path: string; attempt: number; delayMs: number; reason: string }
  | { type: "simulated"; ok: boolean; gasEstimate?: string; revertReason?: string }
  | { type: "accepted"; executionId: string }
  | { type: "terminal"; executionId: string; status: string; transactionHash?: string };

const DEFAULTS = {
  baseUrl: "https://app.keeperhub.com",
  requestTimeoutMs: 30_000,
  // A sponsored Base charge is typically terminal in well under a minute, but
  // a mainnet fee spike can stretch it. KeeperHub itself allows 120s per
  // broadcast attempt plus up to 3 attempts, so budget past that.
  statusTimeoutMs: 420_000,
  statusPollMs: 3_000,
  maxRetries: 3,
} as const;

export class KeeperHubClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly statusTimeoutMs: number;
  private readonly statusPollMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onEvent: (event: KeeperHubEvent) => void;

  constructor(options: KeeperHubClientOptions) {
    if (!options.apiKey) {
      throw new KeeperHubError("auth", "A KeeperHub API key is required.");
    }
    if (!options.apiKey.startsWith("kh_")) {
      // Fail loudly rather than sending a token that will 401 on every call.
      throw new KeeperHubError(
        "auth",
        "KeeperHub API keys start with `kh_`. OAuth bearer tokens are not accepted on the REST execute routes."
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, "");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
    this.statusTimeoutMs = options.statusTimeoutMs ?? DEFAULTS.statusTimeoutMs;
    this.statusPollMs = options.statusPollMs ?? DEFAULTS.statusPollMs;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.onEvent = options.onEvent ?? (() => undefined);
  }

  // ---------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------

  private async request<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string }
  ): Promise<T> {
    let lastError: KeeperHubError | undefined;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      this.onEvent({ type: "request", method: init.method, path, attempt });

      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      };
      if (init.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      if (init.idempotencyKey) {
        headers["Idempotency-Key"] = init.idempotencyKey;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: init.method,
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller.signal,
        });

        const text = await res.text();
        const parsed = text ? safeJson(text) : undefined;

        if (res.ok) {
          return parsed as T;
        }

        lastError = errorFromResponse(res.status, parsed);

        if (!lastError.retryable || attempt > this.maxRetries) {
          throw lastError;
        }

        // Honour Retry-After on a 429 rather than guessing.
        const retryAfter = Number(res.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffMs(attempt);

        this.onEvent({
          type: "retry",
          path,
          attempt,
          delayMs,
          reason: lastError.kind,
        });
        await sleep(delayMs);
      } catch (err) {
        if (err instanceof KeeperHubError) {
          if (!err.retryable || attempt > this.maxRetries) {
            throw err;
          }
          lastError = err;
        } else {
          const aborted = err instanceof Error && err.name === "AbortError";
          lastError = new KeeperHubError(
            aborted ? "timeout" : "server",
            aborted
              ? `Request to ${path} timed out after ${this.requestTimeoutMs}ms`
              : `Request to ${path} failed: ${(err as Error).message}`,
            { retryable: true }
          );
          if (attempt > this.maxRetries) {
            throw lastError;
          }
        }
        const delayMs = backoffMs(attempt);
        this.onEvent({ type: "retry", path, attempt, delayMs, reason: lastError.kind });
        await sleep(delayMs);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new KeeperHubError("unknown", `Request to ${path} failed`);
  }

  // ---------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------

  /**
   * Dry-run a contract call against current chain state. Signs nothing, sends
   * nothing, and returns the gas the network would charge plus the decoded
   * revert reason if it would fail.
   *
   * `simulate` must be a real boolean -- KeeperHub rejects the string `"true"`
   * rather than coercing it, so a mistyped flag can never fall through to a
   * live broadcast.
   */
  async simulateContractCall(input: ContractCallInput): Promise<SimulationResult> {
    const body = { ...toContractCallBody(input), simulate: true };
    const result = await this.request<SimulationResult>(
      "/api/execute/contract-call",
      { method: "POST", body }
    );
    const ok = result?.success !== false && !result?.revertReason;
    this.onEvent({
      type: "simulated",
      ok,
      gasEstimate: result?.gasEstimate,
      revertReason: result?.revertReason,
    });
    return result;
  }

  /**
   * Simulate, and throw a typed error if the call would not succeed. This is
   * the guard every PolarisPay charge runs through -- an installment that would
   * revert becomes a dunning event, not a burnt transaction.
   */
  async assertWouldSucceed(input: ContractCallInput): Promise<SimulationResult> {
    const sim = await this.simulateContractCall(input);
    const reason = sim?.revertReason ?? sim?.error;
    if (sim?.success === false || reason) {
      const kind = classifyFailure(reason);
      throw new KeeperHubError(
        kind === "unknown" ? "would_revert" : kind,
        `Simulation failed for ${input.functionName}: ${reason ?? "unknown reason"}`,
        { details: reason, retryable: false }
      );
    }
    return sim;
  }

  // ---------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------

  /**
   * Broadcast a contract call.
   *
   * On `idempotencyKey`: KeeperHub caches the response for a key -- including
   * failures -- and replays it for 24h. That is exactly right for protecting
   * against a double-charge, and exactly wrong for recovering from a transient
   * failure, because a retry with the same key returns the original error while
   * the chain has moved on (KeeperHub issue #1840).
   *
   * So the key is scoped per *attempt*, not per action: `chargeKey(id, attempt)`.
   * Transport-level duplicates of a single attempt still collapse, which is the
   * case we actually need protection from, while a genuine retry gets a fresh
   * execution. Guarding against double-repayment across attempts is the loan
   * contract's job, and `LoanEngine` already tracks repaid amounts per loan.
   */
  async executeContractCall(
    input: ContractCallInput,
    opts: { idempotencyKey?: string } = {}
  ): Promise<ExecuteAccepted> {
    const accepted = await this.request<ExecuteAccepted>(
      "/api/execute/contract-call",
      {
        method: "POST",
        body: toContractCallBody(input),
        idempotencyKey: opts.idempotencyKey,
      }
    );
    if (accepted?.executionId) {
      this.onEvent({ type: "accepted", executionId: accepted.executionId });
    }
    return accepted;
  }

  async executeTransfer(
    input: TransferInput,
    opts: { idempotencyKey?: string } = {}
  ): Promise<ExecuteAccepted> {
    const accepted = await this.request<ExecuteAccepted>("/api/execute/transfer", {
      method: "POST",
      body: {
        chainId: String(input.chainId),
        recipientAddress: input.recipientAddress,
        amount: input.amount,
        tokenAddress: input.tokenAddress,
      },
      idempotencyKey: opts.idempotencyKey,
    });
    if (accepted?.executionId) {
      this.onEvent({ type: "accepted", executionId: accepted.executionId });
    }
    return accepted;
  }

  /**
   * Read a value on chain, compare it, and execute only if the comparison
   * holds -- atomically, inside KeeperHub, with no gap for the state to change
   * between our read and our write.
   *
   * This is the primitive PolarisPay liquidation is built on:
   * `LoanEngine.checkLiquidatable(loanId) == true` -> `LoanEngine.liquidate(loanId)`.
   * Doing it as two calls from our side would mean racing every other keeper.
   */
  async checkAndExecute(
    input: CheckAndExecuteInput,
    opts: { idempotencyKey?: string } = {}
  ): Promise<ExecuteAccepted | ConditionNotMet> {
    const result = await this.request<ExecuteAccepted | ConditionNotMet>(
      "/api/execute/check-and-execute",
      {
        method: "POST",
        body: {
          contractAddress: input.contractAddress,
          chainId: String(input.chainId),
          functionName: input.functionName,
          functionArgs: input.functionArgs,
          abi: input.abi,
          condition: input.condition,
          action: {
            contractAddress: input.action.contractAddress,
            functionName: input.action.functionName,
            functionArgs: input.action.functionArgs,
            abi: input.action.abi,
            gasLimitMultiplier: input.action.gasLimitMultiplier,
          },
        },
        idempotencyKey: opts.idempotencyKey,
      }
    );
    if ("executionId" in result && result.executionId) {
      this.onEvent({ type: "accepted", executionId: result.executionId });
    }
    return result;
  }

  // ---------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------

  async getStatus(executionId: string): Promise<ExecutionStatusResponse> {
    // Segment order matters: /api/execute/{id}/status. The transposed form 405s.
    return await this.request<ExecutionStatusResponse>(
      `/api/execute/${encodeURIComponent(executionId)}/status`,
      { method: "GET" }
    );
  }

  /**
   * Poll until the execution reaches a terminal state.
   *
   * This is not optional bookkeeping. The execute response carries no
   * transaction hash, and a gas-sponsored execution runs through a smart
   * account -- so the keeper wallet's nonce, native balance and explorer
   * transaction list never change. Checking those would report a successful
   * charge as a failure. `/status` is the only source of truth.
   */
  async waitForTerminal(
    executionId: string,
    opts: { timeoutMs?: number; pollMs?: number } = {}
  ): Promise<ExecutionStatusResponse> {
    const timeoutMs = opts.timeoutMs ?? this.statusTimeoutMs;
    const pollMs = opts.pollMs ?? this.statusPollMs;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const status = await this.getStatus(executionId);
      if (isTerminal(status.status)) {
        this.onEvent({
          type: "terminal",
          executionId,
          status: status.status,
          transactionHash: status.transactionHash,
        });
        return status;
      }
      if (Date.now() >= deadline) {
        throw new KeeperHubError(
          "timeout",
          `Execution ${executionId} did not reach a terminal status within ${timeoutMs}ms (last status: ${status.status})`,
          { executionId, retryable: true }
        );
      }
      await sleep(pollMs);
    }
  }

  /** Broadcast and reconcile in one call. Throws if the transaction failed. */
  async executeAndConfirm(
    input: ContractCallInput,
    opts: { idempotencyKey?: string; timeoutMs?: number } = {}
  ): Promise<ExecutionStatusResponse> {
    const accepted = await this.executeContractCall(input, opts);
    if (!accepted?.executionId) {
      throw new KeeperHubError(
        "unknown",
        `Execute did not return an executionId for ${input.functionName}`
      );
    }
    const status = await this.waitForTerminal(accepted.executionId, {
      timeoutMs: opts.timeoutMs,
    });
    if (status.status !== "completed") {
      throw new KeeperHubError(
        "reverted",
        `Execution ${accepted.executionId} ended as ${status.status}: ${status.error ?? "no error detail"}`,
        { executionId: accepted.executionId, details: status.error, retryable: false }
      );
    }
    return status;
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

/**
 * The execute routes want every scalar as a string, and `functionArgs` as a
 * *stringified* JSON array -- a real array or a numeric chainId is rejected
 * (KeeperHub issue #1841). Centralising the encoding here means no caller has
 * to remember it.
 */
function toContractCallBody(input: ContractCallInput): Record<string, unknown> {
  return {
    contractAddress: input.contractAddress,
    chainId: String(input.chainId),
    functionName: input.functionName,
    functionArgs: input.functionArgs,
    abi: input.abi,
    value: input.value,
    gasLimitMultiplier: input.gasLimitMultiplier,
    priorityFeeGwei: input.priorityFeeGwei,
  };
}

/** Encode call arguments the way the execute routes expect. */
export function encodeArgs(args: readonly unknown[]): string {
  return JSON.stringify(args.map((a) => (typeof a === "bigint" ? a.toString() : a)));
}

/**
 * Per-attempt idempotency key. See the note on `executeContractCall` for why
 * the attempt number is part of the key rather than a stable per-action id.
 */
export function chargeKey(actionId: string, attempt: number): string {
  return `${actionId}-a${attempt}`;
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s, capped -- plus jitter so a fleet of keepers waking on the same
  // schedule does not retry in lockstep.
  const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}
