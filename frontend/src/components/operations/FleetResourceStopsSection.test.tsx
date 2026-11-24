/**
 * FleetResourceStopsSection — the Dev Ops "Pressure stops" table (plan
 * `2026-11-24-pressure-stops-record-box-stats-in-coord` Phase 4).
 *
 * Pins the arms that make the table honest: a populated row with literal
 * expected text, an UNKNOWN stat rendering `unknown` and never `0`, a missing
 * coord table rendering "not available" and never an empty list, a failed read
 * keeping the last rows marked last-known, and presentation mode hiding the
 * device id.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import { FleetResourceStopsSection } from "./FleetResourceStopsSection";
import type {
  ResourceStopRow,
  ResourceStopsResponse,
} from "./fleetResourceStops";
import type { UseFleetResourceStopsResult } from "./useFleetResourceStops";

const GIB = 1024 ** 3;
const NOW = Date.parse("2026-11-24T09:10:00Z");
const DEVICE = "4b426e2b-cc10-4870-80a5-524aaac70719";

function stop(over: Partial<ResourceStopRow> = {}): ResourceStopRow {
  return {
    event_id: "e-1",
    device_id: DEVICE,
    client_event_id: "c-1",
    // Ten minutes before NOW.
    observed_at: "2026-11-24T09:00:00Z",
    recorded_at: "2026-11-24T09:00:01Z",
    stop_kind: "refused_spawn",
    lane: "memory_free_commit",
    guard_lane: "wsl",
    severity: "critical",
    what_class: "terminal_spawn",
    observed: 3 * GIB,
    limit_value: 4 * GIB,
    reason: null,
    session_count_terminal: 7,
    session_count_live_claude: null,
    active_ci_runners: 2,
    ci_jobs_queued: null,
    calibration: { thread_ceilings: { source: "machine_scaled" } },
    fleet_calibration: null,
    suppressed_count: 0,
    dropped_before: 0,
    box_stats: {},
    ...over,
  };
}

function response(
  over: Partial<ResourceStopsResponse> = {}
): ResourceStopsResponse {
  return {
    table_present: true,
    count: 1,
    stops: [stop()],
    bounded: false,
    limit: 50,
    limit_clamped: false,
    summary: null,
    ...over,
  };
}

function hook(
  over: Partial<UseFleetResourceStopsResult> = {}
): UseFleetResourceStopsResult {
  return {
    data: response(),
    loading: false,
    error: null,
    fetchedAtMs: NOW,
    refresh: vi.fn(async () => {}),
    ...over,
  };
}

const DEVICES = [{ device_id: DEVICE, hostname: "spaceship" }];

function renderSection(stops: UseFleetResourceStopsResult) {
  return render(
    <FleetResourceStopsSection devices={DEVICES} stops={stops} nowMs={NOW} />
  );
}

describe("FleetResourceStopsSection", () => {
  it("renders a populated row with literal text and unknown stats", () => {
    renderSection(hook());
    const row = screen.getByTestId("fleet-resource-stops-row");
    const cells = within(row)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells).toEqual([
      "10m ago",
      "spaceship",
      "Low memory (WSL)",
      "critical",
      "terminal_spawn",
      "3.0 GB free / floor 4.0 GB",
      // The live-claude census was unreadable: unknown, never 0.
      "7 terminal / unknown claude",
      "2",
      "sources: machine_scaled · fleet: unknown",
    ]);
    expect(row.getAttribute("data-device-id")).toBe(DEVICE);
    expect(
      screen.getByTestId("fleet-resource-stops-count-badge")
    ).toHaveTextContent("1 recorded");
    expect(
      screen.getByTestId("fleet-resource-stops-critical-badge")
    ).toHaveTextContent("1 critical");
  });

  it("renders a thread-pressure stop against its ceiling", () => {
    renderSection(
      hook({
        data: response({
          stops: [
            stop({
              lane: "thread_pressure",
              guard_lane: "threads",
              severity: "warn",
              observed: 540,
              limit_value: 512,
            }),
          ],
        }),
      })
    );
    const row = screen.getByTestId("fleet-resource-stops-row");
    expect(row).toHaveTextContent("High thread count (threads)");
    expect(row).toHaveTextContent("540 / 512 threads");
    expect(
      screen.queryByTestId("fleet-resource-stops-critical-badge")
    ).toBeNull();
  });

  it("renders a missing coord table as not available, never as an empty list", () => {
    renderSection(
      hook({ data: response({ table_present: false, stops: [], count: 0 }) })
    );
    expect(
      screen.getByTestId("fleet-resource-stops-not-available")
    ).toHaveTextContent("Not available");
    expect(screen.queryByTestId("fleet-resource-stops-empty")).toBeNull();
    expect(screen.queryByTestId("fleet-resource-stops-row")).toBeNull();
    expect(
      screen.getByTestId("fleet-resource-stops-unavailable-badge")
    ).toHaveTextContent("not available");
  });

  it("says no stops are recorded only when the table was read and is empty", () => {
    renderSection(hook({ data: response({ stops: [], count: 0 }) }));
    expect(screen.getByTestId("fleet-resource-stops-empty")).toHaveTextContent(
      "No pressure stops recorded."
    );
  });

  it("keeps the last rows, marked last-known, when a read fails", () => {
    renderSection(
      hook({ error: "coord read deadline (5000 ms) exceeded — unknown" })
    );
    expect(screen.getByTestId("fleet-resource-stops-error")).toHaveTextContent(
      "Pressure stops unavailable: coord read deadline (5000 ms) exceeded — unknown. Rows below are last-known, not current."
    );
    expect(screen.getAllByTestId("fleet-resource-stops-row")).toHaveLength(1);
  });

  it("renders an error with no rows as an error, not as an empty table", () => {
    renderSection(hook({ data: null, error: "boom" }));
    expect(screen.getByTestId("fleet-resource-stops-error")).toHaveTextContent(
      "Pressure stops unavailable: boom."
    );
    expect(screen.queryByTestId("fleet-resource-stops-empty")).toBeNull();
    expect(screen.queryByTestId("fleet-resource-stops-row")).toBeNull();
  });

  it("flags a bounded page", () => {
    renderSection(hook({ data: response({ bounded: true }) }));
    expect(
      screen.getByTestId("fleet-resource-stops-count-badge")
    ).toHaveTextContent("1+ recorded");
    expect(
      screen.getByText("Showing the newest 1; older stops are not shown.")
    ).toBeInTheDocument();
  });

  it("shows a loading skeleton, not an empty table, before the first read", () => {
    renderSection(hook({ data: null, loading: true }));
    expect(screen.queryByTestId("fleet-resource-stops-empty")).toBeNull();
    expect(screen.queryByTestId("fleet-resource-stops-row")).toBeNull();
  });

  it("falls back to the device id when the device list does not name it", () => {
    render(
      <FleetResourceStopsSection devices={[]} stops={hook()} nowMs={NOW} />
    );
    expect(
      within(screen.getByTestId("fleet-resource-stops-row")).getAllByRole(
        "cell"
      )[1]
    ).toHaveTextContent(DEVICE);
  });
});

describe("FleetResourceStopsSection in presentation mode", () => {
  it("names the machine by alias and carries no device id", () => {
    const view = renderInPresentationMode(
      <FleetResourceStopsSection devices={DEVICES} stops={hook()} nowMs={NOW} />
    );
    const row = screen.getByTestId("fleet-resource-stops-row");
    expect(row.getAttribute("data-device-id")).toBeNull();
    expect(row).not.toHaveTextContent("spaceship");
    expectPresentationSafe(view, { forbidden: ["spaceship", DEVICE] });
  });
});
