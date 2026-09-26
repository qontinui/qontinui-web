/**
 * useVisiblePoll's in-flight guard (plan
 * `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5): while
 * the promise `fn` returned is outstanding, neither a tick nor a reveal starts
 * another call. It is the nav's pollers' single-flight, on every
 * `/admin/coord/*` page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVisiblePoll } from "./useVisiblePoll";

const INTERVAL = 1_000;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function reveal() {
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useVisiblePoll", () => {
  it("skips ticks and reveals while the previous call is outstanding", async () => {
    const flights: ReturnType<typeof deferred>[] = [];
    const fn = vi.fn(() => {
      const d = deferred();
      flights.push(d);
      return d.promise;
    });
    renderHook(() => useVisiblePoll(fn, INTERVAL, { runOnMount: true }));
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
      reveal();
    });
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      flights[0].resolve();
      await flights[0].promise;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a rejected call releases the guard", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("boom")));
    renderHook(() => useVisiblePoll(fn, INTERVAL, { runOnMount: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("without runOnMount it leaves the first call to the caller", async () => {
    const fn = vi.fn(() => Promise.resolve());
    renderHook(() => useVisiblePoll(fn, INTERVAL));
    expect(fn).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
