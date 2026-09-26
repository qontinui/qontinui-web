/**
 * QuestionRow's three terminal shapes — and specifically that a WITHDRAWN row
 * does not render as the answer it never got.
 *
 * Added by plan
 * `2026-09-20-a-pending-operator-question-outlives-the-condition-that-motivated-it`
 * Phase 4, whose whole risk is a rendering one: a withdrawn row leaves
 * `responded_at` NULL, so every derivation and every detail branch keyed on
 * that field alone puts it back in the operator's face as *"an agent is
 * waiting on this"*. The status half is pinned in `questionStatus.test.ts`;
 * this file pins the half that reaches the operator's eye — the detail block
 * and the dimming.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionRow } from "./QuestionRow";
import type { AgentQuestionRow } from "./questionStatus";

function q(overrides: Partial<AgentQuestionRow> = {}): AgentQuestionRow {
  return {
    question_id: "00000000-0000-4000-8000-00000000000b",
    agent_id: "01a01de1-9d08-7c31-a055-271ad6df6217",
    question: "Override the escalate-path hold on qontinui-web#1393?",
    created_at: "2026-09-18T12:00:00Z",
    ...overrides,
  };
}

function renderRow(overrides: Partial<AgentQuestionRow> = {}) {
  return render(
    <QuestionRow question={q(overrides)} expanded onToggle={() => {}} />
  );
}

/**
 * The status kinds rendered, read off the machine hook rather than the prose.
 *
 * `StatusBadge` emits `data-status-kind={kind}` (`components/console/statusRow.tsx`)
 * precisely so a test does not have to parse the visible string — whose glyph
 * and label are separate text nodes, and whose wording is presentation. An
 * earlier version of this helper matched badge TEXT with `endsWith`, which
 * would also have accepted a future kind named e.g. `re-pending`; comparing
 * the attribute exactly cannot.
 */
function statusKinds(): string[] {
  return Array.from(document.querySelectorAll("[data-status-kind]")).map(
    (b) => b.getAttribute("data-status-kind") ?? ""
  );
}

const WITHDRAWN: Partial<AgentQuestionRow> = {
  withdrawn_at: "2026-09-20T09:10:00Z",
  withdrawn_by: "auto:predicate",
  withdrawal_reason: "qontinui-web#1393 landed at 2026-09-20T08:54:33Z",
};

describe("QuestionRow — withdrawn", () => {
  it("shows the withdrawal record where an answered row shows its response", () => {
    renderRow(WITHDRAWN);
    const block = screen.getByTestId("coord-question-withdrawal");
    expect(block).toBeTruthy();
    expect(block.textContent).toContain("Withdrawn");
    expect(block.textContent).toContain("auto:predicate");
    expect(block.textContent).toContain("#1393 landed");
    // And not the answered block, which would claim a decision nobody made.
    expect(screen.queryByTestId("coord-question-response")).toBeNull();
  });

  it("reads as retired, not as waiting on the operator", () => {
    renderRow(WITHDRAWN);
    expect(statusKinds()).toContain("withdrawn");
    expect(statusKinds()).not.toContain("pending");
    // The pending affordance is gone: nobody is composing a response to this.
    expect(
      screen.queryByText(/the response composer lives on the detail page/)
    ).toBeNull();
  });

  it("says coord recorded no reason rather than showing an empty block", () => {
    renderRow({ withdrawn_at: "2026-09-20T09:10:00Z" });
    expect(
      screen.getByTestId("coord-question-withdrawal").textContent
    ).toContain("coord recorded no reason for this withdrawal");
  });

  it("prefers the withdrawal block when a row carries both stamps", () => {
    // Defensive: coord's doors will refuse each other's terminal state once
    // the sibling PR ships them, so this row should not exist — but if it
    // arrives, the detail must agree with `deriveQuestionStatus`, which calls
    // it withdrawn.
    renderRow({
      ...WITHDRAWN,
      responded_at: "2026-09-20T09:00:00Z",
      response: "go ahead",
      responded_by_operator: "josh@qontinui.io",
    });
    expect(screen.getByTestId("coord-question-withdrawal")).toBeTruthy();
    expect(screen.queryByTestId("coord-question-response")).toBeNull();
  });
});

describe("QuestionRow — the two shapes withdrawal must not disturb", () => {
  it("still renders a pending row as pending, with the composer hint", () => {
    renderRow();
    expect(statusKinds()).toContain("pending");
    expect(screen.queryByTestId("coord-question-withdrawal")).toBeNull();
    expect(
      screen.getByText(/the response composer lives on the detail page/)
    ).toBeTruthy();
  });

  it("still renders an answered row's response", () => {
    renderRow({
      responded_at: "2026-09-20T09:00:00Z",
      response: "pin it",
      responded_by_operator: "josh@qontinui.io",
    });
    const block = screen.getByTestId("coord-question-response");
    expect(block.textContent).toContain("Answered");
    expect(block.textContent).toContain("josh@qontinui.io");
    expect(block.textContent).toContain("pin it");
    expect(screen.queryByTestId("coord-question-withdrawal")).toBeNull();
  });
});

/**
 * Decision effects — plan
 * `2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy`
 * Phases 2–3. A mirror row wears a chip naming the decision it mirrors, and
 * its expanded detail links the effect's own page; a row with no effect is
 * untouched.
 */
describe("QuestionRow — decision effects", () => {
  function chips(): HTMLElement[] {
    return screen.queryAllByTestId("coord-question-effect-chip");
  }

  it("renders a gate chip with its work unit and phase, and links the gate", () => {
    renderRow({
      effect_kind: "gate",
      effect_ref: {
        id: "gate-7",
        gate_id: "gate-7",
        work_unit_id: "wu-42",
        phase_name: "Phase 2",
      },
    });
    expect(chips()).toHaveLength(1);
    expect(chips()[0].getAttribute("data-effect-kind")).toBe("gate");
    expect(screen.getByTestId("coord-question-effect-detail").textContent).toBe(
      "wu-42 · Phase 2"
    );
    // The chip in the collapsed row is NOT a link — the row is one button.
    expect(chips()[0].closest("a")).toBeNull();
    expect(
      screen.getByTestId("coord-question-effect-link").getAttribute("href")
    ).toBe("/admin/coord/gates?gate=gate-7");
    expect(
      screen.getByText(/decide it \(met \/ not_met\) on the detail page/)
    ).toBeTruthy();
  });

  it("renders a proposal chip linking the proposal drill-down", () => {
    renderRow({
      effect_kind: "proposal",
      effect_ref: { id: "p-1", proposal_id: "p-1" },
    });
    expect(chips()[0].getAttribute("data-effect-kind")).toBe("proposal");
    expect(
      screen.getByTestId("coord-question-effect-link").getAttribute("href")
    ).toBe("/admin/coord/prompt-document-proposals?proposal=p-1");
  });

  it("renders a clause chip plainly, with no link and the ordinary hint", () => {
    renderRow({
      effect_kind: "clause",
      effect_ref: { id: "c-1", kind: "policy", name: "testing", clause_id: "c-1" },
    });
    expect(chips()[0].getAttribute("data-effect-kind")).toBe("clause");
    expect(screen.queryByTestId("coord-question-effect-link")).toBeNull();
    expect(
      screen.getByText(/the response composer lives on the detail page/)
    ).toBeTruthy();
  });

  it.each([
    ["absent", {}],
    ["'none'", { effect_kind: "none", effect_ref: null }],
  ])("renders no chip and no link when effect_kind is %s", (_l, extra) => {
    renderRow(extra);
    expect(chips()).toHaveLength(0);
    expect(screen.queryByTestId("coord-question-effect-link")).toBeNull();
    expect(statusKinds()).toEqual(["pending"]);
  });
});
