/**
 * The presentation lens's ages (plan `2026-10-23-console-presentation-spaces`
 * D1, "provenance on"): an age the shared 15-second tick cannot understate,
 * and an instant that reads the same on a server and in any browser.
 */

import { describe, expect, it } from "vitest";
import {
  PRESENTATION_CLOCK_TICK_MS,
  presentationAge,
  stableInstantText,
} from "./presentationClock";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("stableInstantText", () => {
  it("is UTC to the minute", () => {
    expect(stableInstantText("2026-10-23T11:57:42.123Z")).toBe(
      "2026-10-23 11:57 UTC"
    );
  });
});

describe("presentationAge", () => {
  it.each<[string, string | null | undefined, number | null, string]>([
    ["no instant", null, NOW, "UNKNOWN"],
    ["an unparseable instant", "not a time", NOW, "UNKNOWN"],
    ["no client clock", ago(3 * 60_000), null, "2026-10-23 11:57 UTC"],
    ["a figure from now", ago(0), NOW, "under a minute ago"],
    ["just under a minute", ago(59_999), NOW, "under a minute ago"],
    ["a clock running ahead", ago(-5_000), NOW, "under a minute ago"],
    ["a minute", ago(60_000), NOW, "1m ago"],
    ["hours", ago(3 * 3_600_000), NOW, "3h ago"],
  ])("%s", (_name, iso, now, expected) => {
    expect(presentationAge(iso, now, "UNKNOWN")).toBe(expected);
  });

  it("never needs a finer resolution than the tick it re-renders on", () => {
    // Below a minute the text cannot change between ticks, so it cannot lag.
    expect(PRESENTATION_CLOCK_TICK_MS).toBeLessThanOrEqual(60_000);
  });
});
