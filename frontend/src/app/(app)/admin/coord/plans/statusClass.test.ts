/**
 * `statusClass.ts` — the class cell, its filter, and the "needs a /vet-imp"
 * predicate (plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next`
 * Phase 3). The rule pinned throughout: an ABSENT or null value is UNKNOWN,
 * never folded into a class and never into "no".
 */

import { describe, expect, it } from "vitest";
import type { ReconciliationAxisA } from "@/components/admin/coord/planReconciliationStatus";
import {
  STATUS_CLASSES,
  STATUS_CLASS_FILTERS,
  describeStatusClass,
  matchesStatusClass,
  needsVetImp,
} from "./statusClass";

function axis(over: Partial<ReconciliationAxisA> = {}): ReconciliationAxisA {
  return { readable: true, present: true, status: "draft", ...over };
}

describe("describeStatusClass", () => {
  it("renders each of coord's five classes", () => {
    for (const cls of STATUS_CLASSES) {
      const r = describeStatusClass(axis({ status_class: cls }));
      expect(r.kind).toBe(cls);
      expect(r.unknown).toBe(false);
    }
  });

  it("groups off_vocabulary and unset as NEEDS CLEANUP, nothing else", () => {
    expect(
      describeStatusClass(axis({ status_class: "off_vocabulary" })).needsCleanup
    ).toBe(true);
    expect(
      describeStatusClass(axis({ status_class: "unset" })).needsCleanup
    ).toBe(true);
    for (const cls of ["derived", "attested", "free_known"] as const) {
      expect(
        describeStatusClass(axis({ status_class: cls })).needsCleanup
      ).toBe(false);
    }
  });

  it("reads an ABSENT status_class (older backend) as UNKNOWN, not unset", () => {
    const r = describeStatusClass(axis());
    expect(r.kind).toBe("unknown");
    expect(r.unknown).toBe(true);
    expect(r.needsCleanup).toBe(false);
    expect(r.label).toBe("class not reported");
  });

  it("reads null on a present unit as UNKNOWN", () => {
    expect(describeStatusClass(axis({ status_class: null })).kind).toBe(
      "unknown"
    );
  });

  it("reads an unreadable axis A as UNKNOWN", () => {
    const r = describeStatusClass(
      axis({ readable: false, present: false, unreadable_reason: "504" })
    );
    expect(r.kind).toBe("unknown");
    expect(r.detail).toContain("504");
  });

  it("says a stem with no coord unit has no class, rather than an unknown one", () => {
    expect(describeStatusClass(axis({ present: false })).kind).toBe("no_unit");
  });
});

describe("matchesStatusClass", () => {
  it("offers all five classes, the cleanup bucket and the unknown bucket", () => {
    const values = STATUS_CLASS_FILTERS.map((f) => f.value);
    for (const cls of STATUS_CLASSES) expect(values).toContain(cls);
    expect(values).toContain("needs_cleanup");
    expect(values).toContain("unknown");
  });

  it("matches the cleanup bucket on either member", () => {
    expect(
      matchesStatusClass(axis({ status_class: "unset" }), "needs_cleanup")
    ).toBe(true);
    expect(
      matchesStatusClass(
        axis({ status_class: "off_vocabulary" }),
        "needs_cleanup"
      )
    ).toBe(true);
    expect(
      matchesStatusClass(axis({ status_class: "attested" }), "needs_cleanup")
    ).toBe(false);
  });

  it("never lets an UNKNOWN class fall into a selected class", () => {
    for (const cls of STATUS_CLASSES) {
      expect(matchesStatusClass(axis(), cls)).toBe(false);
    }
    expect(matchesStatusClass(axis(), "needs_cleanup")).toBe(false);
    expect(matchesStatusClass(axis(), "unknown")).toBe(true);
    expect(matchesStatusClass(axis(), "any")).toBe(true);
  });
});

describe("needsVetImp — free_known OR (attested AND vet_state in {moved, gone})", () => {
  it("selects a draft plan (the phase's acceptance case)", () => {
    expect(
      needsVetImp(axis({ status: "draft", status_class: "free_known" })).need
    ).toBe("yes");
  });

  it.each(["moved", "gone"])(
    "selects an attested plan whose vet_state is %s",
    (v) => {
      expect(
        needsVetImp(
          axis({ status: "vetted", status_class: "attested", vet_state: v })
        ).need
      ).toBe("yes");
    }
  );

  it("does not select an attested plan whose vet_state is fresh", () => {
    expect(
      needsVetImp(
        axis({ status: "vetted", status_class: "attested", vet_state: "fresh" })
      ).need
    ).toBe("no");
  });

  it.each(["none", "unchanged", "something-new"])(
    "calls an attested plan whose vet_state is %s UNDETERMINED, never no",
    (v) => {
      expect(
        needsVetImp(
          axis({ status: "vetted", status_class: "attested", vet_state: v })
        ).need
      ).toBe("undetermined");
    }
  );

  it("calls an attested plan with vet_state null UNDETERMINED, never no", () => {
    const r = needsVetImp(
      axis({ status: "vetted", status_class: "attested", vet_state: null })
    );
    expect(r.need).toBe("undetermined");
    expect(r.why).toContain("UNKNOWN");
  });

  it("calls an attested plan with vet_state ABSENT (older backend) UNDETERMINED", () => {
    const r = needsVetImp(axis({ status: "vetted", status_class: "attested" }));
    expect(r.need).toBe("undetermined");
    expect(r.why).toContain("does not forward vet_state");
  });

  it.each(["derived", "off_vocabulary", "unset"] as const)(
    "does not select class %s",
    (cls) => {
      expect(needsVetImp(axis({ status_class: cls })).need).toBe("no");
    }
  );

  it("is UNDETERMINED when the class itself is unknown", () => {
    expect(needsVetImp(axis()).need).toBe("undetermined");
    expect(needsVetImp(axis({ readable: false, present: false })).need).toBe(
      "undetermined"
    );
  });

  it("is no for a stem with no coord unit", () => {
    expect(needsVetImp(axis({ present: false })).need).toBe("no");
  });
});
