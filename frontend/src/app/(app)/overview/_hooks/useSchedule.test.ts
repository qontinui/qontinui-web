/**
 * `useSchedule` — a failed refresh keeps the last schedule (a failed read is
 * evidence about the network, not the schedule), a malformed body is a failed
 * read rather than an empty schedule, and a project change drops the previous
 * project's schedule before the next one lands (plan
 * `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, Phase 3).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { envelope } from "../_lib/schedule-fixtures";

const fetchSchedule = vi.fn();
vi.mock("../_lib/schedule-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSchedule: () => fetchSchedule(),
}));

import { useSchedule } from "./useSchedule";

describe("useSchedule", () => {
  beforeEach(() => fetchSchedule.mockReset());

  it("holds: reads nothing while the project list has not resolved", () => {
    const { result } = renderHook(() => useSchedule("t-1", true));
    expect(result.current.loading).toBe(true);
    expect(fetchSchedule).not.toHaveBeenCalled();
  });

  it("returns the envelope, with its reasons intact", async () => {
    fetchSchedule.mockResolvedValue(envelope());
    const { result } = renderHook(() => useSchedule("t-1", false));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.data?.forecast.unknown_reason).toBe(
      "phase_dates_missing"
    );
  });

  it("a failed refresh keeps the previous envelope and reports the failure", async () => {
    fetchSchedule.mockResolvedValueOnce(envelope());
    const { result } = renderHook(() => useSchedule("t-1", false));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    fetchSchedule.mockRejectedValueOnce(new Error("GET failed: 502"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe("GET failed: 502");
    expect(result.current.data).not.toBeNull();
  });

  it("a malformed body is an error, never a schedule", async () => {
    fetchSchedule.mockResolvedValue({ phases: [] });
    const { result } = renderHook(() => useSchedule("t-1", false));
    await waitFor(() =>
      expect(result.current.error).toBe(
        "the service answered without a schedule"
      )
    );
    expect(result.current.data).toBeNull();
  });

  it("a project change drops the previous project's schedule at once", async () => {
    fetchSchedule.mockResolvedValue(envelope());
    const { result, rerender } = renderHook(
      ({ tenant }) => useSchedule(tenant, false),
      { initialProps: { tenant: "t-1" } }
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    // The next project's read is still out: the old data must not linger.
    let release: (v: unknown) => void = () => {};
    fetchSchedule.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    rerender({ tenant: "t-2" });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => {
      release(envelope());
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
  });
});
