/**
 * questionStatus — the pure derivation behind both lists on
 * `/admin/coord/questions`.
 *
 * Added by plan `2026-08-16-coord-console-ui-unification-pipeline-style.md`
 * Phase 3 Wave 1, alongside the migration of the route onto
 * `components/console`. Modelled on `alertStatus.test.ts` (since retired with the alerts page): no DOM, and the R3
 * palette invariant is asserted with the SHARED audit rather than eyeballed.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  ALL_QUESTION_KINDS,
  ALL_QUESTION_KINDS_IS_TOTAL,
  QUESTION_ATTENTION_BY_KIND,
  QUESTION_BADGE_CLASS,
  QUESTION_STATUS_PALETTE,
  QUESTION_TERMINAL_KINDS,
  deriveGapStatus,
  deriveQuestionStatus,
  formatRelative,
  optionLabels,
  questionIdentity,
  truncate,
  type AgentQuestionRow,
} from "./questionStatus";

const AGENT = "01a01de1-9d08-7c31-a055-271ad6df6217";

function q(overrides: Partial<AgentQuestionRow> = {}): AgentQuestionRow {
  return {
    question_id: "00000000-0000-0000-0000-deadbeef0001",
    agent_id: AGENT,
    question: "Should I bump the dependency or pin it?",
    created_at: "2026-08-20T09:00:00Z",
    ...overrides,
  };
}

describe("questions palette agrees with QUESTION_ATTENTION_BY_KIND (R3)", () => {
  it("is red iff a human must act, amber iff it will wait", () => {
    expect(
      paletteDisagreements(QUESTION_ATTENTION_BY_KIND, QUESTION_STATUS_PALETTE)
    ).toEqual([]);
  });

  it("covers the whole union — every kind has a class and an attention", () => {
    // What this pins, and what pins the pin.
    //
    // `QUESTION_BADGE_CLASS` and `QUESTION_ATTENTION_BY_KIND` are declared
    // `Record<QuestionKind, …>`, so `tsc` already enforces their totality at
    // the declaration — the same is true of the module-private
    // `LABEL_BY_KIND`, and its being module-private changes nothing about
    // that. What no `Record` enforces is that a table has no EXTRA key left
    // behind by a kind's removal, and what no `Record` reaches at all is the
    // `Set`-typed glyph membership in the next test. Both are checked here
    // against one enumeration of the union.
    //
    // That enumeration, `ALL_QUESTION_KINDS`, is itself pinned TOTAL — but in
    // `questionStatus.ts`, not here, and the placement is load-bearing. This
    // repo type-checks no test file: `tsconfig.json` `exclude` lists
    // `**/*.test.ts`, `tsconfig.typecheck.json` overrides only `paths`, and
    // `npm run type-check` is the only typecheck CI runs. vitest transforms
    // with esbuild and does not typecheck either. A type-level pin written in
    // THIS file would therefore fail nothing, anywhere — the hazard it is
    // meant to close, one layer out. See `ALL_QUESTION_KINDS_IS_TOTAL`.
    //
    // The line below is NOT a check, and must not be read as one: the
    // declaration is literally `= true`, so at runtime this cannot fail. When
    // the pin trips it is a COMPILE error in `questionStatus.ts` and this file
    // never runs at all. Its one real function is to IMPORT the symbol —
    // `ALL_QUESTION_KINDS_IS_TOTAL` has no other consumer, so without a
    // reference here it reads as dead code and is deleted by the next tidy-up,
    // silently removing the pin. It is a usage anchor wearing an assertion's
    // clothes.
    expect(ALL_QUESTION_KINDS_IS_TOTAL).toBe(true);
    expect(new Set(Object.keys(QUESTION_BADGE_CLASS))).toEqual(
      new Set(ALL_QUESTION_KINDS)
    );
    expect(new Set(Object.keys(QUESTION_ATTENTION_BY_KIND))).toEqual(
      new Set(ALL_QUESTION_KINDS)
    );
    // Every kind's LABEL, through the two public derivations — the tables'
    // stated motivation, which this test used to claim and never check.
    // Between them they produce all five kinds.
    expect(deriveQuestionStatus(q()).label).toBe("pending");
    expect(
      deriveQuestionStatus(q({ responded_at: "2026-08-20T10:00:00Z" })).label
    ).toBe("answered");
    expect(
      deriveQuestionStatus(q({ withdrawn_at: "2026-09-20T09:10:00Z" })).label
    ).toBe("withdrawn");
    expect(deriveGapStatus(q()).label).toBe("blocking gap");
    expect(
      deriveGapStatus({ responded_at: "2026-08-20T10:00:00Z" }).label
    ).toBe("pre-answered gap");
  });

  it("puts the ✓ on `answered` ALONE — a withdrawal is not a resolution", () => {
    // `doneGlyphKinds` is under no structural audit: `AuditablePalette`
    // declares only `badgeClass` and `authorGlyphKinds`, so
    // `paletteDisagreements` cannot see it, `consoleSurfaces.ts` builds this
    // surface's entry from those two, and `tsc` enforces no coverage over a
    // `Set`. Pinned by equality here, as `prs/prStatus.test.ts` and
    // `gates/continuationStatus.test.ts` already pin theirs.
    expect([...(QUESTION_STATUS_PALETTE.doneGlyphKinds ?? [])].sort()).toEqual([
      "answered",
    ]);
    // The specific mistake this replaces: `withdrawn` carried the ✓, so the
    // badge read "✓ withdrawn". ✓ says RESOLVED, which is the exact reading
    // the muted `QUESTION_BADGE_CLASS.withdrawn` was chosen to avoid — nobody
    // decided anything, the question's premise died.
    expect(QUESTION_STATUS_PALETTE.doneGlyphKinds?.has("withdrawn")).toBe(
      false
    );
    // And it is not the author ✕ either: nobody must act on a withdrawn row.
    expect(QUESTION_STATUS_PALETTE.authorGlyphKinds.has("withdrawn")).toBe(
      false
    );
  });

  it("calls exactly `answered` and `withdrawn` TERMINAL", () => {
    // Same reason `doneGlyphKinds` is pinned by equality right above: `tsc`
    // enforces no coverage over a `Set`, and `QUESTION_TERMINAL_KINDS` is
    // outside `AuditablePalette` entirely, so `paletteDisagreements` cannot
    // see it either. Sorted equality is what makes a sixth kind's terminality
    // a DECISION someone records here rather than an omission nothing reports.
    expect([...QUESTION_TERMINAL_KINDS].sort()).toEqual([
      "answered",
      "withdrawn",
    ]);
    // Terminal means "no decision is owed and nobody is waiting" — which is a
    // claim about the LIFECYCLE, not about the hue. Both gap kinds are
    // non-terminal and for different reasons: a blocking gap has an agent
    // stopped on it, and a pre-answered one still owes a human the accept-or-
    // dismiss review of the clause coord applied inline. `gap-handled` is the
    // trap, because it is calm AND carries a `responded_at`.
    expect(QUESTION_TERMINAL_KINDS.has("pending")).toBe(false);
    expect(QUESTION_TERMINAL_KINDS.has("gap-blocking")).toBe(false);
    expect(QUESTION_TERMINAL_KINDS.has("gap-handled")).toBe(false);
    // The terminal set is not the ✓ set, and conflating them is how `withdrawn`
    // got a success glyph in the first place: it is terminal, and it resolved
    // nothing.
    expect(QUESTION_TERMINAL_KINDS.has("withdrawn")).toBe(true);
    expect(QUESTION_STATUS_PALETTE.doneGlyphKinds?.has("withdrawn")).toBe(
      false
    );
    // Every terminal kind is attention `none`, and no kind a human must act on
    // is terminal — the property both consumers actually rely on when they
    // suppress the composer.
    for (const kind of QUESTION_TERMINAL_KINDS) {
      expect(QUESTION_ATTENTION_BY_KIND[kind]).toBe("none");
    }
  });
});

describe("deriveQuestionStatus", () => {
  it("makes an UNANSWERED question author-action — nothing else clears it", () => {
    const s = deriveQuestionStatus(q());
    expect(s.kind).toBe("pending");
    expect(s.attention).toBe("author");
  });

  it("names the phase an agent is blocked at, when coord recorded one", () => {
    expect(deriveQuestionStatus(q({ plan_phase: "Phase 3" })).reason).toBe(
      "blocked at Phase 3"
    );
  });

  it("goes calm once answered, and quotes the answer as the reason", () => {
    const s = deriveQuestionStatus(
      q({ responded_at: "2026-08-20T10:00:00Z", response: "pin it" })
    );
    expect(s.kind).toBe("answered");
    expect(s.attention).toBe("none");
    expect(s.reason).toBe("pin it");
  });

  it("does not claim an answer text that coord did not record", () => {
    expect(
      deriveQuestionStatus(q({ responded_at: "2026-08-20T10:00:00Z" })).reason
    ).toBe("answered, no text recorded");
  });

  describe("withdrawn — the premise died, so nobody is waiting", () => {
    it("is a THIRD state, calm, and quotes the withdrawal reason", () => {
      // The defect plan
      // `2026-09-20-a-pending-operator-question-outlives-the-condition-that-motivated-it`
      // closes: `withdrawn_at` is set while `responded_at` stays NULL, which
      // the old two-valued derivation rendered in the PENDING list, red, as
      // "an agent is waiting on this".
      const s = deriveQuestionStatus(
        q({
          withdrawn_at: "2026-09-20T09:10:00Z",
          withdrawal_reason: "qontinui-web#1393 landed at 08:54Z",
        })
      );
      expect(s.kind).toBe("withdrawn");
      expect(s.label).toBe("withdrawn");
      expect(s.reason).toBe("qontinui-web#1393 landed at 08:54Z");
      expect(s.attention).toBe("none");
    });

    it("contributes NO operator attention — the point of the plan", () => {
      expect(QUESTION_ATTENTION_BY_KIND.withdrawn).toBe("none");
      // Muted, never red (nobody must act) and never amber (nothing will
      // clear it — it is already terminal).
      expect(QUESTION_BADGE_CLASS.withdrawn).not.toMatch(/bg-red-/);
      expect(QUESTION_BADGE_CLASS.withdrawn).not.toMatch(/bg-amber-/);
      // Nor the green `answered` finish: a retirement is not a decision.
      expect(QUESTION_BADGE_CLASS.withdrawn).not.toBe(
        QUESTION_BADGE_CLASS.answered
      );
    });

    it("does not claim a reason that coord did not record", () => {
      expect(
        deriveQuestionStatus(q({ withdrawn_at: "2026-09-20T09:10:00Z" })).reason
      ).toBe("withdrawn, no reason recorded");
    });

    it("wins over responded_at if a row somehow carries both", () => {
      // Defensive only — coord's two doors will refuse each other's terminal
      // state once the sibling PR ships them.
      // The honest render of a doubly-stamped row is the one that says nobody
      // is waiting AND can explain itself from the withdrawal record.
      const s = deriveQuestionStatus(
        q({
          withdrawn_at: "2026-09-20T09:10:00Z",
          withdrawal_reason: "the gate cleared on its own",
          responded_at: "2026-09-20T09:00:00Z",
          response: "go ahead",
        })
      );
      expect(s.kind).toBe("withdrawn");
      expect(s.reason).toBe("the gate cleared on its own");
    });

    it("leaves a row with no withdrawn_at exactly as it was", () => {
      expect(deriveQuestionStatus(q({ withdrawn_at: null })).kind).toBe(
        "pending"
      );
      expect(
        deriveQuestionStatus(
          q({ withdrawn_at: null, responded_at: "2026-08-20T10:00:00Z" })
        ).kind
      ).toBe("answered");
    });
  });
});

describe("deriveGapStatus", () => {
  it("is author-action while the gap is still blocking", () => {
    const s = deriveGapStatus(q(), "escalation-bar");
    expect(s.kind).toBe("gap-blocking");
    expect(s.attention).toBe("author");
    expect(s.reason).toContain("escalation-bar");
  });

  it("is CALM once pre-answered — and specifically NOT amber", () => {
    // Ruling 2 of the Wave-1 review, and the worked example behind the style
    // guide's R3 "third case". A non-blocking gap arrives pre-answered because
    // coord applied the category default: nobody is stopped and nothing is
    // lost, so it is not red — but nothing CLEARS an unreviewed clause either,
    // and amber's contract is that the row clears itself. Calm, with the ask
    // stated in `<GapRow>`'s detail instead of in the hue.
    const s = deriveGapStatus({ responded_at: "2026-08-20T10:00:00Z" });
    expect(s.kind).toBe("gap-handled");
    expect(s.attention).toBe("none");
    // The ask must survive somewhere the operator can read it.
    expect(s.reason).toMatch(/owed a review/);
    // Guard the specific mistake: never the amber family.
    expect(QUESTION_BADGE_CLASS["gap-handled"]).not.toMatch(/bg-amber-/);
    expect(QUESTION_BADGE_CLASS["gap-handled"]).not.toMatch(/bg-red-/);
  });
});

describe("presentation helpers", () => {
  it("shortens the agent id without inventing one", () => {
    expect(questionIdentity(q())).toBe("01a01de1");
    expect(questionIdentity(q({ agent_id: null }))).toBe("(unknown)");
  });

  it("normalises both coord `options` shapes", () => {
    expect(optionLabels(q({ options: ["bump", "pin"] }))).toEqual([
      "bump",
      "pin",
    ]);
    expect(
      optionLabels(q({ options: [{ value: "bump", label: "Bump it" }] }))
    ).toEqual(["Bump it"]);
    expect(optionLabels(q({ options: [{ value: "pin" }] }))).toEqual(["pin"]);
    expect(optionLabels(q({ options: null }))).toEqual([]);
  });

  it("truncates with an ellipsis only when it has to", () => {
    expect(truncate("short", 20)).toBe("short");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
  });

  it("returns the raw string rather than throwing on an unparseable date", () => {
    expect(formatRelative("not-a-date")).toBe("not-a-date");
    expect(formatRelative(null)).toBe("");
  });

  it("formats a relative span", () => {
    const twoHoursAgo = new Date(Date.now() - 7200_000).toISOString();
    expect(formatRelative(twoHoursAgo)).toBe("2h ago");
  });
});
