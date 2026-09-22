/**
 * useRunnerMonitors' react-query refetchInterval goes through
 * runnerPollInterval on every refetch: a relayed target is polled no faster
 * than RELAY_POLL_INTERVAL_MS, the cadence follows the target when it changes
 * mid-poll, and a RUNNER_NEEDS_LOCAL refusal stops the poll for good.
 */

import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const getMonitors = vi.fn();
const runnerClient = { getMonitors, isAvailable: vi.fn(async () => true) };
vi.mock("@/lib/runner-client", () => ({
  useRunnerClient: () => runnerClient,
}));

import {
  RELAY_POLL_INTERVAL_MS,
  RUNNER_NEEDS_LOCAL,
  RunnerApiError,
} from "@/lib/runner/api-client";
import { useRunnerMonitors } from "./useRunnerMonitors";

const REQUESTED_MS = 2000;
const originalLocation = window.location;

const MONITORS = {
  monitors: [],
  available_descriptors: ["primary"],
};

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function render() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 1 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => useRunnerMonitors({ refetchInterval: REQUESTED_MS, staleTime: 0 }),
    { wrapper }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin: "http://localhost:3001" },
    writable: true,
  });
  currentTarget = relayTarget;
  getMonitors.mockReset();
  getMonitors.mockResolvedValue({ data: MONITORS });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
});

describe("useRunnerMonitors poll cadence", () => {
  it("polls a relayed target no faster than RELAY_POLL_INTERVAL_MS", async () => {
    const { unmount } = render();
    await advance(0);
    const afterMount = getMonitors.mock.calls.length;
    expect(afterMount).toBe(1);

    await advance(REQUESTED_MS * 3);
    expect(getMonitors.mock.calls.length).toBe(afterMount);

    await advance(RELAY_POLL_INTERVAL_MS - REQUESTED_MS * 3);
    expect(getMonitors.mock.calls.length).toBe(afterMount + 1);
    unmount();
  });

  it("stops polling after a RUNNER_NEEDS_LOCAL refusal", async () => {
    getMonitors.mockRejectedValue(
      new RunnerApiError(
        403,
        "This action needs the runner on this machine — test",
        undefined,
        { code: RUNNER_NEEDS_LOCAL }
      )
    );
    const { result, unmount } = render();
    await advance(100);
    const afterFirst = getMonitors.mock.calls.length;
    // Not retried: a refusal cannot change by asking again.
    expect(afterFirst).toBe(1);
    expect(result.current.isError).toBe(true);

    await advance(RELAY_POLL_INTERVAL_MS * 4);
    expect(getMonitors.mock.calls.length).toBe(afterFirst);
    unmount();
  });

  it("re-evaluates the interval when the target changes mid-poll", async () => {
    currentTarget = loopbackTarget;
    const { rerender, unmount } = render();
    await advance(0);
    let before = getMonitors.mock.calls.length;

    // Loopback: the requested cadence.
    await advance(REQUESTED_MS);
    expect(getMonitors.mock.calls.length).toBe(before + 1);

    // The same runner now resolves to the relay: the refetch interval is
    // re-evaluated and the relay floor applies.
    currentTarget = relayTarget;
    rerender();
    await advance(0);
    before = getMonitors.mock.calls.length;
    await advance(REQUESTED_MS * 3);
    expect(getMonitors.mock.calls.length).toBe(before);
    await advance(RELAY_POLL_INTERVAL_MS - REQUESTED_MS * 3);
    expect(getMonitors.mock.calls.length).toBe(before + 1);
    unmount();
  });
});
