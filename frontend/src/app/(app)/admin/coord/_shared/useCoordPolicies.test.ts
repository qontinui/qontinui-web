/**
 * Which list call owns the result, when more than one is in flight.
 *
 * `loadRules` is no longer only fired by the mount effect: `step()` refetches
 * after every mutation, and both policy surfaces now put `reload` on a Retry
 * button. Overlapping reads are therefore ordinary, and the interesting case
 * is the one where they DISAGREE — a slow failure landing after a fast
 * success.
 *
 * Last-write-wins is the wrong rule for a read whose freshness is the point:
 * it lets a superseded rejection re-assert `loadFailed` over a list the hook
 * has just successfully read, so the surface reports an outage it recovered
 * from, and toasts an error contradicting what is on screen. These tests pin
 * last-ASKED-wins in both directions.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const listCoordPolicies = vi.fn();
vi.mock("./coordPolicyApi", () => ({
  listCoordPolicies: (...a: never[]) => listCoordPolicies(...a),
  createCoordPolicy: vi.fn(),
  deleteCoordPolicy: vi.fn(),
  patchCoordPolicy: vi.fn(),
  restoreCoordPolicyDefault: vi.fn(),
  putCoordPolicySystemOverride: vi.fn(),
  deleteCoordPolicySystemOverride: vi.fn(),
}));

import { useCoordPolicies } from "./useCoordPolicies";
import type { CoordPolicyRow } from "./coordPolicies";

const ALL = () => true;

function row(policy_id: string): CoordPolicyRow {
  return { policy_id, priority: 100, enabled: true } as CoordPolicyRow;
}

/** A promise plus its resolvers, so a test can order two in-flight calls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing awaits this copy; it exists only so an unhandled rejection between
  // `reject()` and the hook's own catch cannot fail the run.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

beforeEach(() => {
  listCoordPolicies.mockReset();
  toastError.mockReset();
});

describe("overlapping list calls", () => {
  it("drops a superseded FAILURE instead of re-reporting an outage", async () => {
    // Mount succeeds so the hook is past its first load.
    listCoordPolicies.mockResolvedValueOnce({ policies: [row("a")], total: 1 });
    const { result } = renderHook(() => useCoordPolicies({ filter: ALL }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slow = deferred<{ policies: CoordPolicyRow[]; total: number }>();
    const fast = deferred<{ policies: CoordPolicyRow[]; total: number }>();
    listCoordPolicies
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);

    // Retry #1 (will fail slowly), then Retry #2 (succeeds first).
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.reload();
      second = result.current.reload();
    });

    await act(async () => {
      fast.resolve({ policies: [], total: 0 });
      await second;
    });
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.rules).toHaveLength(0);

    await act(async () => {
      slow.reject(new Error("coord unreachable"));
      await first;
    });

    // The workspace really is empty and the hook really did read it. The
    // stale rejection must not overwrite that with "unknown".
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.rules).toHaveLength(0);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("drops a superseded SUCCESS instead of resurrecting a stale list", async () => {
    listCoordPolicies.mockResolvedValueOnce({ policies: [], total: 0 });
    const { result } = renderHook(() => useCoordPolicies({ filter: ALL }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slow = deferred<{ policies: CoordPolicyRow[]; total: number }>();
    const fast = deferred<{ policies: CoordPolicyRow[]; total: number }>();
    listCoordPolicies
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.reload();
      second = result.current.reload();
    });

    await act(async () => {
      fast.resolve({ policies: [row("new")], total: 1 });
      await second;
    });
    expect(result.current.rules.map((r) => r.policy_id)).toEqual(["new"]);

    await act(async () => {
      slow.resolve({ policies: [row("old")], total: 1 });
      await first;
    });

    expect(result.current.rules.map((r) => r.policy_id)).toEqual(["new"]);
  });

  it("still reports a failure that is NOT superseded", async () => {
    listCoordPolicies.mockRejectedValueOnce(new Error("coord unreachable"));
    const { result } = renderHook(() => useCoordPolicies({ filter: ALL }));

    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
