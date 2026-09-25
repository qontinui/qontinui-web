/**
 * The body-signal copy, the suppression rule, and the two client-side filters.
 *
 * Plan `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`,
 * plus Phase 3's spawn guard (`deriveSpawnBodyConfirm` / `seedSpawnPrompt`),
 * which is a pure predicate over the same three wire fields and belongs in
 * the same file as the copy it chooses between.
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
  deriveSpawnBodyConfirm,
  filterPlansByBodySignal,
  foldBodySignalBlocks,
  hasBodyFilterTooltip,
  hasBodyFilterValue,
  seedSpawnPrompt,
  showsBodySignal,
  type BodyProvenance,
  type HasBodyFilter,
  type PlanBodySignalBlock,
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

describe("deriveSpawnBodyConfirm — the spawn guard (Phase 3)", () => {
  /**
   * The predicate both spawn entry points read. All six inputs are pinned
   * here, because the two `null`s at the bottom are the ones a later change
   * is most likely to "fix" into an interruption: two weak signals that
   * DISAGREE are not evidence, and a field nobody served is not evidence
   * either.
   */

  it("confirms on a proven absence, and says so as a fact", () => {
    const c = deriveSpawnBodyConfirm(
      row({ status: "in_progress", has_body: false })
    );
    expect(c).not.toBeNull();
    expect(c!.risk).toBe("absent");
    expect(c!.headline).toBe("This work unit has no plan document.");
    // The COST is what the operator is being asked to accept, so it has to
    // be in the words — not just the fact.
    expect(c!.detail).toMatch(/have to author the plan/);
  });

  it("confirms on unknown + never_scanned, worded as UNPROVEN", () => {
    const c = deriveSpawnBodyConfirm(
      row({
        status: "draft",
        has_body: "unknown",
        body_provenance: "never_scanned",
      })
    );
    expect(c).not.toBeNull();
    expect(c!.risk).toBe("unproven");
    // The honesty gate: this arm must never read like the `absent` arm.
    expect(c!.headline).toContain("No plan document could be confirmed");
    expect(c!.detail).toContain("UNPROVEN, not proof of absence");
    expect(c!.detail).toContain("SCREEN, not a verdict");
    expect(c!.headline).not.toBe(
      deriveSpawnBodyConfirm(row({ has_body: false }))!.headline
    );
    expect(c!.testId).not.toBe(
      deriveSpawnBodyConfirm(row({ has_body: false }))!.testId
    );
  });

  it("names WHICH unknown arm fired, rather than saying only 'unknown'", () => {
    const c = deriveSpawnBodyConfirm(
      row({
        has_body: "unknown",
        body_provenance: "never_scanned",
        body_unknown_reason: "empty_corpus_for_org",
      })
    );
    // Reused verbatim from the chip's own copy — one vocabulary, not two.
    expect(c!.detail).toContain("not the principal");
  });

  it("does NOT confirm when the two weak signals DISAGREE", () => {
    // A scanner saw a file and the corpus cannot confirm it. Neither of
    // those is evidence of absence, and interrupting on their disagreement
    // spends the confirm's credibility on nothing.
    for (const provenance of ["scanned", "scanned_locally"] as const) {
      expect(
        deriveSpawnBodyConfirm(
          row({ has_body: "unknown", body_provenance: provenance })
        )
      ).toBeNull();
    }
    // ...and an `unknown` with no provenance at all is the same case: the
    // screen said nothing, so nothing agrees with the verdict.
    expect(deriveSpawnBodyConfirm(row({ has_body: "unknown" }))).toBeNull();
  });

  it("does NOT confirm when the document is there", () => {
    expect(
      deriveSpawnBodyConfirm(
        row({ has_body: true, body_provenance: "never_scanned" })
      )
    ).toBeNull();
  });

  it("does NOT confirm on a TERMINAL unit, however bodyless", () => {
    // Same rule as the badges: a shipped unit that never had a document is
    // not a defect, so it is not a spawn worth interrupting.
    for (const status of ["shipped", "obsolete", "SUPERSEDED", "landed"]) {
      expect(
        deriveSpawnBodyConfirm(
          row({ status, has_body: false, body_provenance: "never_scanned" })
        )
      ).toBeNull();
    }
  });

  it("does NOT confirm when the backend served no signal at all", () => {
    // "Not told" is silence about a document, not evidence of one — and it
    // must not mint a new interruption on a path that never had one.
    expect(deriveSpawnBodyConfirm(row({ status: "in_progress" }))).toBeNull();
    expect(deriveSpawnBodyConfirm(undefined)).toBeNull();
    expect(deriveSpawnBodyConfirm(null)).toBeNull();
  });
});

describe("seedSpawnPrompt — author, not implement", () => {
  const unit = { slug: "2026-09-01-x", title: "A defect filed from elsewhere" };

  it("tells the session to AUTHOR the plan when there is none", () => {
    const p = seedSpawnPrompt("absent", unit);
    expect(p).toContain("AUTHOR the plan");
    expect(p).toContain("There is NO plan document");
    // The originating incident in one assertion: the seeded prompt must not
    // send a session to implement a plan that does not exist.
    expect(p).not.toMatch(/implement/i);
  });

  it("tells the session to LOOK FIRST when absence is unproven", () => {
    const p = seedSpawnPrompt("unproven", unit);
    expect(p).toContain("UNKNOWN");
    expect(p).toContain("Look for the plan FIRST");
    // ...and still names authoring as the fallback, so an unfound plan ends
    // in a written one rather than in a report that it is missing.
    expect(p).toContain("AUTHOR it");
  });

  it("carries the slug, and the title only when there is one", () => {
    expect(seedSpawnPrompt("absent", unit)).toContain(
      "Work unit: 2026-09-01-x"
    );
    expect(seedSpawnPrompt("absent", unit)).toContain(
      "Title: A defect filed from elsewhere"
    );
    // No title is not an empty title: the line is omitted, never invented.
    expect(seedSpawnPrompt("absent", { slug: "2026-09-01-x" })).not.toContain(
      "Title:"
    );
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

/**
 * One answer on screen, several requests behind it.
 *
 * The corpus walk (`plans/planWalk.ts`) reads the list over several pages and
 * the proxy computes a block PER PAGE — the capture dial and the artifact
 * surface are read once per request, not once per walk — so the two features
 * meet here. What the fold must never do is let a page that could read the
 * dial speak for one that could not.
 */
describe("foldBodySignalBlocks", () => {
  const ok: PlanBodySignalBlock = {
    capture_level: "record",
    capture_resolved_scope: "tenant",
    capture_readable: true,
    artifact_surface_readable: true,
    org_plan_artifact_count: 1400,
    miss_reason: null,
  };

  it("no block at all is null — not a block of falses", () => {
    // A backend predating the signals says nothing, and an empty page has
    // nothing to explain. Neither is "capture is off".
    expect(foldBodySignalBlocks([])).toBeNull();
    expect(foldBodySignalBlocks([undefined, null])).toBeNull();
  });

  it("one block folds to itself, with no miss to scope", () => {
    expect(foldBodySignalBlocks([ok])).toEqual({ ...ok, miss_scope: null });
  });

  it("ANDs both readability flags", () => {
    const folded = foldBodySignalBlocks([
      ok,
      { ...ok, capture_readable: false },
      { ...ok, artifact_surface_readable: false },
    ]);
    expect(folded?.capture_readable).toBe(false);
    expect(folded?.artifact_surface_readable).toBe(false);
  });

  it("reports the FIRST arm any page hit", () => {
    const folded = foldBodySignalBlocks([
      ok,
      { ...ok, miss_reason: "capture_off" },
      { ...ok, miss_reason: "empty_corpus_for_org" },
    ]);
    expect(folded?.miss_reason).toBe("capture_off");
  });

  it("a value every page agreed on survives; a disagreement is UNKNOWN", () => {
    expect(foldBodySignalBlocks([ok, { ...ok }])?.capture_level).toBe("record");
    // Two measurements, two answers — so the walk has no one number to
    // report, and `null` is NOT MEASURED rather than a count of zero.
    const folded = foldBodySignalBlocks([
      ok,
      { ...ok, capture_level: "off", org_plan_artifact_count: 1401 },
    ]);
    expect(folded?.capture_level).toBeNull();
    expect(folded?.org_plan_artifact_count).toBeNull();
  });

  it("a stated zero is kept — it is a measurement", () => {
    const folded = foldBodySignalBlocks([
      { ...ok, org_plan_artifact_count: 0 },
      { ...ok, org_plan_artifact_count: 0 },
    ]);
    expect(folded?.org_plan_artifact_count).toBe(0);
  });

  /**
   * F1 of this change's review. A page's block cannot say how much of a READ
   * a miss covers, and the copy needs exactly that: a 4-page walk whose first
   * dial read landed while `plan_capture` was off, flipped to `record` before
   * page 2, settles `has_body` for every joinable row on pages 2-4 — so "this
   * read could not establish whether a document exists" is false about most of
   * the list.
   *
   * It was never exactly true of the one-request page this console used to be
   * either: `BodyKnowledge.has_body` returns `True` for a slug it matched
   * BEFORE it consults `miss_reason`, so a single page read with capture off
   * over a populated corpus settles every hit. Which is why the scope this
   * fold reports is only half the fix — see `hasBodyFilterTooltip`, whose two
   * arms both scope the claim to the rows a page could not match.
   */
  it("scopes a miss to every page or to some of them", () => {
    expect(foldBodySignalBlocks([ok])?.miss_scope).toBeNull();
    expect(
      foldBodySignalBlocks([{ ...ok, miss_reason: "capture_off" }])?.miss_scope
    ).toBe("all_pages");
    expect(
      foldBodySignalBlocks([
        { ...ok, miss_reason: "capture_off" },
        { ...ok, miss_reason: "capture_unreadable" },
      ])?.miss_scope
    ).toBe("all_pages");
    expect(
      foldBodySignalBlocks([{ ...ok, miss_reason: "capture_off" }, ok, ok])
        ?.miss_scope
    ).toBe("some_pages");
    // A page that stated NO block was not asked (an empty page, or a backend
    // predating the signals), so it neither hit the miss nor cleared it — the
    // same rule every other field in the fold already follows.
    expect(
      foldBodySignalBlocks([{ ...ok, miss_reason: "capture_off" }, null])
        ?.miss_scope
    ).toBe("all_pages");
  });
});

/**
 * The tooltip over the `document` chip strip — F1 and F3 of this change's
 * review. It states the claim at the strength the fold supports, and it never
 * shows an operator a wire enum.
 */
describe("hasBodyFilterTooltip", () => {
  const ok = {
    capture_level: "record",
    capture_resolved_scope: "tenant",
    capture_readable: true,
    artifact_surface_readable: true,
    org_plan_artifact_count: 1400,
    miss_reason: null,
    miss_scope: null,
  } as const;

  it("says what the filter IS when no page missed", () => {
    expect(hasBodyFilterTooltip(null)).toBe(
      "Whether a plan artifact exists for this work unit."
    );
    expect(hasBodyFilterTooltip(ok)).toBe(
      "Whether a plan artifact exists for this work unit."
    );
  });

  it("claims the whole read only when every page missed", () => {
    const all = hasBodyFilterTooltip({
      ...ok,
      miss_reason: "capture_off",
      miss_scope: "all_pages",
    });
    expect(all).toContain(
      "This read could not establish whether a document exists for the rows " +
        "it could not match to one"
    );
    expect(all).not.toContain("Some pages");
  });

  it("qualifies the claim when only some pages missed", () => {
    const some = hasBodyFilterTooltip({
      ...ok,
      miss_reason: "capture_off",
      miss_scope: "some_pages",
    });
    expect(some).toContain(
      "Some pages of this read could not establish whether a document exists " +
        "for the rows they could not match to one"
    );
  });

  /**
   * F1 of round 5. The `some_pages` arm carried "(the rest of the rows were
   * settled)", which is a POSITIVE claim no page-level block supports: a page
   * whose `miss_reason` is null can still carry a row that answered UNKNOWN
   * with the per-row reason `unjoinable_row` (a missing or empty slug), and
   * `_miss_reason` cannot produce that value, so it never reaches the fold.
   * Neither arm may characterise the rows a page DID settle.
   */
  it("never claims the pages that did not miss settled their rows", () => {
    for (const miss_scope of ["all_pages", "some_pages"] as const) {
      const shown = hasBodyFilterTooltip({
        ...ok,
        miss_reason: "capture_off",
        miss_scope,
      });
      expect(shown).not.toContain("the rest of the rows were settled");
      expect(shown).not.toContain("settled");
    }
  });

  it("renders the reason as a sentence, never as the wire enum", () => {
    const shown = hasBodyFilterTooltip({
      ...ok,
      miss_reason: "capture_never_configured",
      miss_scope: "all_pages",
    });
    expect(shown).toContain("no plan_capture policy row has ever been written");
    expect(shown).not.toContain("capture_never_configured");
  });

  it("drops the clause for a reason this build has no sentence for", () => {
    // A backend arm added after this build. The scope sentence still stands;
    // what must not happen is `undefined` or a bare enum reaching the operator.
    const shown = hasBodyFilterTooltip({
      ...ok,
      miss_reason: "a_reason_shipped_later" as never,
      miss_scope: "all_pages",
    });
    expect(shown).toBe(
      "This read could not establish whether a document exists for the rows " +
        "it could not match to one. Every miss is reported unknown rather " +
        "than as a missing document."
    );
    expect(shown).not.toContain("undefined");
  });
});
