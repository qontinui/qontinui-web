import { describe, it, expect } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import { STATUS_BADGE_CLASS } from "@/components/console/statusRow";
import {
  derivePlanStatus,
  describePlanStatus,
  planIdentity,
  planRest,
  PLAN_ATTENTION_BY_TONE,
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
    ]) {
      const tag = describePlanStatus(raw);
      expect(tag.recognised).toBe(true);
      expect(tag.label).not.toBe(raw);
    }
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

  it("never returns a blank identity for an unconventional slug", () => {
    expect(planIdentity("adhoc-cleanup")).toBe("adhoc-cleanup");
    expect(planIdentity("single")).toBe("single");
    expect(planRest("single")).toBe("single");
  });
});
