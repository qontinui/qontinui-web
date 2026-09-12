import { describe, it, expect } from "vitest";
import {
  canApplyMerge,
  clauseText,
  mergeSummary,
  resultingSide,
  unresolvedConflicts,
} from "./clauseMerge";
import type {
  ClauseMergeEntry,
  ClauseMergePreview,
  MergeClauseSide,
} from "../types";

function side(
  action: string,
  extra: Partial<MergeClauseSide> = {}
): MergeClauseSide {
  return {
    clause_id: "scope",
    category: "testing",
    status: "active",
    tier: null,
    trigger: null,
    action,
    bounds: null,
    escalate_if: null,
    anti_triggers: [],
    depends_on: [],
    links: [],
    ...extra,
  };
}

function entry(
  clause: string,
  decision: ClauseMergeEntry["decision"],
  sides: Pick<ClauseMergeEntry, "base" | "local" | "upstream"> = {}
): ClauseMergeEntry {
  return {
    clause,
    decision,
    requires_choice: decision === "conflict",
    ...(decision === "conflict" ? { conflict_reason: "both_edited" } : {}),
    ...sides,
  };
}

function preview(
  entries: ClauseMergeEntry[],
  overrides: Partial<Extract<ClauseMergePreview, { mode: "clauses" }>> = {}
): ClauseMergePreview {
  return {
    mode: "clauses",
    kind: "policy",
    name: "testing",
    current_version: 4,
    tracked_publication_version: 2,
    publication_version: 3,
    publication_release_note: null,
    base_source: "tracked_publication",
    base_publication_version: 2,
    base_known: true,
    entries,
    conflicts: entries
      .filter((e) => e.decision === "conflict")
      .map((e) => e.clause),
    noop: entries.every((e) => e.decision === "unchanged"),
    ...overrides,
  };
}

describe("clauseText", () => {
  it("renders the fields in coord's compiled order and skips absent ones", () => {
    expect(
      clauseText(
        side("do the thing", {
          trigger: "when asked",
          anti_triggers: ["never on Friday"],
        })
      )
    ).toBe(
      [
        "- **category:** testing",
        "- **status:** active",
        "- **trigger:** when asked",
        "- **action:** do the thing",
        "- **anti_triggers:**",
        "  - never on Friday",
      ].join("\n")
    );
  });

  it("renders an absent side as empty, so a removal diffs as a pure deletion", () => {
    expect(clauseText(undefined)).toBe("");
  });
});

describe("resultingSide", () => {
  const local = side("ours");
  const upstream = side("theirs");

  it("follows the plan for every decided arm", () => {
    expect(
      resultingSide(
        entry("a", "take_upstream_edit", { local, upstream }),
        undefined
      )
    ).toBe(upstream);
    expect(
      resultingSide(
        entry("a", "keep_local_edit", { local, upstream }),
        undefined
      )
    ).toBe(local);
    expect(
      resultingSide(entry("a", "take_upstream_removal", { local }), undefined)
    ).toBeUndefined();
    expect(
      resultingSide(entry("a", "keep_local_removal", { upstream }), undefined)
    ).toBeUndefined();
  });

  it("previews a conflict as NOTHING until a side is chosen — no default arm", () => {
    const e = entry("a", "conflict", { local, upstream });
    expect(resultingSide(e, undefined)).toBeUndefined();
    expect(resultingSide(e, "local")).toBe(local);
    expect(resultingSide(e, "upstream")).toBe(upstream);
  });
});

describe("the apply gate", () => {
  const local = side("ours");
  const upstream = side("theirs");

  it("withholds apply while any conflict is unchosen, and names them", () => {
    const p = preview([
      entry("a", "take_upstream_edit", { local, upstream }),
      entry("b", "conflict", { local, upstream }),
      entry("c", "conflict", { local, upstream }),
    ]);
    expect(unresolvedConflicts(p, {})).toEqual(["b", "c"]);
    expect(canApplyMerge(p, {})).toBe(false);
    expect(canApplyMerge(p, { b: "local" })).toBe(false);
    expect(unresolvedConflicts(p, { b: "local", c: "upstream" })).toEqual([]);
    expect(canApplyMerge(p, { b: "local", c: "upstream" })).toBe(true);
  });

  it("withholds apply for a no-op plan and for the whole-body fallback", () => {
    expect(
      canApplyMerge(preview([entry("a", "unchanged", { local, upstream })]), {})
    ).toBe(false);
    const wholeBody: ClauseMergePreview = {
      mode: "whole_body",
      kind: "policy",
      name: "testing",
      current_version: 4,
      tracked_publication_version: null,
      publication_version: 3,
      publication_release_note: null,
      base_source: "unknown",
      fallback: { reason: "local_not_clause_structured" },
    };
    expect(canApplyMerge(wholeBody, {})).toBe(false);
    expect(unresolvedConflicts(wholeBody, {})).toEqual([]);
    expect(canApplyMerge(null, {})).toBe(false);
  });

  it("counts each decision into the header buckets", () => {
    expect(
      mergeSummary(
        preview([
          entry("a", "unchanged", { local, upstream }),
          entry("b", "take_upstream_edit", { local, upstream }),
          entry("c", "take_upstream_removal", { local }),
          entry("d", "keep_local_addition", { local }),
          entry("e", "conflict", { local, upstream }),
        ])
      )
    ).toEqual({
      unchanged: 1,
      takingUpstream: 2,
      keepingLocal: 1,
      conflicts: 1,
    });
  });
});
