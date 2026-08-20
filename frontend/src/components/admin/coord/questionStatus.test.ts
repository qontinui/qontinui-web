/**
 * questionStatus — the pure derivation behind both lists on
 * `/admin/coord/questions`.
 *
 * Added by plan `2026-08-16-coord-console-ui-unification-pipeline-style.md`
 * Phase 3 Wave 1, alongside the migration of the route onto
 * `components/console`. Modelled on `alertStatus.test.ts`: no DOM, and the R3
 * palette invariant is asserted with the SHARED audit rather than eyeballed.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  QUESTION_ATTENTION_BY_KIND,
  QUESTION_BADGE_CLASS,
  QUESTION_STATUS_PALETTE,
  deriveGapStatus,
  deriveQuestionStatus,
  formatRelative,
  optionLabels,
  questionIdentity,
  truncate,
  type AgentQuestionRow,
  type QuestionKind,
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

  it("has an attention for every kind (the table is TOTAL)", () => {
    for (const kind of Object.keys(QUESTION_BADGE_CLASS) as QuestionKind[]) {
      expect(QUESTION_ATTENTION_BY_KIND[kind]).toBeTruthy();
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
});

describe("deriveGapStatus", () => {
  it("is author-action while the gap is still blocking", () => {
    const s = deriveGapStatus(q(), "escalation-bar");
    expect(s.kind).toBe("gap-blocking");
    expect(s.attention).toBe("author");
    expect(s.reason).toContain("escalation-bar");
  });

  it("is WAITING once pre-answered — reviewed, not resolved", () => {
    // A non-blocking gap arrives pre-answered because coord applied the
    // category default. Nobody is stopped, but the clause still wants a human.
    const s = deriveGapStatus({ responded_at: "2026-08-20T10:00:00Z" });
    expect(s.kind).toBe("gap-handled");
    expect(s.attention).toBe("waiting");
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
