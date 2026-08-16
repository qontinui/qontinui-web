import { describe, it, expect } from "vitest";
import {
  describePlanStatus,
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
    // Kept in lockstep with MergePipeline.tsx's `merged:` entry on purpose —
    // a shipped plan should read exactly like a merged PR.
    expect(PLAN_TONE_CLASS.shipped).toBe(
      "bg-green-500/15 text-green-200 border-green-500/30"
    );
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
