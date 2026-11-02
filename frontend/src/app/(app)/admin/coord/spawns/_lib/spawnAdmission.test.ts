/**
 * Coord's spawn admission read: each figure stands or falls on its own, and an
 * unusable one is UNKNOWN with its reason, never a zero.
 */

import { describe, expect, it } from "vitest";
import { DEVICE_A } from "../__fixtures__/coordSpawns";
import { admissionBody } from "../__fixtures__/spawnPaths";
import {
  admissionFigureRead,
  heldReasonText,
  machineListNote,
  parseSpawnAdmission,
  stallKnobOf,
  type SpawnAdmissionFacts,
  type SpawnAdmissionRead,
} from "./spawnAdmission";

function factsOf(body: unknown): SpawnAdmissionFacts {
  const read = parseSpawnAdmission(body);
  if (read.state !== "known") throw new Error(`not known: ${read.reason}`);
  return read.facts;
}

describe("parseSpawnAdmission", () => {
  it("reads every figure coord states", () => {
    expect(factsOf(admissionBody())).toEqual({
      deviceInflight: { [DEVICE_A.toLowerCase()]: 2 },
      tenantInflight: 2,
      countsUnknownReason: null,
      ceilingPerDevice: 3,
      ceilingPerTenant: 10,
      heldByReason: { inflight_cap: 1 },
      heldUnknownReason: null,
      stallKnob: true,
      stallKnobUnknownReason: null,
    });
  });

  it("is UNKNOWN for a body it does not recognise", () => {
    for (const body of [null, [], "nope", 3, {}, { detail: "Not Found" }]) {
      expect(parseSpawnAdmission(body).state).toBe("unknown");
    }
  });

  it("keeps coord's reason for a figure it could not read, and the rest of the answer", () => {
    const facts = factsOf(
      admissionBody({
        counts: null,
        counts_unknown_reason: "PG acquire: timed out",
      })
    );
    expect(facts.deviceInflight).toBeNull();
    expect(facts.tenantInflight).toBeNull();
    expect(facts.countsUnknownReason).toBe("PG acquire: timed out");
    expect(facts.ceilingPerDevice).toBe(3);
    expect(facts.stallKnob).toBe(true);
  });

  it("treats a malformed count as unknown for the whole map, never dropping a machine to zero", () => {
    for (const bad of [-1, 1.5, "2", null]) {
      const facts = factsOf(
        admissionBody({
          counts: { device_inflight: { [DEVICE_A]: bad }, tenant_inflight: 2 },
        })
      );
      expect(facts.deviceInflight).toBeNull();
      expect(facts.countsUnknownReason).toContain("not a map of counts");
    }
  });

  it("does not read a missing map or reason as nothing held", () => {
    const facts = factsOf(
      admissionBody({
        shepherd_deferrals_24h_by_held_by: null,
        shepherd_deferrals_unknown_reason: null,
      })
    );
    expect(facts.heldByReason).toBeNull();
    expect(facts.heldUnknownReason).toBe("coord did not say why");
  });

  it("does not take a non-boolean knob for a value", () => {
    const facts = factsOf(
      admissionBody({
        auto_fix_admission_stall: "true",
        auto_fix_admission_stall_unknown_reason: "read failed",
      })
    );
    expect(facts.stallKnob).toBeNull();
    expect(facts.stallKnobUnknownReason).toBe("read failed");
  });

  it("leaves a ceiling it cannot read unknown", () => {
    expect(
      factsOf(admissionBody({ ceilings: null })).ceilingPerDevice
    ).toBeNull();
    expect(
      factsOf(
        admissionBody({
          ceilings: { COORD_AUTODISPATCH_MAX_INFLIGHT_PER_DEVICE: "3" },
        })
      ).ceilingPerDevice
    ).toBeNull();
  });
});

describe("admissionFigureRead", () => {
  it("is false when coord answered and read nothing, which must not date the read", () => {
    expect(
      admissionFigureRead(
        factsOf(
          admissionBody({
            counts: null,
            shepherd_deferrals_24h_by_held_by: null,
            auto_fix_admission_stall: null,
          })
        )
      )
    ).toBe(false);
    expect(admissionFigureRead(factsOf(admissionBody()))).toBe(true);
  });
});

describe("stallKnobOf", () => {
  it("is unknown until a read answered, with why", () => {
    expect(stallKnobOf({ state: "loading" }).value).toBeNull();
    expect(stallKnobOf({ state: "unknown", reason: "HTTP 502" })).toEqual({
      value: null,
      reason: "HTTP 502",
      stale: false,
    });
  });

  it("carries the value, and that it is the last good one", () => {
    const known = parseSpawnAdmission(
      admissionBody({ auto_fix_admission_stall: false })
    );
    if (known.state !== "known") throw new Error("fixture");
    expect(stallKnobOf(known)).toMatchObject({ value: false, stale: false });
    expect(stallKnobOf({ ...known, staleReason: "HTTP 502" })).toMatchObject({
      value: false,
      stale: true,
    });
  });
});

describe("machineListNote", () => {
  const known = parseSpawnAdmission(admissionBody());

  it("states the total and the held reasons in words", () => {
    expect(machineListNote(known, false)).toEqual({
      text: "This tenant, across machines: 2 of 10 in flight. Merge-shepherd holds recorded in the last 24 hours (records, not spawns: a held pull request can record again): at the in-flight limit 1.",
      unknown: false,
    });
  });

  it("says when a read map came without a total, rather than dropping it", () => {
    const read = parseSpawnAdmission(
      admissionBody({ counts: { device_inflight: {} } })
    );
    const note = machineListNote(read, false);
    expect(note.unknown).toBe(true);
    expect(note.text).toContain("total across machines: UNKNOWN");
  });

  it("merges reasons it has no words for while presenting", () => {
    const read = parseSpawnAdmission(
      admissionBody({
        shepherd_deferrals_24h_by_held_by: { new_a: 1, new_b: 2 },
      })
    );
    expect(machineListNote(read, true).text).toContain("another reason 3.");
    expect(machineListNote(read, false).text).toContain("new_b 2, new_a 1.");
  });

  it("says nothing was held only when coord read that", () => {
    const empty = parseSpawnAdmission(
      admissionBody({ shepherd_deferrals_24h_by_held_by: {} })
    );
    expect(machineListNote(empty, false).text).toContain(
      "No merge-shepherd hold was recorded in the last 24 hours."
    );
    const unread = parseSpawnAdmission(
      admissionBody({
        shepherd_deferrals_24h_by_held_by: null,
        shepherd_deferrals_unknown_reason: "shepherd deferral read: boom",
      })
    );
    const note = machineListNote(unread, false);
    expect(note.unknown).toBe(true);
    expect(note.text).toContain("UNKNOWN — shepherd deferral read: boom");
    expect(note.text).not.toContain("No merge-shepherd hold");
  });

  it("orders the held reasons by how many, then by their words", () => {
    const read = parseSpawnAdmission(
      admissionBody({
        shepherd_deferrals_24h_by_held_by: {
          rate_cap: 1,
          inflight_cap: 1,
          device_drained: 4,
        },
      })
    );
    expect(machineListNote(read, false).text).toContain(
      "machine out of service 4, at the hourly limit 1, at the in-flight limit 1."
    );
  });

  it("never quotes coord's words while presenting", () => {
    const reads: SpawnAdmissionRead[] = [
      { state: "loading" },
      {
        state: "unknown",
        reason: "HTTP 502 from /coord/fleet/spawn-admission",
      },
      parseSpawnAdmission(
        admissionBody({
          counts: null,
          counts_unknown_reason: "PG acquire: /coord secret",
          shepherd_deferrals_24h_by_held_by: null,
          shepherd_deferrals_unknown_reason: "/coord deferral secret",
        })
      ),
    ];
    for (const read of reads) {
      const { text, unknown } = machineListNote(read, true);
      expect(unknown).toBe(true);
      expect(text).not.toMatch(/\bcoord\b/i);
      expect(text).not.toContain("502");
    }
  });

  it("says when its figures are the last good read", () => {
    if (known.state !== "known") throw new Error("fixture");
    const stale = { ...known, staleReason: "HTTP 502" };
    expect(machineListNote(stale, false)).toMatchObject({ unknown: true });
    expect(machineListNote(stale, false).text).toContain(
      "from the last good read: HTTP 502."
    );
    expect(machineListNote(stale, true).text).not.toContain("502");
  });
});

describe("heldReasonText", () => {
  it("names every reason in the service's outsider-safe words", () => {
    for (const key of [
      "not_leader",
      "no_admissible_device",
      "author_grace",
      "registry_unreadable",
    ]) {
      const words = heldReasonText(key, true);
      expect(words).not.toBe("another reason");
      expect(words).not.toMatch(/\bcoord\b/i);
    }
  });

  it("names a key it knows and does not guess at one it does not", () => {
    expect(heldReasonText("rate_cap", true)).toBe("at the hourly limit");
    expect(heldReasonText("brand_new_key", false)).toBe("brand_new_key");
    expect(heldReasonText("brand_new_key", true)).toBe("another reason");
  });

  it("does not read a key off the object prototype", () => {
    expect(heldReasonText("constructor", true)).toBe("another reason");
  });
});
