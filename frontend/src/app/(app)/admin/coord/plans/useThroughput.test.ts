/**
 * `useThroughput` — a failed refresh of the same range keeps the last reading
 * and MARKS it, so a held reading never reads as live (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 4).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => getMock(...args) },
}));

import { useThroughput } from "./useThroughput";

const ANSWER = {
  since: "2026-09-06T00:00:00Z",
  until: "2026-10-06T00:00:00Z",
  count: 1,
  buckets: [{ day: "2026-09-10", to_status: "shipped", count: 2 }],
};

beforeEach(() => {
  getMock.mockReset();
});

describe("useThroughput", () => {
  it("keeps the last reading on a failed refresh and carries refreshFailure", async () => {
    getMock.mockResolvedValueOnce(ANSWER);
    const { result } = renderHook(() => useThroughput(30));
    await waitFor(() => expect(result.current.reading.state).toBe("loaded"));
    expect(result.current.refreshFailure).toBeNull();

    getMock.mockRejectedValueOnce(new Error("coord timed out"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.reading.state).toBe("loaded");
    expect(result.current.refreshFailure).not.toBeNull();
    expect(result.current.refreshFailure?.reason).toBe("coord timed out");
    expect(typeof result.current.refreshFailure?.readingAt).toBe("number");

    // A later good refresh clears the marker.
    getMock.mockResolvedValueOnce(ANSWER);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.refreshFailure).toBeNull();
  });

  it("a failed FIRST read is UNKNOWN, not a held reading", async () => {
    getMock.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useThroughput(30));
    await waitFor(() => expect(result.current.reading.state).toBe("failed"));
    expect(result.current.refreshFailure).toBeNull();
  });
});
