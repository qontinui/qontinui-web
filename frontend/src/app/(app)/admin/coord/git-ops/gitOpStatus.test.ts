/**
 * R3's audit for the git-op feed palette, plus the judgement
 * `paletteDisagreements` cannot make (style guide §4.2 clause 4).
 *
 * The judgement here is that an ALL-CALM table is the right answer for a feed
 * of completed operations — and specifically that `reset` losing its red and
 * `merge`/`rebase` losing their amber is a fix, not a regression. Pinned so
 * the next person who thinks "a reset should surely be red" has to argue with
 * a failing test rather than with a comment.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  deriveGitOpStatus,
  GIT_OP_ATTENTION_BY_KIND,
  GIT_OP_AUTHOR_GLYPH_KINDS,
  GIT_OP_KIND_CLASS,
  isKnownGitOpKind,
  type GitOpKind,
} from "./gitOpStatus";

const ALL = Object.keys(GIT_OP_ATTENTION_BY_KIND) as GitOpKind[];

describe("git-op feed palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(GIT_OP_ATTENTION_BY_KIND, {
        badgeClass: GIT_OP_KIND_CLASS,
        authorGlyphKinds: GIT_OP_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("is total over the kind union in both directions", () => {
    for (const k of ALL) expect(GIT_OP_KIND_CLASS[k]).toBeTruthy();
    expect(Object.keys(GIT_OP_KIND_CLASS).sort()).toEqual([...ALL].sort());
  });

  it("spends NO red and NO amber — every row is a completed operation", () => {
    for (const k of ALL) {
      expect(GIT_OP_ATTENTION_BY_KIND[k]).toBe("none");
      expect(/\bbg-red-/.test(GIT_OP_KIND_CLASS[k])).toBe(false);
      expect(/\bbg-amber-/.test(GIT_OP_KIND_CLASS[k])).toBe(false);
    }
    expect(GIT_OP_AUTHOR_GLYPH_KINDS.size).toBe(0);
  });

  it("keeps `reset` calm — loud is not the same as actionable", () => {
    // The pre-migration palette painted this `destructive`. A reset that has
    // already happened is not the operator's move; the console cannot undo it.
    expect(GIT_OP_ATTENTION_BY_KIND.reset).toBe("none");
    expect(/\bbg-red-/.test(GIT_OP_KIND_CLASS.reset)).toBe(false);
  });

  it("keeps `merge` and `rebase` calm — amber would promise a pending resolution", () => {
    for (const k of ["merge", "rebase"] as const) {
      expect(GIT_OP_ATTENTION_BY_KIND[k]).toBe("none");
      expect(/\bbg-amber-/.test(GIT_OP_KIND_CLASS[k])).toBe(false);
    }
  });
});

describe("an op kind this build has never seen", () => {
  it("buckets its HUE at `other` but renders coord's own word", () => {
    const s = deriveGitOpStatus("cherry_pick");
    expect(s.kind).toBe("other");
    // The label is never bucketed — the operator reads what coord actually said.
    expect(s.label).toBe("cherry_pick");
  });

  it("is CALM, not the ignorance floor — we know it is a finished op", () => {
    // `attentionOf`'s "waiting" floor is about not knowing the row's STATE.
    // Here we know it: a recorded, terminal git operation. Amber would claim
    // something is pending when nothing is.
    expect(deriveGitOpStatus("cherry_pick").attention).toBe("none");
    expect(isKnownGitOpKind("cherry_pick")).toBe(false);
    expect(isKnownGitOpKind("push")).toBe(true);
  });

  it("passes a known kind through untouched", () => {
    const s = deriveGitOpStatus("branch_create");
    expect(s.kind).toBe("branch_create");
    expect(s.label).toBe("branch_create");
  });
});
