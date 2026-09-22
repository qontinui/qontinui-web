/**
 * waitForRAGSetupCompletion waits through runnerPollDelay: a relayed target
 * is polled no faster than RELAY_POLL_INTERVAL_MS, and a RUNNER_NEEDS_LOCAL
 * refusal ends the wait with its message instead of being retried.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";

const runnerRequest = vi.fn();
vi.mock("@/lib/runner/api-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/runner/api-client")>();
  return {
    ...actual,
    runnerRequest: (...args: unknown[]) => runnerRequest(...args),
  };
});

import {
  RELAY_POLL_INTERVAL_MS,
  RUNNER_NEEDS_LOCAL,
  RunnerApiError,
} from "@/lib/runner/api-client";
import { createRAGSetupService } from "./rag-setup-service";

const relayTarget: RunnerTarget = {
  kind: "runner",
  runner: { id: "33333333-3333-4333-8333-333333333333", port: 9877 },
  locality: "not_local",
};

function progress(status: string): Response {
  return new Response(
    JSON.stringify({
      status,
      percent: 0,
      elementsProcessed: 0,
      totalElements: 0,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  runnerRequest.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForRAGSetupCompletion", () => {
  it("polls a relayed target no faster than RELAY_POLL_INTERVAL_MS", async () => {
    runnerRequest.mockImplementation(async () => progress("in_progress"));
    const service = createRAGSetupService(relayTarget);
    const wait = service
      .waitForRAGSetupCompletion("p1", { pollInterval: 1000, timeout: 1e9 })
      .catch(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    expect(runnerRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS - 1);
    expect(runnerRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runnerRequest).toHaveBeenCalledTimes(2);

    runnerRequest.mockImplementation(async () => progress("failed"));
    await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS);
    await wait;
  });

  it("ends the wait on a RUNNER_NEEDS_LOCAL refusal instead of retrying", async () => {
    const refusal = new RunnerApiError(
      403,
      "This action needs the runner on this machine — test",
      undefined,
      { code: RUNNER_NEEDS_LOCAL }
    );
    runnerRequest.mockRejectedValue(refusal);
    const service = createRAGSetupService(relayTarget);
    const outcome = service
      .waitForRAGSetupCompletion("p1", { pollInterval: 1000, timeout: 1e9 })
      .then(
        () => "resolved",
        (e: unknown) => e
      );

    await vi.advanceTimersByTimeAsync(RELAY_POLL_INTERVAL_MS * 4);
    expect(await outcome).toBe(refusal);
    expect(runnerRequest).toHaveBeenCalledTimes(1);
  });
});
