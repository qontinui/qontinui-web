/**
 * `captureHealthStatus` — the four readings `/plan-library/capture-health`
 * states and a renderer gets wrong by default.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4a.
 * The first case below is the one the whole panel exists for: a door with
 * ZERO artifacts must survive the derivation, because "the agent door has
 * written nothing" is the finding and a row that vanishes reads as an absent
 * feature.
 */

import { describe, expect, it } from "vitest";
import {
  KNOWN_DOOR_ORDER,
  SECOND_READ_CAVEAT,
  SECOND_READ_NOTE,
  type CaptureHealthResponse,
  deriveCaptureCensus,
  describeCorpusFreshness,
  describeDoor,
} from "./captureHealthStatus";

const RESPONSE: CaptureHealthResponse = {
  total: 1887,
  doors: [
    {
      captured_by: "runner_scan",
      count: 1880,
      known: true,
      first_at: "2026-06-01T00:00:00Z",
      last_touched_at: "2026-09-20T09:00:00Z",
    },
    { captured_by: "agent", count: 0, known: true },
    {
      captured_by: "operator",
      count: 7,
      known: true,
      first_at: "2026-08-01T00:00:00Z",
      last_touched_at: "2026-09-01T00:00:00Z",
    },
  ],
  newest_updated_at: "2026-09-20T09:00:00Z",
};

describe("a door with zero artifacts is the finding, so it survives", () => {
  it("keeps the zero door in the census rather than filtering it out", () => {
    const census = deriveCaptureCensus(RESPONSE);
    expect(census.doors.map((d) => d.doorId)).toEqual([
      "runner_scan",
      "agent",
      "operator",
    ]);
    const agent = census.doors.find((d) => d.doorId === "agent");
    expect(agent?.count).toBe(0);
    expect(agent?.silent).toBe(true);
  });

  it("names the silent doors separately, so a panel can say it in words", () => {
    const census = deriveCaptureCensus(RESPONSE);
    expect(census.silentDoors.map((d) => d.doorId)).toEqual(["agent"]);
  });

  it("orders by the vocabulary, NOT by count — a zero must not sink", () => {
    // Sorting by count would push every zero to one end, which is exactly
    // where a reader stops looking.
    const census = deriveCaptureCensus({
      ...RESPONSE,
      doors: [
        { captured_by: "operator", count: 7 },
        { captured_by: "agent", count: 0 },
        { captured_by: "runner_scan", count: 1880 },
      ],
    });
    expect(census.doors.map((d) => d.doorId)).toEqual([...KNOWN_DOOR_ORDER]);
  });

  it("reads a door with NO count field as unknown — never as the silence finding", () => {
    // The panel's loudest claim is "this door has written nothing". Reading
    // an absent field as `0` would manufacture that accusation about a door
    // out of a field the response did not carry, on the one panel whose
    // entire purpose is that accusation.
    const reading = describeDoor({ captured_by: "agent" });
    expect(reading.count).toBeNull();
    expect(reading.countUnstated).toBe(true);
    expect(reading.silent).toBe(false);
  });

  it("keeps a SERVED zero as the finding", () => {
    const reading = describeDoor({ captured_by: "agent", count: 0 });
    expect(reading.count).toBe(0);
    expect(reading.silent).toBe(true);
    expect(reading.countUnstated).toBe(false);
  });

  it("separates the unstated doors from the silent ones in the census", () => {
    const census = deriveCaptureCensus({
      total: 7,
      doors: [
        { captured_by: "runner_scan", count: 7 },
        { captured_by: "agent", count: 0 },
        { captured_by: "operator" },
      ],
    });
    expect(census.silentDoors.map((d) => d.doorId)).toEqual(["agent"]);
    expect(census.countUnstatedDoors.map((d) => d.doorId)).toEqual([
      "operator",
    ]);
  });
});

describe("last_touched_at is last TOUCHED", () => {
  it("carries the caveat on every door that has a timestamp", () => {
    const census = deriveCaptureCensus(RESPONSE);
    const scan = census.doors.find((d) => d.doorId === "runner_scan");
    expect(scan?.lastTouchedAt).toBe("2026-09-20T09:00:00Z");
    expect(scan?.freshnessCaveat).toMatch(/not last captured/i);
    expect(scan?.freshnessCaveat).toMatch(/kind correction/i);
  });

  it("offers no caveat where there is no timestamp to caveat", () => {
    const census = deriveCaptureCensus(RESPONSE);
    expect(
      census.doors.find((d) => d.doorId === "agent")?.freshnessCaveat
    ).toBeNull();
  });
});

describe("newest_updated_at: null is UNKNOWN, never 'fresh'", () => {
  it("reads a null as unknown and says why", () => {
    const freshness = describeCorpusFreshness({
      ...RESPONSE,
      newest_updated_at: null,
    });
    expect(freshness.unknown).toBe(true);
    expect(freshness.at).toBeNull();
    expect(freshness.text).toMatch(/empty/i);
    expect(freshness.text).not.toMatch(/\bfresh\b/i);
  });

  it("reads an ABSENT field the same way — absence is not currency", () => {
    const freshness = describeCorpusFreshness({ total: 0, doors: [] });
    expect(freshness.unknown).toBe(true);
  });

  it("reads an unread census as unknown rather than as an empty corpus", () => {
    expect(describeCorpusFreshness(null).unknown).toBe(true);
  });

  it("carries the touched-not-captured caveat on a real value", () => {
    const freshness = describeCorpusFreshness(RESPONSE);
    expect(freshness.unknown).toBe(false);
    expect(freshness.at).toBe("2026-09-20T09:00:00Z");
    expect(freshness.text).toMatch(/not last captured/i);
  });
});

describe("a door this build does not recognise is surfaced, not swallowed", () => {
  it("marks it and keeps its raw name", () => {
    const census = deriveCaptureCensus({
      ...RESPONSE,
      doors: [
        ...(RESPONSE.doors ?? []),
        { captured_by: "mcp", count: 3, known: false },
      ],
    });
    const extra = census.doors.at(-1);
    expect(extra?.doorId).toBe("mcp");
    expect(extra?.label).toBe("mcp");
    expect(extra?.unrecognised).toBe(true);
    expect(census.unrecognisedDoors).toHaveLength(1);
  });
});

describe("an absent doors array is a shape we do not understand", () => {
  it("is doorsUnstated, NOT a corpus with no doors", () => {
    const census = deriveCaptureCensus({ total: 0 });
    expect(census.doorsUnstated).toBe(true);
    expect(census.doors).toEqual([]);
    // The route returns every door in its vocabulary on every read, so an
    // absent list can never be read as "no door has written".
    expect(census.silentDoors).toEqual([]);
  });

  it("dashes an unserved total rather than summing the rows", () => {
    expect(deriveCaptureCensus({ doors: [] }).total).toBeNull();
  });
});

describe("the census never restores a suppressed completeness claim", () => {
  it("has a caveat that says so explicitly", () => {
    expect(SECOND_READ_CAVEAT).toMatch(/does NOT/);
    expect(SECOND_READ_CAVEAT).toMatch(/completeness/i);
    expect(SECOND_READ_CAVEAT).toMatch(/different moments/i);
  });

  it("still warns about the two reads' timing when nothing was suppressed", () => {
    expect(SECOND_READ_NOTE).toMatch(/own timing/i);
  });
});
