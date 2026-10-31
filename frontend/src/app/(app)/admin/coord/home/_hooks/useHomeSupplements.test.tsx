/**
 * useHomeSupplements — when a read already out is joined, and when the new
 * read waits for it instead. The page tests cannot hold a read open, so the
 * two races are pinned here with the reads held on deferred promises:
 *
 * - an explicit refresh never joins a poll already out (the poll did not ask
 *   the gates read to bypass the proxy cache);
 * - a read that needs the queue counts never joins one issued before the
 *   page needed them (that read did not ask for them).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const fetchFleetHealth = vi.fn();
const fetchPendingAgentQuestions = vi.fn();
const getOverview = vi.fn();

vi.mock("@/lib/api/operations/coordFleet", () => ({
  fetchFleetHealth: (...a: unknown[]) => fetchFleetHealth(...a),
}));
vi.mock("@/lib/api/operations/agentQuestions", () => ({
  fetchPendingAgentQuestions: (...a: unknown[]) =>
    fetchPendingAgentQuestions(...a),
}));
vi.mock("@/services/admin-dev-service", () => ({
  adminDevService: { getOverview: (...a: unknown[]) => getOverview(...a) },
}));

import { useHomeSupplements } from "./useHomeSupplements";

/** A promise this test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ROSTER = { devices: [{ device_id: "d", state: "healthy" }] };
const OVERVIEW = { gates: [], counts: { open: 0 } };

beforeEach(() => {
  fetchFleetHealth.mockReset();
  fetchPendingAgentQuestions.mockReset();
  getOverview.mockReset();
  fetchPendingAgentQuestions.mockResolvedValue({ questions: [] });
  getOverview.mockResolvedValue(OVERVIEW);
});

describe("useHomeSupplements — joining a read already out", () => {
  it("runs an explicit refresh after a poll already out, asking for refresh", async () => {
    const first = deferred<unknown>();
    fetchFleetHealth.mockReturnValueOnce(first.promise);
    fetchFleetHealth.mockResolvedValue(ROSTER);
    const { result } = renderHook(() =>
      useHomeSupplements({ needsQueues: true })
    );
    // The mount poll is out, its roster read held open.
    await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(1));
    expect(getOverview.mock.calls[0]?.[0]).not.toHaveProperty("refresh");
    let done!: Promise<void>;
    act(() => {
      done = result.current.refresh();
    });
    await act(async () => {
      first.resolve(ROSTER);
      await done;
    });
    expect(getOverview).toHaveBeenCalledTimes(2);
    expect(getOverview.mock.calls[1]?.[0]).toMatchObject({ refresh: true });
  });

  it("reads the queues after a read out without them, once the page needs them", async () => {
    const first = deferred<unknown>();
    fetchFleetHealth.mockReturnValueOnce(first.promise);
    fetchFleetHealth.mockResolvedValue(ROSTER);
    const { result, rerender } = renderHook(
      ({ needsQueues }) => useHomeSupplements({ needsQueues }),
      { initialProps: { needsQueues: false } }
    );
    await waitFor(() => expect(fetchFleetHealth).toHaveBeenCalledTimes(1));
    expect(getOverview).not.toHaveBeenCalled();
    // The page now needs the queues, while the first read is still out.
    rerender({ needsQueues: true });
    await act(async () => {
      first.resolve(ROSTER);
    });
    await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.gates.state).toBe("read"));
    expect(result.current.questions.state).toBe("read");
  });
});
