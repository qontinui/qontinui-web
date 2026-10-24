/**
 * `deriveMode.ts` — the decay-detection caveat (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 3). An
 * absent posture is never read as a healthy one.
 */

import { describe, expect, it } from "vitest";
import { SHADOW_CAVEAT, deriveModeOf, describeDeriveMode } from "./deriveMode";

describe("describeDeriveMode", () => {
  it("live → no caveat", () => {
    expect(
      describeDeriveMode({ state: "loaded", mode: "live" }).caveat
    ).toBeNull();
  });

  it("shadow → the deployment-wide caveat, verbatim", () => {
    const r = describeDeriveMode({ state: "loaded", mode: "shadow" });
    expect(r.caveat).toBe(
      "decay detection runs in shadow mode on this coord deployment — this signal may be stale"
    );
    expect(r.caveat).toBe(SHADOW_CAVEAT);
    expect(r.caveat).not.toContain("tenant");
  });

  it("an ABSENT field (older coord) → decay-detection mode UNKNOWN, never live", () => {
    const r = describeDeriveMode({
      state: "loaded",
      mode: deriveModeOf({ row_count: 4 }),
    });
    expect(r.kind).toBe("absent");
    expect(r.caveat).toContain("decay-detection mode UNKNOWN");
  });

  it("a failed or pending read is UNKNOWN too", () => {
    expect(
      describeDeriveMode({ state: "failed", reason: "502" }).caveat
    ).toContain("decay-detection mode UNKNOWN");
    expect(describeDeriveMode({ state: "pending" }).caveat).toContain(
      "decay-detection mode UNKNOWN"
    );
  });

  it("an unrecognised mode is UNKNOWN, named", () => {
    const r = describeDeriveMode({ state: "loaded", mode: "canary" });
    expect(r.kind).toBe("unrecognised");
    expect(r.caveat).toContain("canary");
  });

  it("deriveModeOf survives a non-object body", () => {
    expect(deriveModeOf(null)).toBeUndefined();
    expect(deriveModeOf("x")).toBeUndefined();
  });
});
