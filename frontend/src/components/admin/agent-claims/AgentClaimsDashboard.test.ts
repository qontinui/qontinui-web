import { describe, expect, it } from "vitest";
import { formatPredicate } from "./AgentClaimsDashboard";

describe("formatPredicate time_elapsed", () => {
  // Finding 150f64a6: this table falls back to the raw JSON, which for a
  // since_gate soak would put coord's parked `since` on screen.
  it("never shows the parked since of a since_gate soak", () => {
    const out = formatPredicate({
      kind: "time_elapsed",
      duration_secs: 3_600,
      since: "9999-12-31T23:59:59Z",
      since_gate: "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9",
    });
    expect(out).toBe("time_elapsed: 1h after gate 0a1b2c3d clears");
  });

  it("leaves a gate with a real since on the raw JSON fallback", () => {
    const pred = {
      kind: "time_elapsed",
      duration_secs: 3_600,
      since: "2026-06-05T00:00:00Z",
    };
    expect(formatPredicate(pred)).toBe(JSON.stringify(pred));
  });
});
