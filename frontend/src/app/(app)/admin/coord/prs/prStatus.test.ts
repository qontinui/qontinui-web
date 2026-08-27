/**
 * R3's audit for the `/admin/coord/prs` blocking-reason palette, plus the
 * judgements `paletteDisagreements` cannot make (style guide §4.2 clause 4).
 *
 * Two judgements are pinned here because both were WRONG in the inline
 * `MERGE_STATUS_TONE` map this replaces, and both are invisible to the palette
 * audit — it proves the hue matches the DECLARED attention, never that the
 * declared attention was right:
 *
 * 1. **Alignment with `prPipeline`.** `/fleet` and `/prs` are two vocabularies
 *    over one domain. Where they name the same condition they must give the
 *    same answer, so the counterpart readings are asserted against
 *    `ATTENTION_BY_KIND` itself rather than copied into a comment.
 * 2. **`unknown` is the ignorance floor.** It was muted (calm), which asserts
 *    "nothing is wrong here" about the one row where that is exactly what we
 *    do not know.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import { ATTENTION_BY_KIND } from "@/components/operations/prPipeline";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import type { PrMergeStatus } from "@/services/admin-dev-service";
import {
  derivePrStatus,
  mergeStatusLabel,
  PR_ATTENTION_BY_MERGE_STATUS,
  PR_AUTHOR_GLYPH_STATUSES,
  PR_MERGE_STATUS_CLASS,
  PR_STATUS_PALETTE,
} from "./prStatus";

const ALL = Object.keys(PR_ATTENTION_BY_MERGE_STATUS) as PrMergeStatus[];

describe("PR blocking-reason palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(PR_ATTENTION_BY_MERGE_STATUS, {
        badgeClass: PR_MERGE_STATUS_CLASS,
        authorGlyphKinds: PR_AUTHOR_GLYPH_STATUSES,
      })
    ).toEqual([]);
  });

  it("is total over coord's merge_status union in both directions", () => {
    for (const k of ALL) expect(PR_MERGE_STATUS_CLASS[k]).toBeTruthy();
    expect(Object.keys(PR_MERGE_STATUS_CLASS).sort()).toEqual([...ALL].sort());
  });

  it("carries the ✓ only on the one finished state", () => {
    expect([...(PR_STATUS_PALETTE.doneGlyphKinds ?? [])]).toEqual(["ready"]);
  });
});

describe("alignment with prPipeline — same condition, same reading", () => {
  // `/fleet` and `/prs` name the same domain in two vocabularies. A row that
  // disagrees is a row where an operator gets two different answers about
  // whose move it is, depending which tab they opened.
  const COUNTERPART: ReadonlyArray<[PrMergeStatus, keyof typeof ATTENTION_BY_KIND]> = [
    ["ready", "ready"],
    ["queued", "queued"],
    ["ci-pending", "checks-pending"],
    ["draft", "draft"],
    ["behind-base", "needs-rebase"],
    ["conflicts", "conflict"],
    ["ci-failed", "checks-failing"],
    ["review-required", "requirements"],
    ["blast-radius-block", "requirements"],
    ["repo-unreachable", "not-mergeable"],
    ["ready-but-unlanded", "conflict-stranded"],
  ];

  for (const [mergeStatus, kind] of COUNTERPART) {
    it(`${mergeStatus} reads the same as prPipeline's ${kind}`, () => {
      expect(PR_ATTENTION_BY_MERGE_STATUS[mergeStatus]).toBe(
        ATTENTION_BY_KIND[kind]
      );
    });
  }

  it("keeps the three cases the ORIGINAL colour bug got wrong", () => {
    // The style guide's opening incident, in this vocabulary.
    expect(PR_ATTENTION_BY_MERGE_STATUS["ci-pending"]).toBe("none");
    expect(/\bbg-red-/.test(PR_MERGE_STATUS_CLASS["ci-pending"])).toBe(false);
    expect(PR_ATTENTION_BY_MERGE_STATUS["ci-failed"]).toBe("author");
    expect(/\bbg-red-/.test(PR_MERGE_STATUS_CLASS["ci-failed"])).toBe(true);
  });
});

describe("the readings the palette audit cannot make", () => {
  it("floors `unknown` at amber, never calm", () => {
    // It was muted before this module existed. Calm on an unknown row asserts
    // "nothing is wrong here", which is precisely what we do not know.
    expect(PR_ATTENTION_BY_MERGE_STATUS.unknown).toBe("waiting");
    expect(PR_MERGE_STATUS_CLASS.unknown).toBe(UNKNOWN_AMBER);
  });

  it("keeps amber ONLY where something else clears the row", () => {
    // Both amber rows must be nameable: the merge train rebases a BEHIND PR,
    // and a dispatched specialist review returns a verdict.
    const amber = ALL.filter(
      (k) => PR_ATTENTION_BY_MERGE_STATUS[k] === "waiting"
    ).sort();
    expect(amber).toEqual(
      ["awaiting-specialist-review", "behind-base", "unknown"].sort()
    );
  });

  it("grades required-checks-missing with ci-failed, not with behind-base", () => {
    // It reached `PrMergeStatus` after this module was written, so nothing but
    // this test pins WHICH sibling it copied. coord maps the code to the `ci`
    // dimension (`merge_verdict.rs`) and `trainActivity` grades it `blocking`
    // with `ci-failed` — not `behind-base` — named as its sibling. Amber would
    // promise a clearer that does not exist: coord reconciles
    // `required_checks_satisfied` at hydration, so a surviving `false` is a
    // genuine unmet requirement.
    expect(PR_ATTENTION_BY_MERGE_STATUS["required-checks-missing"]).toBe(
      "author"
    );
    expect(PR_ATTENTION_BY_MERGE_STATUS["required-checks-missing"]).toBe(
      PR_ATTENTION_BY_MERGE_STATUS["ci-failed"]
    );
    expect(PR_MERGE_STATUS_CLASS["required-checks-missing"]).toBe(
      PR_MERGE_STATUS_CLASS["ci-failed"]
    );
    expect(/bg-amber-/.test(PR_MERGE_STATUS_CLASS["required-checks-missing"])).toBe(
      false
    );
    expect(PR_AUTHOR_GLYPH_STATUSES.has("required-checks-missing")).toBe(true);
    // And the badge text stays human, not the raw enum.
    expect(mergeStatusLabel("required-checks-missing")).toBe(
      "required checks missing"
    );
  });

  it("promotes review-required and blast-radius-block to author-action", () => {
    // Both were amber. Neither has a clearer: nothing dispatches a reviewer
    // and nothing times out a blast-radius park.
    for (const k of ["review-required", "blast-radius-block"] as const) {
      expect(PR_ATTENTION_BY_MERGE_STATUS[k]).toBe("author");
      expect(/\bbg-amber-/.test(PR_MERGE_STATUS_CLASS[k])).toBe(false);
      expect(PR_AUTHOR_GLYPH_STATUSES.has(k)).toBe(true);
    }
  });
});

describe("derivePrStatus", () => {
  it("carries coord's blocking_summary as the row's reason", () => {
    const s = derivePrStatus({
      merge_status: "ci-failed",
      blocking_summary: "security check failed on 3 files",
    });
    expect(s.kind).toBe("ci-failed");
    expect(s.attention).toBe("author");
    expect(s.reason).toBe("security check failed on 3 files");
    expect(s.label).toBe("ci failed");
  });

  it("leaves the reason absent rather than inventing one", () => {
    expect(derivePrStatus({ merge_status: "ready" }).reason).toBeUndefined();
    expect(
      derivePrStatus({ merge_status: "ready", blocking_summary: "" }).reason
    ).toBeUndefined();
  });

  it("floors a merge_status this build has never seen at `unknown`", () => {
    const s = derivePrStatus({ merge_status: "some-new-coord-state" });
    expect(s.kind).toBe("unknown");
    expect(s.attention).toBe("waiting");
    // …but still prints coord's own word, never the bucket's.
    expect(s.label).toBe("some new coord state");
  });

  it("mergeStatusLabel never leaks a raw kebab enum", () => {
    expect(mergeStatusLabel("ready-but-unlanded")).toBe("ready but unlanded");
  });
});
