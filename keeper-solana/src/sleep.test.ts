import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sleepUntil } from "./cli.ts";

describe("sleepUntil", () => {
  it("resolves on its own when nothing wakes it", async () => {
    const began = Date.now();
    await sleepUntil(30, () => {});
    assert.ok(Date.now() - began >= 25, "should have actually waited");
  });

  it("resolves immediately when woken", async () => {
    let wake: (() => void) | null = null;
    const began = Date.now();
    const slept = sleepUntil(60_000, (w) => {
      wake = w;
    });
    // The bug this covers: a stop request was only noticed when the interval
    // elapsed, so Ctrl-C on a long cycle looked like a hang.
    wake!();
    await slept;
    assert.ok(Date.now() - began < 1_000, "waking must not wait out the interval");
  });

  it("is safe to wake more than once", async () => {
    let wake: (() => void) | null = null;
    const slept = sleepUntil(60_000, (w) => {
      wake = w;
    });
    wake!();
    wake!();
    await slept;
  });

  it("does not leave a timer running after being woken", async () => {
    let wake: (() => void) | null = null;
    const slept = sleepUntil(60_000, (w) => {
      wake = w;
    });
    wake!();
    await slept;
    // A timer left armed would keep the event loop alive and stop the process
    // from ever exiting, which is the other half of the same shutdown bug.
    const armed = (process as any)._getActiveHandles?.() ?? [];
    assert.ok(
      !armed.some((h: any) => h?.constructor?.name === "Timeout" && h?._idleTimeout === 60_000),
      "the 60s timer should have been cleared",
    );
  });
});
