/**
 * pullDecisionStatus — the `/admin/coord/pull-decisions` derivation + R3 audit.
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3
 * Wave 2. Pure, no DOM; the palette agreement is asserted through the SHARED
 * `paletteDisagreements` rather than a private copy (style guide §4.2 clause 3).
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  PULL_ATTENTION_BY_VERDICT,
  PULL_AUTHOR_GLYPH_VERDICTS,
  PULL_VERDICT_CLASS,
  classifyVerdict,
  derivePullDecisionStatus,
  evidenceSummary,
  pullIdentity,
  timingLabel,
  type PullDecisionRow,
  type PullVerdictKind,
} from "./pullDecisionStatus";

const ALL_VERDICTS: PullVerdictKind[] = [
  "pull",
  "default_ref_sync",
  "hold",
  "up_to_date",
  "diverged",
  "unknown",
];

function row(overrides: Partial<PullDecisionRow> = {}): PullDecisionRow {
  return {
    resolution_id: "res-1",
    resolved_at: "2026-08-19T12:00:00Z",
    repo: "qontinui/qontinui-web",
    verdict: "pull",
    timing: "now",
    autonomy: "auto_decide",
    ...overrides,
  };
}

describe("PULL_ATTENTION_BY_VERDICT — the R3 audit table", () => {
  it("is total over the verdict union, with no extra entries", () => {
    expect(Object.keys(PULL_ATTENTION_BY_VERDICT).sort()).toEqual(
      [...ALL_VERDICTS].sort()
    );
    for (const v of ALL_VERDICTS) {
      expect(PULL_VERDICT_CLASS[v], `${v} has no badge class`).toBeTruthy();
    }
  });

  it("agrees with the palette — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(PULL_ATTENTION_BY_VERDICT, {
        badgeClass: PULL_VERDICT_CLASS,
        authorGlyphKinds: PULL_AUTHOR_GLYPH_VERDICTS,
      })
    ).toEqual([]);
  });

  it("reserves red for `diverged` — the one verdict nothing else clears", () => {
    // Pinned, not left to the palette test: `paletteDisagreements` proves the
    // hue matches the DECLARED attention and can never prove the declared
    // attention was right (§4.2 clause 4). These three are the calls a future
    // kind is most likely to copy wrongly.
    expect(PULL_ATTENTION_BY_VERDICT.diverged).toBe("author");
    // A hold names its own clearer (`hold_reason`) and lapses on its own.
    expect(PULL_ATTENTION_BY_VERDICT.hold).toBe("waiting");
    // `pull` is an instruction to the executor, not an ask of a human.
    expect(PULL_ATTENTION_BY_VERDICT.pull).toBe("none");
  });
});

describe("classifyVerdict", () => {
  it("recognises coord's wire vocabulary, case-insensitively", () => {
    expect(classifyVerdict("pull")).toBe("pull");
    expect(classifyVerdict("DIVERGED")).toBe("diverged");
    expect(classifyVerdict(" hold ")).toBe("hold");
  });

  it("degrades an unseen verdict to unknown rather than throwing", () => {
    expect(classifyVerdict("brand_new_verdict_2027")).toBe("unknown");
    expect(classifyVerdict(null)).toBe("unknown");
    expect(classifyVerdict("")).toBe("unknown");
  });

  it("does not classify a prototype key as a known verdict", () => {
    // The bug an `in` test would have shipped: `"constructor" in RECORD` is
    // true through the prototype chain, so the row would classify as known and
    // then index the palette with a key that has no class — an unstyled badge
    // built from a payload we do not control.
    expect(classifyVerdict("constructor")).toBe("unknown");
    expect(classifyVerdict("toString")).toBe("unknown");
  });
});

describe("derivePullDecisionStatus", () => {
  it("labels a known verdict in plain language, never the raw token", () => {
    const s = derivePullDecisionStatus(row({ verdict: "default_ref_sync" }));
    expect(s.label).toBe("Default ref sync");
    expect(s.attention).toBe("none");
  });

  it("shows an unrecognised verdict VERBATIM and floors it at amber", () => {
    const s = derivePullDecisionStatus(row({ verdict: "sideways_merge" }));
    expect(s.kind).toBe("unknown");
    expect(s.label).toBe("sideways_merge");
    expect(s.attention).toBe("waiting");
  });

  it("prefers the hold reason as the why — it is what clears the row", () => {
    const s = derivePullDecisionStatus(
      row({ verdict: "hold", hold_reason: "merge in flight", behind: 3 })
    );
    expect(s.reason).toBe("merge in flight");
  });

  it("falls back to the behind/ahead distance, then to the rationale", () => {
    expect(
      derivePullDecisionStatus(row({ behind: 3, ahead: 1 })).reason
    ).toBe("3 behind, 1 ahead");
    expect(
      derivePullDecisionStatus(row({ rationale: "coord says so" })).reason
    ).toBe("coord says so");
  });

  it("reports a zero-behind distance rather than dropping to the rationale", () => {
    // `behind: 0` is a MEASUREMENT — "we looked, you are level" — and a
    // falsy-check would silently swallow it and show the rationale instead.
    expect(
      derivePullDecisionStatus(row({ behind: 0, rationale: "r" })).reason
    ).toBe("0 behind");
  });

  it("leaves the reason undefined when coord recorded nothing", () => {
    expect(derivePullDecisionStatus(row({})).reason).toBeUndefined();
  });
});

describe("timingLabel / pullIdentity / evidenceSummary", () => {
  it("renders the timing verdict, with its defer reason when there is one", () => {
    expect(timingLabel(row({ timing: "now" }))).toBe("Now");
    expect(timingLabel(row({ timing: "defer" }))).toBe("Defer");
    expect(
      timingLabel(row({ timing: "defer", defer_reason: "ci running" }))
    ).toBe("Defer (ci running)");
    expect(timingLabel(row({ timing: null }))).toBeNull();
  });

  it("identifies the row by the repo's short name, never by the device UUID", () => {
    expect(pullIdentity("qontinui/qontinui-web")).toBe("qontinui-web");
    expect(pullIdentity("bare-name")).toBe("bare-name");
    // A trailing slash is not a name — show the string whole rather than "".
    expect(pullIdentity("qontinui/")).toBe("qontinui/");
    expect(pullIdentity(null)).toBe("—");
  });

  it("summarises only the evidence keys it recognises, and stays silent otherwise", () => {
    expect(evidenceSummary({ posture: "cautious", rate: 0.8 })).toBe(
      "posture: cautious · rate: 0.8"
    );
    expect(evidenceSummary({ something_else: 1 })).toBeNull();
    expect(evidenceSummary(null)).toBeNull();
  });
});
