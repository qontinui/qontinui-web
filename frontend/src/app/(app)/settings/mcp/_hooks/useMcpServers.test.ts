/**
 * useMcpServers' status poll goes through useRunnerPoll: a relayed target is
 * polled no faster than RELAY_POLL_INTERVAL_MS, the cadence follows the
 * target when it changes mid-poll, and a RUNNER_NEEDS_LOCAL refusal stops the
 * poll for good (its message is shown).
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
const getMcpServersStatus = vi.fn();
const api = {
  getSettingsMcpServers: vi.fn(async () => []),
  getMcpServersStatus,
};

vi.mock("@/lib/runner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/runner-api")>();
  return {
    ...actual,
    useRunnerApi: () => api,
    useRunnerHealth: () => ({ isOffline: false, isLoading: false }),
    useRunnerTarget: () => currentTarget,
  };
});

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

import {
  RELAY_POLL_INTERVAL_MS,
  RUNNER_NEEDS_LOCAL,
  RunnerApiError,
} from "@/lib/runner-api";
import { useMcpServers } from "./useMcpServers";

const REQUESTED_MS = 10_000;
const originalLocation = window.location;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, origin: "http://localhost:3001" },
    writable: true,
  });
  currentTarget = relayTarget;
  getMcpServersStatus.mockReset();
  getMcpServersStatus.mockResolvedValue([]);
  toastError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
});

describe("useMcpServers status poll", () => {
  it("polls a relayed target no faster than RELAY_POLL_INTERVAL_MS", async () => {
    const { unmount } = renderHook(() => useMcpServers());
    await advance(0);
    const afterMount = getMcpServersStatus.mock.calls.length; // loadAll

    await advance(REQUESTED_MS + 1000);
    expect(getMcpServersStatus.mock.calls.length).toBe(afterMount);

    await advance(RELAY_POLL_INTERVAL_MS - REQUESTED_MS);
    expect(getMcpServersStatus.mock.calls.length).toBe(afterMount + 1);
    unmount();
  });

  it("stops polling after a RUNNER_NEEDS_LOCAL refusal and shows its message", async () => {
    const refusal = new RunnerApiError(
      403,
      "This action needs the runner on this machine — test",
      undefined,
      { code: RUNNER_NEEDS_LOCAL }
    );
    const { unmount } = renderHook(() => useMcpServers());
    await advance(0);
    getMcpServersStatus.mockRejectedValue(refusal);
    const before = getMcpServersStatus.mock.calls.length;

    await advance(RELAY_POLL_INTERVAL_MS);
    expect(getMcpServersStatus.mock.calls.length).toBe(before + 1);
    expect(toastError).toHaveBeenCalledWith(refusal.message);

    await advance(RELAY_POLL_INTERVAL_MS * 4);
    expect(getMcpServersStatus.mock.calls.length).toBe(before + 1);
    unmount();
  });

  it("re-evaluates the interval when the target changes mid-poll", async () => {
    currentTarget = loopbackTarget;
    const { rerender, unmount } = renderHook(() => useMcpServers());
    await advance(0);
    let before = getMcpServersStatus.mock.calls.length;

    // Loopback: the requested cadence.
    await advance(REQUESTED_MS);
    expect(getMcpServersStatus.mock.calls.length).toBe(before + 1);

    // The same runner now resolves to the relay: the next tick waits the
    // relay cadence, not the requested one.
    currentTarget = relayTarget;
    rerender();
    await advance(0);
    before = getMcpServersStatus.mock.calls.length;
    await advance(REQUESTED_MS + 1000);
    expect(getMcpServersStatus.mock.calls.length).toBe(before);
    await advance(RELAY_POLL_INTERVAL_MS - REQUESTED_MS);
    expect(getMcpServersStatus.mock.calls.length).toBe(before + 1);
    unmount();
  });
});
