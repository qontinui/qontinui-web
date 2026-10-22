/**
 * Census parity (plan `2026-09-17-retire-the-runner-origin-guard-dev-grace`,
 * Phase 4, test 8): `RUNNER_DOOR_ROUTES` equals the plan's Phase 0 census
 * appendix — every `(method, route)` this frontend sends to a runner that the
 * runner's own `is_credential_door` classifies as a door.
 *
 * The fixture is a copy of the appendix. A door call added without a proxy
 * entry is caught when the census is re-run and the fixture refreshed; an
 * entry added here without a census row is caught now.
 */

import { describe, expect, it } from "vitest";
import census from "./door-routes.census.json";
import { RUNNER_DOOR_ROUTES } from "./door-routes";

describe("RUNNER_DOOR_ROUTES equals the Phase 0 census appendix", () => {
  it("same set of (method, route) pairs", () => {
    const fromList = RUNNER_DOOR_ROUTES.map(
      (r) => `${r.method} ${r.pattern}`
    ).sort();
    const fromCensus = (census.doors as Array<[string, string]>)
      .map(([m, p]) => `${m} ${p}`)
      .sort();
    expect(fromList).toEqual(fromCensus);
  });

  it("no duplicate entries", () => {
    const keys = RUNNER_DOOR_ROUTES.map((r) => `${r.method} ${r.pattern}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
