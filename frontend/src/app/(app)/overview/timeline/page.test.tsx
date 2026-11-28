import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Timeline renders the schedule derived from coord and nothing else
 * (plan `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, D5):
 * the same page for every tenant, an estimate or typed rows changing no figure,
 * and an unknown figure saying "Not available since ..." with its reason.
 */

const mocks = vi.hoisted(() => ({
  tenantsError: null as string | null,
  listResource: vi.fn(),
  getResource: vi.fn(),
  fetchForecast: vi.fn(),
  schedule: { data: null, loading: false, error: null } as {
    data: unknown;
    loading: boolean;
    error: string | null;
  },
}));

vi.mock("../_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({
    projectId: "p1",
    hold: false,
    tenantsError: mocks.tenantsError,
    viewerId: "u1",
  }),
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listResource: mocks.listResource,
  getResource: mocks.getResource,
}));
vi.mock("../_hooks/useSchedule", () => ({
  useSchedule: () => ({ ...mocks.schedule, refresh: async () => {} }),
}));
vi.mock("../_lib/timeline-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchForecast: mocks.fetchForecast,
}));

import {
  envelope,
  noProgrammeEnvelope,
  unreachableEnvelope,
} from "../_lib/schedule-fixtures";
import { bodyText, plainLanguageViolations } from "../_lib/plain-language";
import TimelinePage from "./page";

const byId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-ui-bridge-id="${id}"]`);

beforeEach(() => {
  mocks.tenantsError = null;
  mocks.schedule = { data: null, loading: false, error: null };
  mocks.listResource.mockReset();
  mocks.getResource.mockReset();
  mocks.fetchForecast.mockReset();
});
afterEach(cleanup);

describe("the Timeline page", () => {
  it("draws the coord schedule and reads no estimate, progress or milestone resource", () => {
    mocks.schedule = { data: envelope(), loading: false, error: null };
    render(<TimelinePage />);
    expect(byId("overview.schedule")).not.toBeNull();
    expect(byId("overview.schedule.chart.phase.F2.state")?.textContent).toBe(
      "In progress"
    );
    // Derived only: the typed read paths are not touched at all.
    expect(mocks.listResource).not.toHaveBeenCalled();
    expect(mocks.getResource).not.toHaveBeenCalled();
    expect(mocks.fetchForecast).not.toHaveBeenCalled();
  });

  it("offers no entry control and no entered-value or disagreement text", () => {
    mocks.schedule = { data: envelope(), loading: false, error: null };
    const { container } = render(<TimelinePage />);
    expect(container.querySelectorAll("input, textarea, form")).toHaveLength(0);
    const text = bodyText(container);
    expect(text).not.toMatch(/entered/i);
    expect(text).not.toMatch(/differ/i);
    expect(byId("overview.schedule.header.disagreements")).toBeNull();
    expect(plainLanguageViolations(container)).toEqual([]);
  });

  it("with coord unreachable every figure reads Not available since, never a default", () => {
    mocks.schedule = {
      data: unreachableEnvelope(),
      loading: false,
      error: null,
    };
    const { container } = render(<TimelinePage />);
    const text = bodyText(container);
    expect(text).toContain("Not available since 21 Nov 2026");
    expect(text).toContain("the project record could not be reached");
    expect(text).not.toMatch(/\b0 days?\b/);
    expect(text).not.toMatch(/On track/i);
  });

  it("a project with no programme says why, with no estimate notice", () => {
    mocks.schedule = {
      data: noProgrammeEnvelope(),
      loading: false,
      error: null,
    };
    render(<TimelinePage />);
    expect(byId("overview.schedule.phases.unknown")?.textContent).toContain(
      "no delivery programme is recorded"
    );
  });

  it("shows a loading state while the first read is in flight", () => {
    mocks.schedule = { data: null, loading: true, error: null };
    render(<TimelinePage />);
    expect(byId("overview.schedule.loading")).not.toBeNull();
    expect(byId("overview.schedule")).toBeNull();
  });

  it("a failed refresh keeps the last schedule and says the update failed", () => {
    mocks.schedule = {
      data: envelope(),
      loading: false,
      error: "network down",
    };
    render(<TimelinePage />);
    expect(byId("overview.schedule")).not.toBeNull();
    expect(screen.getByText(/network down/)).toBeTruthy();
  });

  it("a failure with nothing to keep is an error, not an empty chart", () => {
    mocks.schedule = { data: null, loading: false, error: "network down" };
    render(<TimelinePage />);
    expect(byId("overview.schedule.error")).not.toBeNull();
    expect(byId("overview.schedule")).toBeNull();
  });

  it("a project-list failure is shown as such", () => {
    mocks.tenantsError = "no projects";
    render(<TimelinePage />);
    expect(byId("overview.timeline.error")).not.toBeNull();
  });
});
