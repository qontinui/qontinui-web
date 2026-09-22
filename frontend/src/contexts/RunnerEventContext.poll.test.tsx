/**
 * useEventTriggeredFetch's fallback poll (the only source of updates when no
 * event stream exists) goes through startRunnerPoll: a relayed target is
 * polled no faster than RELAY_POLL_INTERVAL_MS, the cadence follows the target
 * when it changes mid-poll, and a RUNNER_NEEDS_LOCAL refusal stops the poll
 * for good with its message as `error`.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerTarget } from "@/lib/runner/target";

const RUNNER_ID = "33333333-3333-4333-8333-333333333333";

const relayTarget: RunnerTarget = {
  kind: "runner",
  runner: { id: RUNNER_ID, port: 9877, name: "box" },
  locality: "not_local",
};
const loopbackTarget: RunnerTarget = {
  kind: "runner",
  runner: { id: RUNNER_ID, port: 9877, name: "box" },
  locality: "local",
};

let currentTarget: RunnerTarget = relayTarget;
vi.mock("@/contexts/active-runner-context", () => ({
  useRunnerTarget: () => currentTarget,
}));

const runnerFetch = vi.fn();
vi.mock("@/lib/runner/api-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/runner/api-client")>();
  return {
    ...actual,
    runnerFetch: (...args: unknown[]) => runnerFetch(...args),
  };
});

import {
  RELAY_POLL_INTERVAL_MS,
  RUNNER_NEEDS_LOCAL,
  RunnerApiError,
} from "@/lib/runner/api-client";
import { useEventTriggeredFetch } from "./RunnerEventContext";

const REQUESTED_MS = 2000;
const originalLocation = window.location;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function render() {
  return renderHook(() =>
    useEventTriggeredFetch<{ ok: boolean }>("some-channel", "/status", {
      fallbackPollMs: REQUESTED_MS,
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin: "http://localhost:3001" },
    writable: true,
  });
  currentTarget = relayTarget;
  runnerFetch.mockReset();
  runnerFetch.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
});

describe("useEventTriggeredFetch fallback poll", () => {
  it("polls a relayed target no faster than RELAY_POLL_INTERVAL_MS", async () => {
    const { unmount } = render();
    await advance(0);
    const afterMount = runnerFetch.mock.calls.length;
    expect(afterMount).toBe(1);

    await advance(REQUESTED_MS * 3);
    expect(runnerFetch.mock.calls.length).toBe(afterMount);

    await advance(RELAY_POLL_INTERVAL_MS - REQUESTED_MS * 3);
    expect(runnerFetch.mock.calls.length).toBe(afterMount + 1);
    unmount();
  });

  it("stops polling after a RUNNER_NEEDS_LOCAL refusal and reports its message", async () => {
    const refusal = new RunnerApiError(
      403,
      "This action needs the runner on this machine — test",
      undefined,
      { code: RUNNER_NEEDS_LOCAL }
    );
    runnerFetch.mockRejectedValue(refusal);
    const { result, unmount } = render();
    await advance(0);
    expect(result.current.error).toBe(refusal.message);

    // At most one more request (the first poll tick learns of the refusal),
    // then nothing, however long we wait.
    await advance(RELAY_POLL_INTERVAL_MS);
    const settled = runnerFetch.mock.calls.length;
    expect(settled).toBeLessThanOrEqual(2);
    await advance(RELAY_POLL_INTERVAL_MS * 4);
    expect(runnerFetch.mock.calls.length).toBe(settled);
    unmount();
  });

  it("re-evaluates the interval when the target changes mid-poll", async () => {
    currentTarget = loopbackTarget;
    const { rerender, unmount } = render();
    await advance(0);
    let before = runnerFetch.mock.calls.length;

    // Loopback: the requested cadence.
    await advance(REQUESTED_MS);
    expect(runnerFetch.mock.calls.length).toBe(before + 1);

    // The same runner now resolves to the relay: the poll slows to the relay
    // cadence.
    currentTarget = relayTarget;
    rerender();
    await advance(0);
    before = runnerFetch.mock.calls.length;
    await advance(REQUESTED_MS * 3);
    expect(runnerFetch.mock.calls.length).toBe(before);
    await advance(RELAY_POLL_INTERVAL_MS - REQUESTED_MS * 3);
    expect(runnerFetch.mock.calls.length).toBe(before + 1);
    unmount();
  });
});
