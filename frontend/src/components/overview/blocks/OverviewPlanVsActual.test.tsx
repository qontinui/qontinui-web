/**
 * `overview-plan-vs-actual` on the Summary (plan
 * `2026-09-19-project-overview-for-business-leaders` Phase 9; plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3):
 * each phase planned against what happened or is expected, the slip in the
 * Timeline's words — never a bare negative number — and "not measured —
 * <reason>" where the forecast cannot say.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listResource: vi.fn(),
  getResource: vi.fn(),
  fetchChangeLog: vi.fn(async () => ({ entries: [], truncated: false })),
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
  fetchChangeLog: mocks.fetchChangeLog,
}));
vi.mock("@/app/(app)/overview/_lib/timeline-api", async (original) => ({
  ...(await original<object>()),
  fetchForecast: mocks.fetchForecast,
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useResourceDescriptor: () => null,
}));

import { InIntentSection, fence } from "./__fixtures__/render";
import { ESTIMATE, FORECAST, serveSchedule } from "./__fixtures__/timeline";

function row(code: string) {
  return document.querySelector(
    `[data-ui-bridge-id="overview.block.plan-vs-actual.phase.${code}"]`
  ) as HTMLElement | null;
}

beforeEach(() => {
  vi.clearAllMocks();
  serveSchedule(mocks.listResource);
  mocks.getResource.mockResolvedValue({ item: ESTIMATE, can_edit: false });
  mocks.fetchForecast.mockResolvedValue(FORECAST);
});

describe("overview-plan-vs-actual", () => {
  it("sets each phase's plan against what happened or is expected, with its slip in words", async () => {
    render(<InIntentSection body={fence("overview-plan-vs-actual")} />);
    await waitFor(() => expect(row("A2")).not.toBeNull());
    const cells = (code: string) =>
      within(row(code)!)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(cells("A0")).toEqual([
      "5 Jan 2026 – 30 Jan 2026",
      "Ran 5 Jan 2026 – 30 Jan 2026",
      "On plan",
    ]);
    expect(cells("A1")).toEqual([
      "2 Feb 2026 – 27 Feb 2026",
      "Started 2 Feb 2026, expected to end 20 Mar 2026",
      "3 weeks late",
    ]);
    expect(cells("A2")[1]).toBe("Expected 23 Mar 2026 – 17 Apr 2026");
    // A slip is never a signed number.
    for (const code of ["A0", "A1", "A2"]) {
      expect(cells(code)[2]).not.toMatch(/-?\d+\s*$/);
    }
    const block = document.querySelector(
      '[data-overview-block="overview-plan-vs-actual"]'
    )!;
    expect(block.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: the project's estimate and its recorded progress · as of /
    );
  });

  it("says an early finish in words too", async () => {
    mocks.fetchForecast.mockResolvedValue({
      ...FORECAST,
      phases: FORECAST.phases.map((p) =>
        p.code === "A1" ? { ...p, finish_slip_days: -4 } : p
      ),
    });
    render(<InIntentSection body={fence("overview-plan-vs-actual")} />);
    await waitFor(() => expect(row("A1")).not.toBeNull());
    expect(
      document.querySelector(
        '[data-ui-bridge-id="overview.block.plan-vs-actual.phase.A1.slip"]'
      )?.textContent
    ).toBe("4 days early");
  });

  it("says 'not measured' and why when the forecast can't be read — never 0 or a blank", async () => {
    mocks.fetchForecast.mockRejectedValue(
      new Error("forecast failed: 500 - x")
    );
    render(<InIntentSection body={fence("overview-plan-vs-actual")} />);
    await waitFor(() => expect(row("A2")).not.toBeNull());
    const slip = document.querySelector(
      '[data-ui-bridge-id="overview.block.plan-vs-actual.phase.A2.slip"]'
    )!;
    expect(slip.textContent).toBe(
      "not measured — the forecast can't be read right now"
    );
    expect(slip.textContent).not.toMatch(/\b0\b/);
  });

  it("says a project with no estimate has no schedule yet", async () => {
    serveSchedule(mocks.listResource, { estimates: [] });
    render(<InIntentSection body={fence("overview-plan-vs-actual")} />);
    expect(
      await screen.findByText("This project has no schedule yet")
    ).toBeTruthy();
  });
});
