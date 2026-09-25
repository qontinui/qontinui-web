/**
 * useSingleFlightPoll — the one-in-flight contract behind every coord-proxied
 * Dev Ops poll (plan
 * `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland` D5).
 *
 * Pinned: a tick that finds a request outstanding sends NOTHING (skipped, not
 * queued); an explicit refresh during a flight becomes exactly one trailing
 * request; a superseded setup's answer is discarded; nothing goes out after
 * unmount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSingleFlightPoll } from "./useSingleFlightPoll";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const INTERVAL = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSingleFlightPoll", () => {
  it("skips a tick while a request is outstanding, then polls normally", async () => {
    const flights: ReturnType<typeof deferred>[] = [];
    const poll = vi.fn(() => {
      const d = deferred();
      flights.push(d);
      return d.promise;
    });
    renderHook(() => useSingleFlightPoll(poll, INTERVAL));
    expect(poll).toHaveBeenCalledTimes(1);

    // Three ticks while the mount's request hangs: nothing is sent, and
    // nothing is queued for later either.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      flights[0].resolve();
      await flights[0].promise;
    });
    // Resolving does not fire the skipped ticks retroactively.
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("coalesces refreshes during a flight into ONE trailing request", async () => {
    const flights: ReturnType<typeof deferred>[] = [];
    const poll = vi.fn(() => {
      const d = deferred();
      flights.push(d);
      return d.promise;
    });
    const { result } = renderHook(() => useSingleFlightPoll(poll, INTERVAL));

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.refresh();
      b = result.current.refresh();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      flights[0].resolve();
      await flights[0].promise;
    });
    expect(poll).toHaveBeenCalledTimes(2);

    await act(async () => {
      flights[1].resolve();
      await Promise.all([a, b]);
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("discards a superseded setup's answer and polls again for the new one", async () => {
    const flights: ReturnType<typeof deferred>[] = [];
    const applied: string[] = [];
    const makePoll = (label: string) => async (isCurrent: () => boolean) => {
      const d = deferred();
      flights.push(d);
      await d.promise;
      if (isCurrent()) applied.push(label);
    };
    const pollA = vi.fn(makePoll("A"));
    const pollB = vi.fn(makePoll("B"));
    const { rerender } = renderHook(
      ({ poll }) => useSingleFlightPoll(poll, INTERVAL),
      { initialProps: { poll: pollA } }
    );
    rerender({ poll: pollB });
    // B's first read queues behind A's flight instead of running beside it.
    expect(pollA).toHaveBeenCalledTimes(1);
    expect(pollB).toHaveBeenCalledTimes(0);

    await act(async () => {
      flights[0].resolve();
      await flights[0].promise;
    });
    expect(pollB).toHaveBeenCalledTimes(1);
    await act(async () => {
      flights[1].resolve();
      await flights[1].promise;
    });
    expect(applied).toEqual(["B"]);
  });

  it("sends nothing after unmount", async () => {
    const d = deferred();
    const poll = vi.fn(() => d.promise);
    const { result, unmount } = renderHook(() =>
      useSingleFlightPoll(poll, INTERVAL)
    );
    act(() => {
      void result.current.refresh(); // queues a trailing run
    });
    unmount();
    await act(async () => {
      d.resolve();
      await d.promise;
      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("a poll that rejects does not leave the latch stuck", async () => {
    const poll = vi.fn(() => Promise.reject(new Error("boom")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useSingleFlightPoll(poll, INTERVAL));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(poll).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
