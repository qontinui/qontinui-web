import { describe, it, expect } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import { STATUS_BADGE_CLASS } from "@/components/console/statusRow";
import {
  derivePlanStatus,
  describePlanStatus,
  planIdentity,
  planIdentityTitle,
  planAuthoredAt,
  planRest,
  planRowTime,
  PLAN_ATTENTION_BY_TONE,
  PLAN_IDENTITY_ABSENT,
  PLAN_STATUS_PALETTE,
  PLAN_TONE_CLASS,
  type PlanStatusTone,
} from "./planStatus";

describe("describePlanStatus", () => {
  it("gives SHIPPED the merged-PR green, distinct from in-progress", () => {
    const shipped = describePlanStatus("shipped");
    const active = describePlanStatus("in_progress");

    expect(shipped.label).toBe("Shipped");
    expect(shipped.tone).toBe("shipped");
    expect(PLAN_TONE_CLASS[shipped.tone]).toContain("green");

    // The defect this replaces: the old statusVariant() mapped BOTH `shipped`
    // and `in_progress` to variant="default", so they rendered identically.
    expect(PLAN_TONE_CLASS[active.tone]).not.toBe(
      PLAN_TONE_CLASS[shipped.tone]
    );
  });

  it("uses the same green as the merge pipeline's merged tag", () => {
    // Asserted against the IMPORTED constant, not a copy of its value: a
    // hard-coded string here would stay green while the pipeline's green
    // moved, which is the one drift this test exists to catch.
    expect(PLAN_TONE_CLASS.shipped).toBe(STATUS_BADGE_CLASS.merged);
  });

  it("never renders a raw enum for a status it knows", () => {
    for (const raw of [
      "draft",
      "vetted",
      "vetted_unattested",
      "in_progress",
      "ready",
      "shipped",
      "blocked",
      "superseded",
      "obsolete",
      "partial",
      "partially",
    ]) {
      const tag = describePlanStatus(raw);
      expect(tag.recognised).toBe(true);
      expect(tag.label).not.toBe(raw);
    }
  });

  it("labels partial/partially as active, the same bucket as in_progress", () => {
    // Not a canonical plan-discipline word, but a real, recurring free-text
    // stamp coord accepts unconditionally under its Free-status rule — see
    // the KNOWN comment. Both spellings collapse to one label.
    const partial = describePlanStatus("partial");
    const partially = describePlanStatus("partially");
    expect(partial.label).toBe("Partial");
    expect(partially.label).toBe("Partial");
    expect(partial.tone).toBe("active");
    expect(partially.tone).toBe("active");
  });

  it("labels vetted_unattested as a normal state, not an error", () => {
    const tag = describePlanStatus("vetted_unattested");
    expect(tag.label).toBe("Vetted (unattested)");
    // Not the blocked/destructive tone — coord refusing a self-attestation is
    // routine, and painting it red would misreport a healthy plan.
    expect(tag.tone).toBe("pending");
    expect(tag.tone).not.toBe("blocked");
  });

  it("shows an UNRECOGNISED status verbatim under the unknown tone", () => {
    // work_units.status is opaque text: coord can return values this page has
    // never heard of, and guessing at them is the failure mode.
    const tag = describePlanStatus("awaiting_carrier_pigeon");
    expect(tag.recognised).toBe(false);
    expect(tag.label).toBe("awaiting_carrier_pigeon");
    expect(tag.tone).toBe("unknown");
    expect(tag.title).toContain("opaque");
  });

  it("treats an absent status as unknown, not draft", () => {
    for (const empty of [undefined, null, "", "   "]) {
      const tag = describePlanStatus(empty);
      expect(tag.recognised).toBe(false);
      expect(tag.tone).toBe("unknown");
      expect(tag.label).not.toBe("Draft");
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(describePlanStatus("  SHIPPED ").label).toBe("Shipped");
    expect(describePlanStatus("In_Progress").tone).toBe("active");
  });

  it("flags coord-derived statuses in the tooltip", () => {
    expect(describePlanStatus("shipped").title).toContain("derived");
    expect(describePlanStatus("ready").title).toContain("derived");
    expect(describePlanStatus("draft").title).not.toContain("derived");
  });

  it("has a class for every tone", () => {
    const tones: PlanStatusTone[] = [
      "shipped",
      "ready",
      "active",
      "pending",
      "blocked",
      "closed",
      "unknown",
    ];
    for (const t of tones) expect(PLAN_TONE_CLASS[t]).toBeTruthy();
  });
});

/**
 * R3's invariant for this surface, added by Phase 3 Wave 1.
 *
 * `paletteDisagreements` is the shared audit `console/attention.ts` exports —
 * the same one MergePipeline and the Alerts tab run. Auditing here rather than
 * eyeballing the table is the whole point: the tone map and the hue map are
 * two literals in one file and nothing but a test stops them drifting.
 */
describe("plans palette agrees with PLAN_ATTENTION_BY_TONE (R3)", () => {
  it("is red iff a human must act, amber iff we are waiting/unknown", () => {
    expect(
      paletteDisagreements(PLAN_ATTENTION_BY_TONE, PLAN_STATUS_PALETTE)
    ).toEqual([]);
  });

  it("has an attention for every tone (the table is TOTAL)", () => {
    for (const tone of Object.keys(PLAN_TONE_CLASS) as PlanStatusTone[]) {
      expect(PLAN_ATTENTION_BY_TONE[tone]).toBeTruthy();
    }
  });

  it("derives blocked as author-action and shipped as calm", () => {
    expect(derivePlanStatus({ status: "blocked" }).attention).toBe("author");
    expect(derivePlanStatus({ status: "shipped" }).attention).toBe("none");
    // An unrecognised status is UNKNOWN, not calm.
    expect(derivePlanStatus({ status: "weird_new_state" }).attention).toBe(
      "waiting"
    );
    expect(derivePlanStatus({}).attention).toBe("waiting");
  });

  it("keeps the plan's own words as the label, raw value included", () => {
    expect(derivePlanStatus({ status: "weird_new_state" }).label).toBe(
      "weird_new_state"
    );
    expect(derivePlanStatus({ status: "in_progress" }).label).toBe(
      "In progress"
    );
  });
});

describe("planIdentity / planRest", () => {
  it("splits the conventional date prefix off a plan slug", () => {
    expect(planIdentity("2026-08-16-coord-console-ui")).toBe("2026-08-16");
    expect(planRest("2026-08-16-coord-console-ui")).toBe("coord-console-ui");
  });

  it("prefers the slug's own prefix over authored_at, which derives from it", () => {
    // `authored_at_from_stem` reads the same characters, so the two cannot
    // legitimately disagree — and the slug arm is right even for a coord row
    // written before the column existed.
    expect(
      planIdentity("2026-08-16-coord-console-ui", "2020-01-01T00:00:00Z")
    ).toBe("2026-08-16");
  });

  it("falls back to coord's authored_at for an undated slug", () => {
    // The fix: 108 of the 149 undated slugs on `/plans` (measured against
    // coord 2026-09-13) carry a real authoring date, and this is how the chip
    // reaches it.
    expect(
      planIdentity(
        "coordinator-assign-task-dispatch-race",
        "2026-07-04T09:30:00Z"
      )
    ).toBe("2026-07-04");
    expect(planIdentity("qontinui-schemas-rust-codegen", "2026-02-19")).toBe(
      "2026-02-19"
    );
  });

  it("renders an em dash — NOT slug words — when no date is known at all", () => {
    // REVISED EXPECTATION. This case used to assert that an unconventional
    // slug still produced a non-blank identity from its own first two
    // hyphen-segments ("adhoc-cleanup", "single"). That was the defect: the
    // chip occupies the position operators read as the row's date, so the
    // fallback printed WORDS in a date column — `coordinator-assign`,
    // `qontinui-schemas` — and an operator reported exactly that. A slug with
    // no hyphen at all made it worse still: the chip and the label rendered
    // the identical string. An admitted blank beats a plausible wrong date;
    // "never blank" was the wrong property to protect.
    expect(planIdentity("adhoc-cleanup")).toBe(PLAN_IDENTITY_ABSENT);
    expect(planIdentity("single")).toBe(PLAN_IDENTITY_ABSENT);
    expect(planIdentity("plans to do")).toBe(PLAN_IDENTITY_ABSENT);
    // 41 of the 149 undated slugs have no authored_at either. An explicit
    // null/undefined is the same UNKNOWN, never a guess — and `created_at`
    // is not consulted as a third source: it is the INGEST date, shown in the
    // detail panel under the word "ingested" for exactly that reason.
    expect(planIdentity("adhoc-cleanup", null)).toBe(PLAN_IDENTITY_ABSENT);
    expect(planIdentity("adhoc-cleanup", "")).toBe(PLAN_IDENTITY_ABSENT);
  });

  it("rejects an authored_at that is date-SHAPED but not a real day", () => {
    expect(planIdentity("adhoc-cleanup", "2026-13-45T00:00:00Z")).toBe(
      PLAN_IDENTITY_ABSENT
    );
    expect(planIdentity("adhoc-cleanup", "not-a-date")).toBe(
      PLAN_IDENTITY_ABSENT
    );
  });

  it("rejects a slug prefix that is date-SHAPED but not a real day, like the runner does", () => {
    // Parity with the two writers of `authored_at`: the runner's
    // `authored_at_from_stem` (`NaiveDate::from_ymd_opt`) and the alembic
    // backfill both classify `2026-02-30-bogus` as UNDATED and store NULL.
    // The chip must not be the one consumer asserting "Authored 2026-02-30".
    expect(planIdentity("2026-02-30-bogus")).toBe(PLAN_IDENTITY_ABSENT);
    expect(planIdentity("2026-13-01-bogus")).toBe(PLAN_IDENTITY_ABSENT);
    // ...and with no valid prefix, coord's column is the next source.
    expect(planIdentity("2026-02-30-bogus", "2026-03-01T00:00:00Z")).toBe(
      "2026-03-01"
    );
    // The label keeps the whole slug: an invalid prefix is not stripped.
    expect(planRest("2026-02-30-bogus")).toBe("2026-02-30-bogus");
  });

  it("keeps the WHOLE slug when the identity is not a slug prefix", () => {
    // `planRest` strips only a prefix it can actually see in the slug, so an
    // authored_at-derived or absent identity removes nothing.
    expect(planRest("single")).toBe("single");
    expect(planRest("adhoc-cleanup")).toBe("adhoc-cleanup");
    expect(planRest("coordinator-assign-task-dispatch-race")).toBe(
      "coordinator-assign-task-dispatch-race"
    );
    expect(planRest("plans to do")).toBe("plans to do");
  });

  it("says WHERE the chip's date came from, or that there is none", () => {
    expect(planIdentityTitle("2026-08-16-coord-console-ui")).toMatch(
      /slug's date prefix/
    );
    expect(
      planIdentityTitle("qontinui-schemas-rust-codegen", "2026-02-19")
    ).toMatch(/work_units\.authored_at/);
    expect(planIdentityTitle("plans to do")).toMatch(
      /No authoring date recorded/
    );
  });
});

describe("planAuthoredAt", () => {
  // The ONE effective-authoring-date derivation the chip, the row time, the
  // detail dates, the `authored_*` sorts and the "undated" caveat all read.
  it("reads a dated slug as midnight UTC of that day", () => {
    expect(planAuthoredAt({ slug: "2026-08-16-coord-console-ui" })).toBe(
      "2026-08-16T00:00:00Z"
    );
  });

  it("prefers the slug prefix over the column, which derives from it", () => {
    // Measured 2026-09-13: 0 of 1,686 dated slugs disagree with their column
    // by DAY, so this never changes a day — it only guarantees the chip and
    // the row agree by construction. The column carries a time of day here so
    // the assertion can tell the two arms apart: slug-first yields midnight,
    // column-first would yield 09:30.
    expect(
      planAuthoredAt({
        slug: "2026-08-16-coord-console-ui",
        authored_at: "2026-08-16T09:30:00Z",
      })
    ).toBe("2026-08-16T00:00:00Z");
  });

  it("accepts a year below 100, as both writers do", () => {
    // `Date.UTC` maps 0–99 onto 1900–1999; the round-trip must not use it.
    expect(planAuthoredAt({ slug: "0050-06-15-antique" })).toBe(
      "0050-06-15T00:00:00Z"
    );
  });

  it("dates a slug whose coord column is NULL — the MCP-created-unit case", () => {
    // 29 dated slugs on 2026-09-13, every one created since 2026-09-10 through
    // `coord_work_unit_upsert` by a caller that omitted `authored_at`. Their
    // chip showed the date; their row said "Ingested"; the default sort sank
    // the newest plans in the corpus to the bottom. This is the arm that fixes
    // all three at once.
    expect(
      planAuthoredAt({
        slug: "2026-09-12-read-surface-tsv-drops-keys-and-the-sweep-livelocks",
        authored_at: null,
      })
    ).toBe("2026-09-12T00:00:00Z");
  });

  it("returns coord's column VERBATIM for an undated slug, keeping its time of day", () => {
    expect(
      planAuthoredAt({
        slug: "coordinator-assign-task-dispatch-race",
        authored_at: "2026-07-04T09:30:00Z",
      })
    ).toBe("2026-07-04T09:30:00Z");
  });

  it("is null when neither source is a real date, and never reads created_at", () => {
    expect(planAuthoredAt({ slug: "plans to do" })).toBeNull();
    expect(
      planAuthoredAt({ slug: "adhoc-cleanup", authored_at: null })
    ).toBeNull();
    expect(
      planAuthoredAt({
        slug: "adhoc-cleanup",
        authored_at: "2026-13-45T00:00:00Z",
      })
    ).toBeNull();
    expect(planAuthoredAt({ slug: "2026-02-30-bogus" })).toBeNull();
    expect(
      planAuthoredAt({
        slug: "adhoc-cleanup",
        authored_at: null,
        created_at: "2026-06-28T00:00:00Z",
      } as Parameters<typeof planAuthoredAt>[0])
    ).toBeNull();
  });
});

describe("planRowTime", () => {
  // Plan 2026-09-02-coord-work-units-carry-no-authoring-date: the row's time
  // is shipped → authored → ingested, and `updated_at` — a scanner touch every
  // ~68 s — is never a candidate. Each fixture sets `updated_at` to the NEWEST
  // instant so a chain that still consulted it would be caught. Slugs are
  // UNDATED unless the case is about the slug arm, so the column is the only
  // authoring source in play.
  const updated_at = "2026-09-02T12:00:00Z";

  it("reports the first shipped transition over everything else", () => {
    expect(
      planRowTime({
        slug: "p-1",
        first_shipped_at: "2026-08-01T00:00:00Z",
        authored_at: "2026-05-01T00:00:00Z",
        created_at: "2026-06-28T00:00:00Z",
        updated_at,
      })
    ).toEqual({ at: "2026-08-01T00:00:00Z", verb: "Shipped" });
  });

  it("reports the authoring date for an unshipped plan", () => {
    expect(
      planRowTime({
        slug: "p-2",
        authored_at: "2026-05-01T00:00:00Z",
        created_at: "2026-06-28T00:00:00Z",
        updated_at,
      })
    ).toEqual({ at: "2026-05-01T00:00:00Z", verb: "Authored" });
  });

  it("reports the SLUG's date as authored when coord's column is NULL", () => {
    // The chip already shows `2026-09-12` for this row; the time cell must not
    // say "Ingested <a later date>" beside it.
    expect(
      planRowTime({
        slug: "2026-09-12-p-3",
        authored_at: null,
        created_at: "2026-09-13T10:00:00Z",
        updated_at,
      })
    ).toEqual({ at: "2026-09-12T00:00:00Z", verb: "Authored" });
  });

  it("falls back to the INGEST date under its own name, never as 'Authored' or 'Created'", () => {
    expect(
      planRowTime({
        slug: "p-4",
        created_at: "2026-06-28T00:00:00Z",
        updated_at,
      })
    ).toEqual({ at: "2026-06-28T00:00:00Z", verb: "Ingested" });
  });

  it("reports NO time rather than the scanner touch when nothing else is recorded", () => {
    expect(planRowTime({ slug: "p-5", updated_at }).at).toBeNull();
    expect(planRowTime({ slug: "p-6" }).at).toBeNull();
  });
});
