import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineForecast } from "./_lib/timeline-api";

/**
 * The Summary's schedule tiles against a mocked contract: the current phase,
 * the next gate and the forecast finish are the SERVED forecast of the
 * project's estimate (the baseline), worded as the Timeline words them — a
 * slip in words, never a signed number; an unknown finish says "Not known"
 * with the reason the server gave. Loading, failure and "no estimate" are
 * each said, none as a blank tile.
 */

const mocks = vi.hoisted(() => ({
  listResource: vi.fn(),
  fetchForecast: vi.fn(),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ activeTenantId: "p1", loading: false, error: null }),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useCanEdit: () => false,
}));
// The intent prose and the work-unit progress are other columns' business.
vi.mock("./_hooks/useSummaryData", () => ({
  INTENT_RESOURCE: "intent_documents",
  useSummaryData: () => ({
    intent: { state: "loading" },
    progress: { state: "loading" },
    saveBody: vi.fn(),
    move: vi.fn(),
    createDocument: vi.fn(),
  }),
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listResource: mocks.listResource,
}));
vi.mock("./_lib/timeline-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchForecast: mocks.fetchForecast,
}));

import OverviewSummaryPage from "./page";

const ESTIMATES = [
  { id: "e-old", name: "Old", is_baseline: false, version: 1, content: null },
  { id: "e1", name: "Baseline", is_baseline: true, version: 3, content: null },
];

function forecast(overrides: Partial<TimelineForecast> = {}): TimelineForecast {
  return {
    estimate_id: "e1",
    estimate_version: 3,
    today: "2026-02-10",
    planned_start: "2026-01-05",
    planned_finish: "2026-03-27",
    calendar_weeks: "11.6",
    working_weeks: "11.6",
    position: "in_progress",
    current_phase: { id: "ph1", code: "A1", name: "Discovery" },
    next_phase: { id: "ph2", code: "A2", name: "Build" },
    next_gate: {
      id: "ph1",
      code: "A1",
      name: "Discovery",
      criteria: "Sponsors agree the scope",
    },
    forecast_finish: "2026-04-06",
    slip_days: 10,
    phases: [],
    unavailable: [],
    ...overrides,
  };
}

const tile = (name: string) =>
  document.querySelector(
    `[data-ui-bridge-id="overview.summary.schedule.${name}"]`
  ) as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listResource.mockResolvedValue({
    items: ESTIMATES,
    total: 2,
    can_edit: false,
    degraded: null,
  });
});
afterEach(cleanup);

describe("the Summary's schedule tiles", () => {
  it("show the served current phase, next gate and forecast finish of the baseline", async () => {
    mocks.fetchForecast.mockResolvedValue(forecast());
    render(<OverviewSummaryPage />);

    await waitFor(() => expect(tile("tiles")).not.toBeNull());
    expect(mocks.fetchForecast).toHaveBeenCalledWith("e1");
    expect(mocks.listResource).toHaveBeenCalledWith("estimates", {});
    expect(tile("current-phase")!.textContent).toContain("A1 Discovery");
    expect(tile("current-phase")!.textContent).toContain(
      "The phase under way now."
    );
    expect(tile("next-gate")!.textContent).toContain("A1 Discovery");
    expect(tile("next-gate")!.textContent).toContain(
      "Sponsors agree the scope"
    );
    expect(tile("forecast")!.textContent).toContain("6 Apr 2026");
    expect(tile("forecast")!.textContent).toContain("Planned for 27 Mar 2026.");
    const slip = tile("slip")!;
    expect(slip.textContent).toBe("10 days late");
    expect(slip.dataset.tone).toBe("late");
  });

  it("word a slip, never sign it", async () => {
    mocks.fetchForecast.mockResolvedValue(forecast({ slip_days: -5 }));
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("slip")).not.toBeNull());
    expect(tile("slip")!.textContent).toBe("5 days early");
    expect(tile("forecast")!.textContent).not.toMatch(/-\d/);
    cleanup();

    mocks.fetchForecast.mockResolvedValue(forecast({ slip_days: 21 }));
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("slip")).not.toBeNull());
    expect(tile("slip")!.textContent).toBe("3 weeks late");
    cleanup();

    mocks.fetchForecast.mockResolvedValue(forecast({ slip_days: 0 }));
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("slip")).not.toBeNull());
    expect(tile("slip")!.textContent).toBe("On plan");
  });

  it("say Not known for a finish the server could not forecast, with its reason", async () => {
    mocks.fetchForecast.mockResolvedValue(
      forecast({
        position: "not_started",
        current_phase: null,
        forecast_finish: null,
        slip_days: null,
        unavailable: [
          {
            figure: "forecast",
            reason: "phase_dates_missing",
            detail:
              "No forecast while A2 (Build) has no planned start and end.",
          },
        ],
      })
    );
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("tiles")).not.toBeNull());
    const finish = tile("forecast")!;
    expect(finish.textContent).toContain("Not known");
    expect(finish.textContent).toContain(
      "No forecast while A2 (Build) has no planned start and end."
    );
    expect(tile("slip")).toBeNull();
    expect(tile("current-phase")!.textContent).toContain("Not started");
    expect(tile("current-phase")!.textContent).toContain(
      "A2 Build comes first."
    );
  });

  it("say when every gate is decided, and Not known when there are no phases", async () => {
    mocks.fetchForecast.mockResolvedValue(
      forecast({ position: "finished", next_gate: null, slip_days: 0 })
    );
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("tiles")).not.toBeNull());
    expect(tile("next-gate")!.textContent).toContain("All gates decided");
    expect(tile("current-phase")!.textContent).toContain("Finished");
    cleanup();

    mocks.fetchForecast.mockResolvedValue(
      forecast({
        position: "no_phases",
        current_phase: null,
        next_phase: null,
        next_gate: null,
        forecast_finish: null,
        planned_finish: null,
        slip_days: null,
        unavailable: [
          {
            figure: "forecast",
            reason: "no_phases",
            detail: "This estimate has no phases yet.",
          },
        ],
      })
    );
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("tiles")).not.toBeNull());
    expect(tile("next-gate")!.textContent).toContain("Not known");
    expect(tile("forecast")!.textContent).toContain(
      "This estimate has no phases yet."
    );
  });

  it("show a loading state until the forecast answers, never a blank tile", async () => {
    mocks.fetchForecast.mockReturnValue(new Promise(() => {}));
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(mocks.fetchForecast).toHaveBeenCalled());
    expect(tile("loading")).not.toBeNull();
    expect(tile("tiles")).toBeNull();
  });

  it("say the forecast could not be loaded when its read fails", async () => {
    mocks.fetchForecast.mockRejectedValue(new Error("502 Bad Gateway"));
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("error")).not.toBeNull());
    expect(tile("error")!.textContent).toContain("502 Bad Gateway");
    expect(tile("tiles")).toBeNull();
  });

  it("say the estimate could not be loaded when the list read fails", async () => {
    mocks.listResource.mockRejectedValue(new Error("estimates unavailable"));
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("error")).not.toBeNull());
    expect(tile("error")!.textContent).toContain("estimates unavailable");
    expect(mocks.fetchForecast).not.toHaveBeenCalled();
  });

  it("say there is no schedule when the project has no estimate", async () => {
    mocks.listResource.mockResolvedValue({
      items: [],
      total: 0,
      can_edit: false,
      degraded: null,
    });
    render(<OverviewSummaryPage />);
    await waitFor(() => expect(tile("no-estimate")).not.toBeNull());
    expect(screen.getByText(/There is no estimate yet/)).toBeTruthy();
    expect(mocks.fetchForecast).not.toHaveBeenCalled();
  });
});
