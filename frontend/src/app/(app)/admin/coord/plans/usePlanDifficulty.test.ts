/**
 * `usePlanDifficulty` — re-reads while the backend reports a rating backlog,
 * and keeps the last good index when a later read fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const get = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => get(...args) },
}));

import { DIFFICULTY_BACKLOG_MS, usePlanDifficulty } from "./usePlanDifficulty";

function body(pending: number) {
  return {
    items: [],
    count: 0,
    rerated: 0,
    rerate_pending: pending,
    rerate_failed_reason: null,
    rubric_version: 1,
    model_tiers: {},
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("usePlanDifficulty", () => {
  it("re-reads while a backlog is pending, and stops when it clears", async () => {
    get
      .mockResolvedValueOnce(body(600))
      .mockResolvedValueOnce(body(300))
      .mockResolvedValueOnce(body(0));
    renderHook(() => usePlanDifficulty());
    await flush();
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DIFFICULTY_BACKLOG_MS);
    });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DIFFICULTY_BACKLOG_MS);
    });
    expect(get).toHaveBeenCalledTimes(3);

    // Backlog cleared: no more quick re-reads.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DIFFICULTY_BACKLOG_MS * 5);
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("keeps the last good index when a later read fails", async () => {
    get.mockResolvedValueOnce(body(0)).mockRejectedValueOnce(new Error("503"));
    const { result } = renderHook(() => usePlanDifficulty());
    await flush();
    expect(result.current.index.state).toBe("loaded");
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.index.state).toBe("loaded");
  });

  it("reports failed when the FIRST read fails", async () => {
    get.mockRejectedValueOnce(new Error("HTTP 503"));
    const { result } = renderHook(() => usePlanDifficulty());
    await flush();
    expect(result.current.index).toEqual({
      state: "failed",
      reason: "HTTP 503",
    });
  });
});
