import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchPlanRows: vi.fn() }));
vi.mock("../_lib/plans-api", () => ({
  PLAN_FETCH_LIMIT: 500,
  fetchPlanRows: mocks.fetchPlanRows,
}));

import { useShippedPlans } from "./useShippedPlans";

const shippedRow = (slug: string) => ({
  slug,
  status: "shipped",
  title: slug,
  first_shipped_at: "2026-02-01T10:00:00Z",
});

/** Reads that resolve only when the test says, one per call, in order. */
function deferredReads() {
  const pending: {
    resolve: (rows: unknown[]) => void;
    reject: (err: Error) => void;
  }[] = [];
  mocks.fetchPlanRows.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      })
  );
  return pending;
}

type Props = { project: string | null; hold: boolean };

describe("useShippedPlans", () => {
  beforeEach(() => {
    mocks.fetchPlanRows.mockReset();
  });

  it("never shows a project's plans after a switch, even when its read lands late", async () => {
    const reads = deferredReads();
    const { result, rerender } = renderHook(
      ({ project, hold }: Props) => useShippedPlans(project, hold),
      { initialProps: { project: "A", hold: false } as Props }
    );
    rerender({ project: "B", hold: false });
    // A's read lands after the switch: it must not show under B.
    await act(async () => reads[0]!.resolve([shippedRow("a-plan")]));
    expect(result.current).toEqual({ state: "loading" });

    await act(async () => reads[1]!.resolve([shippedRow("b-plan")]));
    expect(result.current).toMatchObject({
      state: "ready",
      shipped: { items: [{ slug: "b-plan" }] },
    });
  });

  it("never shows one project's failure for another", async () => {
    const reads = deferredReads();
    const { result, rerender } = renderHook(
      ({ project, hold }: Props) => useShippedPlans(project, hold),
      { initialProps: { project: "A", hold: false } as Props }
    );
    await act(async () => reads[0]!.reject(new Error("A could not be read")));
    expect(result.current).toEqual({
      state: "error",
      message: "A could not be read",
    });
    rerender({ project: "B", hold: false });
    expect(result.current).toEqual({ state: "loading" });
  });

  it("reads nothing while held, and shows nothing held over", async () => {
    mocks.fetchPlanRows.mockResolvedValue([shippedRow("a-plan")]);
    const { result, rerender } = renderHook(
      ({ project, hold }: Props) => useShippedPlans(project, hold),
      { initialProps: { project: "A", hold: true } as Props }
    );
    expect(mocks.fetchPlanRows).not.toHaveBeenCalled();
    expect(result.current).toEqual({ state: "loading" });

    rerender({ project: "A", hold: false });
    await waitFor(() => expect(result.current.state).toBe("ready"));

    rerender({ project: "A", hold: true });
    expect(result.current).toEqual({ state: "loading" });
  });
});
