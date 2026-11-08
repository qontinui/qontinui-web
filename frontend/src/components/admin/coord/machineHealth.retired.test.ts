/**
 * `excluded.retired` — rows coord's device reaper retired. They are hidden
 * on purpose and never return to zero, so they must never read as a binding
 * fault or as an incomplete roster; they only explain an empty one.
 */
import { describe, expect, it } from "vitest";
import {
  appendRosterExclusions,
  emptyRosterSentence,
  isRosterBindingFault,
  isRosterComplete,
  readRosterExclusions,
  retiredRowsSentence,
} from "./machineHealth";

describe("readRosterExclusions with retired rows", () => {
  it("keeps a roster with only retired rows complete and fault-free", () => {
    const e = readRosterExclusions({
      excluded: { unbound: 0, bound_to_other_tenant: 0, retired: 5700 },
    });
    expect(e).toEqual({ kind: "none_withheld", retired: 5700 });
    expect(isRosterComplete(e)).toBe(true);
    expect(isRosterBindingFault(e)).toBe(false);
  });

  it("carries retired beside a real binding fault without adding to it", () => {
    const e = readRosterExclusions({
      excluded: { unbound: 2, bound_to_other_tenant: 0, retired: 9 },
    });
    expect(e).toEqual({
      kind: "withheld",
      unbound: 2,
      boundToOtherTenant: 0,
      retired: 9,
    });
  });

  it("ignores an absent, zero or malformed retired count", () => {
    for (const retired of [undefined, 0, -1, "3", 1.5]) {
      expect(
        readRosterExclusions({
          excluded: { unbound: 0, bound_to_other_tenant: 0, retired },
        })
      ).toEqual({ kind: "none_withheld" });
    }
  });

  it("explains an empty roster by its retired rows", () => {
    const e = readRosterExclusions({
      excluded: { unbound: 0, bound_to_other_tenant: 0, retired: 1 },
    });
    expect(emptyRosterSentence(e, { withReason: false })).toBe(
      "Coord lists no machines and withheld none from its roster, so there is no machine this view can call healthy. 1 device was retired after going unseen past coord's reaper grace period and is not listed — retired, which is not a withheld machine."
    );
  });

  it("names retired rows beside a binding fault too", () => {
    const e = readRosterExclusions({
      excluded: { unbound: 2, bound_to_other_tenant: 0, retired: 9 },
    });
    expect(emptyRosterSentence(e, { withReason: false })).toContain(
      "9 devices were retired"
    );
    expect(
      retiredRowsSentence(
        readRosterExclusions({
          excluded: { unbound: 0, bound_to_other_tenant: 0 },
        })
      )
    ).toBeNull();
  });
});

describe("appendRosterExclusions", () => {
  it("names withheld machines before the retired clause", () => {
    expect(
      appendRosterExclusions("Coord reported 0 devices.", {
        excluded: { unbound: 3, bound_to_other_tenant: 0, retired: 10 },
      })
    ).toBe(
      "Coord reported 0 devices. Coord also withheld 3 machines from its roster (3 with no binding), so the roster is incomplete and their health is unknown. 10 devices were retired after going unseen past coord's reaper grace period and are not listed — retired, which is not a withheld machine."
    );
  });

  it("names an uncountable withheld set without quoting coord's error", () => {
    expect(
      appendRosterExclusions("Coord reported 0 devices.", {
        excluded: null,
        excluded_error: "tenant_devices read failed",
      })
    ).toBe(
      "Coord reported 0 devices. Coord could not count the machines it withheld from its roster, so the roster may be incomplete — machine health beyond it is unknown."
    );
  });

  it("appends the retired count read from a fleet/health body", () => {
    expect(
      appendRosterExclusions("Coord reported 0 devices.", {
        excluded: { unbound: 0, bound_to_other_tenant: 0, retired: 1 },
      })
    ).toBe(
      "Coord reported 0 devices. 1 device was retired after going unseen past coord's reaper grace period and is not listed — retired, which is not a withheld machine."
    );
  });

  it("leaves the sentence alone when coord states no retired rows", () => {
    for (const body of [
      {},
      { excluded: { unbound: 0, bound_to_other_tenant: 0 } },
      { excluded: { unbound: 0, bound_to_other_tenant: 0, retired: 0 } },
      { excluded: { unbound: 0, bound_to_other_tenant: 0, retired: "9" } },
    ]) {
      expect(appendRosterExclusions("Coord reported 0 devices.", body)).toBe(
        "Coord reported 0 devices."
      );
    }
  });
});
