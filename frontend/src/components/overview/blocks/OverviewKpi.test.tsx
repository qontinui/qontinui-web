/**
 * `overview-kpi` on the Summary (plan
 * `2026-09-19-project-overview-for-business-leaders` Phase 9; plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3):
 * one headline figure, read the way the page that owns it reads it — the
 * Timeline's forecast through its hooks, the work counts through the
 * Summary's own loader — with its source and as-of, and "not measured —
 * <reason>" for a figure that cannot be produced.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listResource: vi.fn(),
  getResource: vi.fn(),
  fetchChangeLog: vi.fn(async () => ({ entries: [], truncated: false })),
  fetchForecast: vi.fn(),
  fetchProjectState: vi.fn(),
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
vi.mock("@/lib/api/operations/projectState", async (original) => ({
  ...(await original<object>()),
  fetchProjectState: mocks.fetchProjectState,
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useResourceDescriptor: () => null,
}));

import { InIntentSection, fence } from "./__fixtures__/render";
import { ESTIMATE, FORECAST, serveSchedule } from "./__fixtures__/timeline";

function kpi(figure: string) {
  return document.querySelector(
    `[data-ui-bridge-id="overview.block.kpi.${figure}"]`
  ) as HTMLElement | null;
}

async function value(figure: string) {
  await waitFor(() =>
    expect(
      kpi(figure)?.querySelector(
        `[data-ui-bridge-id="overview.block.kpi.${figure}.value"]`
      )
    ).not.toBeNull()
  );
  return kpi(figure)!.querySelector(
    `[data-ui-bridge-id="overview.block.kpi.${figure}.value"]`
  )!;
}

const STATE = {
  schema: 1,
  generated_at: "2026-11-08T09:00:00Z",
  on_track: {
    state: "read",
    totals: {
      row_count: 16,
      classes: {
        shipped: 4,
        in_flight: 2,
        stalled: 1,
        blocked_on_dependency: 0,
        waiting_on_gate: 1,
        not_started: 3,
        closed_other: 5,
        off_vocabulary: 0,
        unset: 0,
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  serveSchedule(mocks.listResource);
  mocks.getResource.mockResolvedValue({ item: ESTIMATE, can_edit: false });
  mocks.fetchForecast.mockResolvedValue(FORECAST);
  mocks.fetchProjectState.mockResolvedValue(STATE);
});

describe("overview-kpi — the Timeline's figures", () => {
  it("reads Phase 9's shorthand and shows the forecast finish with its source and as-of", async () => {
    render(<InIntentSection body={fence("overview-kpi forecast-finish")} />);
    expect((await value("forecast-finish")).textContent).toBe("17 Apr 2026");
    const block = kpi("forecast-finish")!;
    expect(block.textContent).toMatch(/^Expected to finish/);
    expect(block.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: the project's estimate and its recorded progress · as of /
    );
    expect(mocks.fetchForecast).toHaveBeenCalledWith("e1");
  });

  it("words a slip — never a bare signed number", async () => {
    render(<InIntentSection body={fence("overview-kpi", "figure: slip")} />);
    expect((await value("slip")).textContent).toBe("3 weeks late");
  });

  it("says where the project is now, and its next gate with what passing it takes", async () => {
    render(
      <InIntentSection
        body={[
          fence("overview-kpi current-phase"),
          "",
          fence("overview-kpi next-gate"),
        ].join("\n")}
      />
    );
    expect((await value("current-phase")).textContent).toBe("A1 Discovery");
    expect(kpi("current-phase")!.textContent).toMatch(
      /The phase under way now\./
    );
    expect((await value("next-gate")).textContent).toBe("A1 Discovery");
    expect(kpi("next-gate")!.textContent).toMatch(/Gate A1/);
  });

  it("says 'not measured' with the server's reason when there is no forecast — never 0 or a blank", async () => {
    mocks.fetchForecast.mockResolvedValue({
      ...FORECAST,
      forecast_finish: null,
      slip_days: null,
      unavailable: [
        {
          figure: "forecast",
          reason: "phase_dates_missing",
          detail: "No forecast while A2 (Build) has no planned start and end.",
        },
      ],
    });
    render(
      <InIntentSection
        body={[
          fence("overview-kpi forecast-finish"),
          "",
          fence("overview-kpi slip"),
        ].join("\n")}
      />
    );
    for (const figure of ["forecast-finish", "slip"]) {
      const shown = await value(figure);
      expect(shown.textContent).toBe(
        "not measured — No forecast while A2 (Build) has no planned start and end."
      );
      expect(shown.textContent).not.toMatch(/\b0\b/);
    }
  });

  it("says 'not measured' for a project with no schedule yet", async () => {
    serveSchedule(mocks.listResource, { estimates: [] });
    render(<InIntentSection body={fence("overview-kpi forecast-finish")} />);
    expect((await value("forecast-finish")).textContent).toBe(
      "not measured — this project has no schedule yet"
    );
    expect(mocks.fetchForecast).not.toHaveBeenCalled();
  });

  it("says the figure can't be read when the forecast read fails", async () => {
    mocks.fetchForecast.mockRejectedValue(
      new Error("GET /api/v1/overview/estimates/e1/forecast failed: 503 - down")
    );
    render(<InIntentSection body={fence("overview-kpi slip")} />);
    expect(
      await screen.findByText("This figure can't be read right now.")
    ).toBeTruthy();
  });
});

describe("overview-kpi — the work counts", () => {
  it("counts the work in the Summary's buckets and words, with coord as its source", async () => {
    render(
      <InIntentSection
        body={[
          fence("overview-kpi work-done"),
          fence("overview-kpi work-in-progress"),
          fence("overview-kpi work-planned"),
        ].join("\n\n")}
      />
    );
    expect((await value("work-done")).textContent).toBe("4");
    expect((await value("work-in-progress")).textContent).toBe("3");
    expect((await value("work-planned")).textContent).toBe("3");
    expect(kpi("work-done")!.textContent).toMatch(/^Done/);
    expect(kpi("work-in-progress")!.textContent).toMatch(/^In progress/);
    expect(kpi("work-planned")!.textContent).toMatch(/^Planned/);
    // Closed work counts toward nothing, exactly as on the Summary.
    expect(kpi("work-done")!.textContent).toMatch(
      /of 11 pieces of work counted/
    );
    expect(
      kpi("work-done")!.querySelector("[data-provenance]")?.textContent
    ).toMatch(/^source: coord's count of the project's work · as of /);
  });

  it("says 'not measured' when the count could not be read — never zeros", async () => {
    mocks.fetchProjectState.mockResolvedValue({
      schema: 1,
      on_track: { state: "unknown" },
    });
    render(<InIntentSection body={fence("overview-kpi work-done")} />);
    expect((await value("work-done")).textContent).toBe(
      "not measured — the count could not be read"
    );
  });
});
