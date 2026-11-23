/**
 * BackendAPI's client timeout aborts with a typed `TimeoutError` reason, so
 * the telemetry beacon reports it as an incident while still dropping caller
 * and navigation aborts (plan
 * 2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429, Phase 5).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackendAPI } from "./backend-api";

describe("BackendAPI request timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts a timed-out request with a TimeoutError reason", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            seen = init.signal ?? undefined;
            // Platform behaviour: reject with the signal's reason.
            seen?.addEventListener("abort", () => reject(seen?.reason));
          })
      )
    );
    const api = new BackendAPI({
      baseUrl: "https://api.test",
      timeout: 1_000,
      retries: 0,
    });

    vi.useFakeTimers();
    const pending = api.pauseExecution("exec-1");
    const settled = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect((seen?.reason as { name?: string } | undefined)?.name).toBe(
      "TimeoutError"
    );
  });
});
