/**
 * `servedAsOfMs` — coord's `as_of` when the body states a valid one, clamped
 * to the answer's arrival; the arrival otherwise (plan
 * `2026-10-23-console-presentation-spaces` Phase 7).
 */

import { describe, expect, it } from "vitest";
import { servedAsOfMs } from "./servedAsOf";

const RECEIVED = Date.parse("2026-10-27T12:00:30Z");

describe("servedAsOfMs", () => {
  it("reads coord's RFC 3339 as_of, in every spelling chrono serialises", () => {
    expect(servedAsOfMs({ as_of: "2026-10-27T12:00:00Z" }, RECEIVED)).toBe(
      Date.parse("2026-10-27T12:00:00Z")
    );
    expect(
      servedAsOfMs({ as_of: "2026-10-27T12:00:00.123456789Z" }, RECEIVED)
    ).toBe(Date.parse("2026-10-27T12:00:00.123Z"));
    expect(
      servedAsOfMs({ as_of: "2026-10-27T14:00:00+02:00" }, RECEIVED)
    ).toBe(Date.parse("2026-10-27T12:00:00Z"));
  });

  it("never dates an answer later than it arrived (coord's clock ahead)", () => {
    expect(servedAsOfMs({ as_of: "2026-10-27T12:05:00Z" }, RECEIVED)).toBe(
      RECEIVED
    );
  });

  it.each<[string, unknown]>([
    ["no body", null],
    ["a list", [{ as_of: "2026-10-27T12:00:00Z" }]],
    ["no as_of", { devices: [] }],
    ["a numeric as_of", { as_of: 1_793_000_000_000 }],
    ["a date without a time", { as_of: "2026-10-27" }],
    ["a bare year", { as_of: "2026" }],
    ["text", { as_of: "garbage" }],
    ["a time with no zone", { as_of: "2026-10-27T12:00:00" }],
    ["an impossible date", { as_of: "2026-13-45T99:99:99Z" }],
  ])("falls back to the arrival for %s", (_label, body) => {
    expect(servedAsOfMs(body, RECEIVED)).toBe(RECEIVED);
  });
});
