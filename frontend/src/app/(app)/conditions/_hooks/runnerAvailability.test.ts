import { describe, expect, it } from "vitest";
import type { FleetDrainRead } from "@/components/operations/fleetDrain";
import { runnerHintFor, runnerHintText } from "./runnerAvailability";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";

const NO_DRAINS: FleetDrainRead = {
  state: "ok",
  entries: new Map(),
  unreadableDevices: new Set(),
};

function drained(...ids: string[]): FleetDrainRead {
  return {
    state: "ok",
    entries: new Map(
      ids.map((id) => [
        id,
        {
          until: "2026-10-01T00:00:00Z",
          reason: "maintenance",
          drainedBy: null,
          drainedAt: null,
        },
      ])
    ),
    unreadableDevices: new Set(),
  };
}

describe("runnerHintFor", () => {
  it("shows nothing when the roster is unknown", () => {
    expect(runnerHintFor(null, NO_DRAINS, NOW)).toBeNull();
  });

  it("shows nothing when an online device is not drained", () => {
    const roster = [{ device_id: A, within_dispatch_window: true }];
    expect(runnerHintFor(roster, NO_DRAINS, NOW)).toBeNull();
  });

  it("says no runner is online when every listed device is outside the window", () => {
    const roster = [{ device_id: A, within_dispatch_window: false }];
    expect(runnerHintFor(roster, { state: "loading" }, NOW)).toBe(
      "no_runner_online"
    );
  });

  it("says no runner is online for an empty project roster", () => {
    expect(runnerHintFor([], NO_DRAINS, NOW)).toBe("no_runner_online");
  });

  it("shows nothing when a device's liveness is not stated (older coord)", () => {
    const roster = [
      { device_id: A, within_dispatch_window: false },
      { device_id: B },
    ];
    expect(runnerHintFor(roster, NO_DRAINS, NOW)).toBeNull();
  });

  it("says every runner is drained only when each online one is", () => {
    const roster = [
      { device_id: A, within_dispatch_window: true },
      { device_id: B, within_dispatch_window: true },
    ];
    expect(runnerHintFor(roster, drained(A, B), NOW)).toBe("all_drained");
    expect(runnerHintFor(roster, drained(A), NOW)).toBeNull();
  });

  it("shows nothing when the drain read is unknown", () => {
    const roster = [{ device_id: A, within_dispatch_window: true }];
    expect(
      runnerHintFor(roster, { state: "unknown", reason: "403" }, NOW)
    ).toBeNull();
  });

  it("treats an expired drain as available", () => {
    const roster = [{ device_id: A, within_dispatch_window: true }];
    const read = drained(A);
    expect(
      runnerHintFor(roster, read, Date.parse("2026-10-02T00:00:00Z"))
    ).toBeNull();
  });
});

describe("runnerHintText", () => {
  it("names the project and coord's recorded outcome", () => {
    expect(runnerHintText("no_runner_online", "Shop")).toContain("“Shop”");
    expect(runnerHintText("no_runner_online", null)).toContain(
      "no capable runner online"
    );
    expect(runnerHintText("all_drained", null)).toContain(
      "every capable runner is drained"
    );
  });
});
