/**
 * The home strip's nav reconcile line names a `ci_unrefreshed` CI
 * registration, entered the way the home page enters it: the roster is read
 * by `readMachineRoster` and handed to `deriveHomeStrip`. Plan
 * `2026-11-10-fleet-state-and-web-read-ci-registration-presence` Phase 2.
 *
 * Kept in its own file, with no helper that builds machine counts directly,
 * so the test enters only through the population's seam.
 */

import { readMachineRoster } from "@/components/admin/coord/machineHealth";
import { describe, expect, it } from "vitest";
import { deriveHomeStrip, parseProjectState } from "./coordHomeStatus";

const calm = () =>
  parseProjectState({
    generated_at: "2026-11-10T00:00:00Z",
    on_track: {
      state: "read",
      totals: { row_count: 0, classes: {} },
      groups: [],
    },
    correctness: { state: "read" },
    needs_me: { state: "read", items: [], total: 0, omitted: 0 },
    degradations: { state: "read", headline: "none", open: [], declared: [] },
    does_not_know: [{ source: "work_units", state: "read" }],
  });

describe("the home strip over a roster read through readMachineRoster", () => {
  it("names a ci_unrefreshed row in the nav reconcile line, read through readMachineRoster", () => {
    const devs = [
      { device_id: "d-0", state: "healthy" },
      { device_id: "d-1", state: "ci_unrefreshed" },
    ];
    const roster = readMachineRoster(devs, {
      excluded: { unbound: 0, bound_to_other_tenant: 0 },
      truncated: false,
      total: 2,
      degradable_dropped: 0,
    });
    expect(roster.counts.ciUnrefreshed).toBe(1);
    expect(roster.counts.noVerdict).toBe(0);
    const strip = deriveHomeStrip(calm(), {
      machines: { stale: false, ...roster },
    });
    expect(strip.detail).toContain(
      "1 machine not reporting healthy is not a degradation: 1 CI registration the registrar has not refreshed recently — see Dev Ops."
    );
    expect(strip.detail).not.toMatch(/no health verdict/);
    // Not a degradation, so "nothing is degrading" still holds.
    expect(strip.headline).toBe("Nothing needs you and nothing is degrading");
  });
});
