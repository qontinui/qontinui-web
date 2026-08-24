/**
 * GapRow's review-owed copy — the words Ruling 2 made load-bearing.
 *
 * Ruling 2 of the Wave-1 review moved the "a review is owed" signal OUT of the
 * badge hue (a pre-answered gap is calm) and INTO the row detail as prose. That
 * trade is only sound while the prose is true, which is why it is asserted
 * rather than eyeballed: the second sentence names BUTTONS, and `Accept` is
 * disabled without a `clause_id`. Copy that points at a dead button is worse
 * than the amber badge it replaced.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GapRow } from "./GapRow";
import type { AgentQuestionRow } from "./questionStatus";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { email: "operator@local" } }),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function gap(
  clause: Record<string, unknown> | undefined,
  answered: boolean
): AgentQuestionRow {
  return {
    question_id: "00000000-0000-4000-8000-00000000000a",
    question: "No clause covers whether to retry a 502 from the twin.",
    created_at: "2026-08-20T09:00:00Z",
    responded_at: answered ? "2026-08-20T09:05:00Z" : null,
    // The envelope shape `parseGapContext` actually decodes: the marker, then
    // `{policy_gap, context}` — NOT a bare gap object. Getting this wrong made
    // the first draft of this file assert against a `null` parse.
    context: `POLICY_GAP ${JSON.stringify({
      policy_gap: {
        category: "escalation-bar",
        tier_applied: "2",
        proposed_clause: clause ?? {},
      },
      context: "the agent's original question context",
    })}`,
  };
}

function renderGap(clause: Record<string, unknown> | undefined, answered = true) {
  render(
    <GapRow
      question={gap(clause, answered)}
      onHandled={() => {}}
      expanded
      onToggle={() => {}}
    />
  );
}

describe("GapRow review-owed copy", () => {
  it("names Accept only when there is a clause Accept can actually take", () => {
    renderGap({ clause_id: "retry-twin-502", action: "retry once" });
    expect(screen.getByTestId("coord-gap-review-owed")).toHaveTextContent(
      /accept the clause below, or dismiss it/
    );
    expect(screen.getByTestId("coord-gap-accept")).not.toBeDisabled();
  });

  it("does NOT tell the operator to accept a clause with no clause_id", () => {
    // `hasClause` is true here (a `trigger` alone satisfies it) so the clause
    // panel renders — but Accept is disabled, so the copy must not name it.
    renderGap({ trigger: "twin returns 502" });
    const owed = screen.getByTestId("coord-gap-review-owed");
    expect(owed).not.toHaveTextContent(/accept the clause below/);
    expect(owed).toHaveTextContent(/no clause here that can be accepted/);
    expect(screen.getByTestId("coord-gap-accept")).toBeDisabled();
  });

  it("also covers the no-clause-at-all case", () => {
    renderGap(undefined);
    expect(screen.getByTestId("coord-gap-review-owed")).toHaveTextContent(
      /dismiss it or author one in the prompt-documents editor/
    );
    expect(screen.getByTestId("coord-gap-accept")).toBeDisabled();
  });

  it("says nothing about a review being owed while the gap is still blocking", () => {
    // A blocking gap is RED and the badge already carries the ask.
    renderGap({ clause_id: "x" }, false);
    expect(screen.queryByTestId("coord-gap-review-owed")).toBeNull();
  });
});
