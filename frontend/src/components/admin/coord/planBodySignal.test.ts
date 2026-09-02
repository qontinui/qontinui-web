/**
 * The body-signal copy, the suppression rule, and the two client-side filters.
 *
 * Plan `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`.
 * The DERIVATION is the backend's and is tested there
 * (`backend/tests/test_plan_body_signal.py`); what is asserted here is that
 * the console renders each value honestly, and never renders an unprovable
 * answer as a proven one.
 *
 * The screen's measured quality — recall 90.4%, precision 27.6%, one device,
 * 2026-09-02 — is asserted only as COPY (the tooltip states the precision),
 * never as a ratio over a corpus. A measurement pinned as an invariant reds
 * the build on an unrelated corpus change.
 */

import { describe, expect, it } from "vitest";
import {
  describeBodyProvenance,
  describeHasBody,
  filterPlansByBodySignal,
  hasBodyFilterValue,
  showsBodySignal,
  type BodyProvenance,
  type HasBodyFilter,
} from "./planBodySignal";
import type { CoordPlanRow } from "./planStatus";

function row(over: Partial<CoordPlanRow> = {}): CoordPlanRow {
  return { slug: "2026-09-01-x", ...over };
}

describe("describeBodyProvenance — the screen", () => {
  it("labels never_scanned as a SCREEN, with its precision stated", () => {
    const m = describeBodyProvenance("never_scanned");
    expect(m).not.toBeNull();
    expect(m!.label).toBe("no document seen");
    // The words that stop it reading as a verdict. Both are load-bearing:
    // "SCREEN" says what kind of claim it is, "27.6%" says how weak.
    expect(m!.title).toContain("SCREEN, not a verdict");
    expect(m!.title).toContain("27.6% precision");
  });

  it("marks scanned_locally as one-machine provenance, not as scanned", () => {
    const m = describeBodyProvenance("scanned_locally");
    expect(m!.label).toBe("document seen on one machine only");
    expect(m!.testId).not.toBe(describeBodyProvenance("never_scanned")!.testId);
    expect(m!.title).toContain("SCREEN, not a verdict");
  });

  it("renders NOTHING for scanned — it is not proof of a body", () => {
    // 5 of the 52 measured bodyless units carried a `source_path` naming a
    // file that exists on no machine. A "document seen" chip would be a claim
    // the data does not support, so silence is the accurate render.
    expect(describeBodyProvenance("scanned")).toBeNull();
  });

  it("renders nothing when the field is absent", () => {
    expect(describeBodyProvenance(undefined)).toBeNull();
    expect(describeBodyProvenance(null)).toBeNull();
  });
});

describe("describeHasBody — the verdict", () => {
  it("renders unknown as its OWN chip, never a tick and never a blank", () => {
    const m = describeHasBody("unknown", "empty_corpus_for_org");
    expect(m).not.toBeNull();
    expect(m!.label).toBe("document unknown");
    expect(m!.testId).toBe("coord-plan-has-body-unknown");
    // Distinct from both settled answers, in id and in words.
    expect(m!.testId).not.toBe(describeHasBody(true, null)!.testId);
    expect(m!.testId).not.toBe(describeHasBody(false, null)!.testId);
    expect(m!.className).not.toBe(describeHasBody(true, null)!.className);
    expect(m!.className).not.toBe(describeHasBody(false, null)!.className);
  });

  it("says UNKNOWN is not 'no document', in the tooltip", () => {
    const m = describeHasBody("unknown", "capture_off");
    expect(m!.title).toContain("UNKNOWN");
    expect(m!.title).toContain('not "no document"');
  });

  it.each([
    ["capture_off", "switched off"],
    ["capture_never_configured", "ever been written"],
    ["empty_corpus_for_org", "not the principal"],
    ["artifact_surface_unavailable", "could not be read at all"],
    ["capture_unreadable", "could not be read"],
    ["unjoinable_row", "without a usable slug"],
    ["no_org_principal", "no credential the plan library"],
  ] as const)("explains the %s arm rather than saying only 'unknown'", (
    reason,
    fragment
  ) => {
    expect(describeHasBody("unknown", reason)!.title).toContain(fragment);
  });

  it("still renders an unknown chip when no reason was supplied", () => {
    // A build that serves `has_body` without `body_unknown_reason` must not
    // silently fall through to a blank cell.
    const m = describeHasBody("unknown", null);
    expect(m).not.toBeNull();
    expect(m!.label).toBe("document unknown");
  });

  it("distinguishes an ABSENT field from a false one", () => {
    // "This build was not told" is not "there is no document".
    expect(describeHasBody(undefined, null)).toBeNull();
    expect(describeHasBody(false, null)).not.toBeNull();
  });

  it("says why a false is evidence at all", () => {
    expect(describeHasBody(false, null)!.title).toContain("absence IS evidence");
  });
});

describe("showsBodySignal — terminal suppression", () => {
  it.each(["shipped", "SHIPPED", "landed", "obsolete", "superseded", "closed"])(
    "suppresses the render on a terminal status (%s)",
    (status) => {
      expect(showsBodySignal(row({ status }))).toBe(false);
    }
  );

  it.each(["draft", "in_progress", "in-progress", "vetted", "blocked", ""])(
    "renders on a non-terminal status (%s)",
    (status) => {
      expect(showsBodySignal(row({ status }))).toBe(true);
    }
  );

  it("does NOT suppress on a status this page has no vocabulary for", () => {
    // Work-unit status is opaque text in coord. Suppression has to be earned
    // by a recognised terminal word; guessing the other way would hide the
    // signal on exactly the rows nobody has a vocabulary for.
    expect(showsBodySignal(row({ status: "collecting-evidence" }))).toBe(true);
    expect(showsBodySignal(row({ status: undefined }))).toBe(true);
  });
});

describe("hasBodyFilterValue", () => {
  it.each([
    [true, "yes"],
    [false, "no"],
    ["unknown", "unknown"],
  ] as const)("folds %s onto %s", (value, expected) => {
    expect(hasBodyFilterValue(value)).toBe(expected);
  });

  it("returns null for a row the backend did not annotate", () => {
    expect(hasBodyFilterValue(undefined)).toBeNull();
  });
});

describe("filterPlansByBodySignal", () => {
  const rows: CoordPlanRow[] = [
    row({ slug: "a", body_provenance: "never_scanned", has_body: false }),
    row({ slug: "b", body_provenance: "scanned", has_body: true }),
    row({ slug: "c", body_provenance: "scanned_locally", has_body: "unknown" }),
    row({ slug: "d" }), // an un-annotated row
  ];
  const slugs = (out: CoordPlanRow[]) => out.map((r) => r.slug);

  it("an EMPTY selection is no filter, never 'match nothing'", () => {
    expect(
      slugs(filterPlansByBodySignal(rows, { provenance: [], hasBody: [] }))
    ).toEqual(["a", "b", "c", "d"]);
  });

  it.each([
    ["never_scanned", ["a"]],
    ["scanned_locally", ["c"]],
    ["scanned", ["b"]],
  ] as [BodyProvenance, string[]][])(
    "filters on provenance=%s",
    (value, expected) => {
      expect(
        slugs(filterPlansByBodySignal(rows, { provenance: [value], hasBody: [] }))
      ).toEqual(expected);
    }
  );

  it.each([
    ["yes", ["b"]],
    ["no", ["a"]],
    ["unknown", ["c"]],
  ] as [HasBodyFilter, string[]][])("filters on document=%s", (value, expected) => {
    expect(
      slugs(filterPlansByBodySignal(rows, { provenance: [], hasBody: [value] }))
    ).toEqual(expected);
  });

  it("is multi-select within a strip", () => {
    expect(
      slugs(
        filterPlansByBodySignal(rows, {
          provenance: [],
          hasBody: ["no", "unknown"],
        })
      )
    ).toEqual(["a", "c"]);
  });

  it("ANDs the two strips", () => {
    expect(
      slugs(
        filterPlansByBodySignal(rows, {
          provenance: ["never_scanned"],
          hasBody: ["unknown"],
        })
      )
    ).toEqual([]);
  });

  it("excludes an un-annotated row from EITHER active filter", () => {
    // "Not told" is not a value, so it is not swept into a bucket it was
    // never measured for.
    for (const args of [
      { provenance: ["never_scanned" as const], hasBody: [] },
      { provenance: [], hasBody: ["no" as const] },
    ]) {
      expect(slugs(filterPlansByBodySignal(rows, args))).not.toContain("d");
    }
  });

  it("never mutates its input", () => {
    const before = [...rows];
    filterPlansByBodySignal(rows, { provenance: ["scanned"], hasBody: [] });
    expect(rows).toEqual(before);
  });
});
