/**
 * operatorTouchSlo — the SLO Dashboard's tenant-level touch line and its
 * dead-neighbour labels.
 *
 * The assertion this file exists for (plan
 * `2026-08-27-operator-touch-read-and-surface`, Verification): a reader can
 * tell that `escalation_rate` and `operator_override_rate` are structurally 0
 * and the touch rate is not — and an empty or unreadable touch store never
 * renders as a rate of zero.
 */

import { describe, expect, it } from "vitest";
import {
  NOT_YET_MEASURED_TEXT,
  describeOperatorTouchSlo,
  describeTouchWindow,
  structurallyZeroSet,
} from "./operatorTouchSlo";

describe("describeTouchWindow", () => {
  it("says Not yet measured for an empty store, never 0", () => {
    const v = describeTouchWindow({ measurement: "not_yet_measured" });
    expect(v.state).toBe("not_yet_measured");
    expect(v.text).toBe("Not yet measured — the touch emitter has not run");
    expect(v.text).toBe(NOT_YET_MEASURED_TEXT);
    expect(v.text).not.toMatch(/\b0(\.0)?\b/);
  });

  it("renders an unreadable store as unknown, naming why", () => {
    const v = describeTouchWindow({
      measurement: "unreadable",
      unreadable_reason: "schema_migration_pending",
    });
    expect(v.state).toBe("unknown");
    expect(v.text).toBe("Unknown");
    expect(v.title).toContain("not provisioned");
  });

  it("an unrecognised measurement word is unknown, not measured", () => {
    expect(describeTouchWindow({ measurement: "estimated" }).state).toBe(
      "unknown"
    );
  });

  it("a coord predating the block yields two unknowns", () => {
    const both = describeOperatorTouchSlo(undefined);
    expect(both.last7d.state).toBe("unknown");
    expect(both.last30d.state).toBe("unknown");
  });

  it("states a measured window as a per-day rate and an absorbed share", () => {
    const v = describeTouchWindow({
      measurement: "measured",
      touches: 12,
      operator_reaching: 6,
      operator_reaching_per_day: 2,
      agent_absorbed_rate: 0.25,
      unknown_share: 0,
      covered_days: 3,
      policy_authorized_split: { yes: 5, no: 6, unknown: 1 },
    });
    expect(v.state).toBe("measured");
    expect(v.text).toBe("2.0/day reached you · 25.0% agent-absorbable");
    expect(v.title).toContain("12 touches, 6 reached a person");
    expect(v.title).toContain("5 allowed, 6 not called for, 1 not yet judged");
  });

  it("a measured window with no touches shows the dash for its share, not 0%", () => {
    const v = describeTouchWindow({
      measurement: "measured",
      touches: 0,
      operator_reaching: 0,
      operator_reaching_per_day: 0,
      agent_absorbed_rate: null,
      unknown_share: null,
    });
    expect(v.text).toBe("0.0/day reached you · – agent-absorbable");
  });
});

describe("structurallyZeroSet", () => {
  it("holds the names coord lists", () => {
    const set = structurallyZeroSet(["operator_override_rate", "escalation_rate"]);
    expect(set.has("operator_override_rate")).toBe(true);
    expect(set.has("escalation_rate")).toBe(true);
    expect(set.has("auto_merge_success_rate")).toBe(false);
  });

  it("is empty — labels nothing — when coord does not send the list", () => {
    expect(structurallyZeroSet(undefined).size).toBe(0);
    expect(structurallyZeroSet(null).size).toBe(0);
  });
});
