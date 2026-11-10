/**
 * `deviceRowStateLabel` / `deviceStateBadgeVariant` — what one machine row
 * says about coord's state for it. `not_listed` and `ci_unrefreshed` are the
 * two the wire spelling cannot say on its own.
 */

import { describe, expect, it } from "vitest";
import {
  deviceRowStateLabel,
  deviceStateBadgeVariant,
  deviceStateLabel,
} from "./FleetHealthSummary";

const NOW = Date.parse("2026-11-10T12:00:00Z");

describe("deviceRowStateLabel", () => {
  it("says GitHub no longer lists a not_listed registration", () => {
    expect(
      deviceRowStateLabel({
        state: "ci_offline",
        ci_runner_status: "not_listed",
      })
    ).toBe("CI offline: GitHub no longer lists this registration");
    // A plain offline runner keeps the plain label.
    expect(
      deviceRowStateLabel({ state: "ci_offline", ci_runner_status: "offline" })
    ).toBe("CI offline");
  });

  it("ages a ci_unrefreshed row from last_seen_at", () => {
    expect(
      deviceRowStateLabel(
        { state: "ci_unrefreshed", last_seen_at: "2026-11-10T11:53:00Z" },
        { now: NOW }
      )
    ).toBe("not refreshed by the registrar (last refreshed 7m ago)");
  });

  it("says the age is unknown for a ci_unrefreshed row with no usable last_seen_at", () => {
    for (const last_seen_at of [undefined, null, "", "not a date"]) {
      expect(
        deviceRowStateLabel(
          { state: "ci_unrefreshed", last_seen_at },
          { now: NOW }
        )
      ).toBe("not refreshed by the registrar (last seen unknown)");
    }
  });

  it("never renders ci_unrefreshed as healthy or unknown", () => {
    const label = deviceRowStateLabel({ state: "ci_unrefreshed" });
    expect(label).not.toMatch(/healthy|^unknown$/);
    expect(deviceStateBadgeVariant("ci_unrefreshed")).toBe("secondary");
    expect(deviceStateBadgeVariant("ci_unrefreshed")).not.toBe(
      deviceStateBadgeVariant("healthy")
    );
    expect(deviceStateLabel("ci_unrefreshed")).toBe(
      "not refreshed by the registrar"
    );
  });

  it("reads an absent state as unknown, and passes other states through", () => {
    expect(deviceRowStateLabel({})).toBe("unknown");
    expect(deviceRowStateLabel({ state: "degraded" })).toBe("degraded");
  });
});
