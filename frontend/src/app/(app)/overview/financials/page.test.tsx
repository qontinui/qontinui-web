import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How the Costs page wires in the base-currency control: a project switch must
 * start it afresh, and a change must make the page's own summary read again,
 * because the page takes the base currency new recurring costs use from there.
 */

const mocks = vi.hoisted(() => ({
  project: { projectId: "t1" as string | null, hold: false },
  fetchCostSummary: vi.fn(),
}));

vi.mock("../_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({ ...mocks.project, tenantsError: null }),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useCanEdit: () => false,
}));
vi.mock("@/components/overview/editing/useResource", () => ({
  useResourceList: () => ({
    list: { state: "ready", items: [], total: 0, canEdit: false },
    create: vi.fn(),
    update: vi.fn(),
    drop: vi.fn(),
    replace: vi.fn(),
  }),
}));
vi.mock("../_lib/costs-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCostSummary: mocks.fetchCostSummary,
}));
vi.mock("./_components/BillsToEnter", () => ({ BillsToEnter: () => null }));
vi.mock("./_components/CostHeadline", () => ({ CostHeadline: () => null }));
vi.mock("./_components/MonthTable", () => ({ MonthTable: () => null }));
vi.mock("./_components/RecordSection", () => ({ RecordSection: () => null }));
vi.mock("./_components/StillToArrive", () => ({ StillToArrive: () => null }));
vi.mock("./_components/BaseCurrency", () => ({
  BaseCurrency: function Stub({
    projectId,
    onChanged,
  }: {
    projectId: string | null;
    onChanged: () => void;
  }) {
    // State a remount loses and a mere re-render keeps.
    const [firstProject] = useState(projectId);
    return (
      <button type="button" onClick={onChanged}>
        first project {firstProject}
      </button>
    );
  },
}));

import CostsPage from "./page";

describe("CostsPage and the base-currency control", () => {
  beforeEach(() => {
    mocks.project.projectId = "t1";
    mocks.fetchCostSummary.mockReset();
    mocks.fetchCostSummary.mockResolvedValue({
      base_currency: "USD",
      periods: [],
      today: "2026-11-02",
      currencies: [],
      categories: [],
      months: [],
    });
  });

  it("reads the summary again when the control reports a change", async () => {
    render(<CostsPage />);
    await waitFor(() =>
      expect(mocks.fetchCostSummary).toHaveBeenCalledTimes(1)
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /first project/ })
    );
    await waitFor(() =>
      expect(mocks.fetchCostSummary).toHaveBeenCalledTimes(2)
    );
  });

  it("starts the control afresh when the project changes", async () => {
    const { rerender } = render(<CostsPage />);
    await screen.findByRole("button", { name: "first project t1" });
    mocks.project.projectId = "t2";
    rerender(<CostsPage />);
    await screen.findByRole("button", { name: "first project t2" });
  });
});
