/**
 * `overview-timeline` in a document (plan
 * `2026-09-19-project-overview-for-business-leaders` Phase 9; plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3):
 * the Timeline's own chart over its own reads, read-only — each gate a mark,
 * not a control — with its source and as-of, and "no schedule yet" said
 * rather than drawn empty.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listResource: vi.fn(),
  getResource: vi.fn(),
  fetchPageBacklinks: vi.fn(async () => []),
  fetchForecast: vi.fn(),
}));
vi.mock("@/app/(app)/overview/_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({
    projectId: "p1",
    hold: false,
    tenantsError: null,
    viewerId: "u1",
  }),
}));
vi.mock("@/components/overview/editing/api", async (original) => ({
  ...(await original<object>()),
  listResource: mocks.listResource,
  getResource: mocks.getResource,
  fetchPageBacklinks: mocks.fetchPageBacklinks,
}));
vi.mock("@/app/(app)/overview/_lib/timeline-api", async (original) => ({
  ...(await original<object>()),
  fetchForecast: mocks.fetchForecast,
}));

import { InPageBody, fence } from "./__fixtures__/render";
import { ESTIMATE, FORECAST, serveSchedule } from "./__fixtures__/timeline";

const CHART = '[data-ui-bridge-id="overview.block.timeline.chart"]';

beforeEach(() => {
  vi.clearAllMocks();
  serveSchedule(mocks.listResource);
  mocks.getResource.mockResolvedValue({ item: ESTIMATE, can_edit: false });
  mocks.fetchForecast.mockResolvedValue(FORECAST);
});

describe("overview-timeline", () => {
  it("draws the Timeline's chart of every phase, with its source and as-of", async () => {
    render(<InPageBody body={fence("overview-timeline")} />);
    await waitFor(() => expect(document.querySelector(CHART)).not.toBeNull());
    for (const code of ["A0", "A1", "A2"]) {
      expect(
        document.querySelector(
          `[data-ui-bridge-id="overview.block.timeline.chart.phase.${code}"]`
        )
      ).not.toBeNull();
    }
    const block = document.querySelector(
      '[data-overview-block="overview-timeline"]'
    )!;
    expect(block.textContent).toMatch(/The schedule of Estimate v0\.1/);
    expect(block.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: the project's estimate and its recorded progress · as of /
    );
  });

  it("is read-only: each gate is a mark, not a control", async () => {
    render(<InPageBody body={fence("overview-timeline")} />);
    await waitFor(() => expect(document.querySelector(CHART)).not.toBeNull());
    expect(screen.queryByRole("button", { name: /Show the gate/ })).toBeNull();
    const passed = screen.getByRole("img", { name: "Gate A0: Passed" });
    expect(passed.getAttribute("data-gate-status")).toBe("passed");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Copy as mermaid gantt")).toBeNull();
  });

  it("says a project with no estimate has no schedule yet — never an empty chart", async () => {
    serveSchedule(mocks.listResource, { estimates: [] });
    render(<InPageBody body={fence("overview-timeline")} />);
    expect(
      await screen.findByText("This project has no schedule yet")
    ).toBeTruthy();
    expect(document.querySelector(CHART)).toBeNull();
  });

  it("says the Timeline can't be read when the estimates read fails", async () => {
    mocks.listResource.mockRejectedValue(
      new Error("GET /api/v1/overview/estimates failed: 503 - down")
    );
    render(<InPageBody body={fence("overview-timeline")} />);
    expect(
      await screen.findByText("The Timeline can't be read right now.")
    ).toBeTruthy();
  });

  it("still draws what happened when only the forecast can't be read, and says so", async () => {
    mocks.fetchForecast.mockRejectedValue(
      new Error("forecast failed: 500 - x")
    );
    render(<InPageBody body={fence("overview-timeline")} />);
    await waitFor(() => expect(document.querySelector(CHART)).not.toBeNull());
    expect(
      screen.getByText(/The forecast can.t be read right now/)
    ).toBeTruthy();
  });
});
