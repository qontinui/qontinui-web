import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * A project change drops the previous project's figures at once — even while
 * reads are held for the project list — so one project's costs are never
 * shown under another's name.
 */

const mocks = vi.hoisted(() => ({
  fetchSpendSummary: vi.fn(),
  fetchRenewals: vi.fn(),
}));

vi.mock("./spend-api", () => ({
  fetchSpendSummary: mocks.fetchSpendSummary,
  fetchRenewals: mocks.fetchRenewals,
}));

import { useSpend, type BreakdownBy } from "./useSpend";
import type { SpendView } from "./spend-api";

type Props = { projectId: string | null; hold: boolean };

describe("useSpend across a project change", () => {
  it("clears the old project's data while the new project is held", async () => {
    mocks.fetchSpendSummary.mockResolvedValue({ marker: "project-a" });
    mocks.fetchRenewals.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ projectId, hold }: Props) =>
        useSpend({
          projectId,
          hold,
          view: "amortized" as SpendView,
          breakdownBy: "scope" as BreakdownBy,
          breakdownVendor: null,
        }),
      { initialProps: { projectId: "a", hold: false } }
    );
    await waitFor(() => expect(result.current.summary.state).toBe("ready"));

    rerender({ projectId: "b", hold: true });

    expect(result.current.summary.state).toBe("loading");
    expect(result.current.breakdown.state).toBe("loading");
    expect(result.current.renewals.state).toBe("loading");
  });
});
