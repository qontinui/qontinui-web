/**
 * PromptDocumentEditorDialog — the `session_briefing` change-note requirement
 * (plan `2026-08-20-runner-session-briefing-versioned-and-operator-editable`).
 *
 * Coord REFUSES a `session_briefing` PATCH that carries no change note: this
 * text becomes the system prompt of every session the tenant's runners host,
 * and the version log with `edited_by` is the entire mitigation for that
 * privilege. Without the note the log cannot answer "why did every session
 * change behaviour on Tuesday".
 *
 * What these pin is the honesty half of that rule. The operator must learn the
 * requirement from the form — a labelled field and a disabled Save — rather
 * than from a bare 400 after typing an edit. A client that let the request go
 * would be technically correct and still fail the operator, so the disabled
 * state is the behaviour under test, not the request shape alone.
 *
 * They also pin the NEGATIVE: every other kind keeps the optional note. A
 * global requirement would be a silent UX regression on five kinds that coord
 * accepts blank notes for.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PromptDocumentEditorDialog } from "./PromptDocumentEditorDialog";
import type { PromptDocument, PromptDocumentKind } from "../types";

function doc(
  kind: PromptDocumentKind,
  overrides: Partial<PromptDocument> = {}
): PromptDocument {
  return {
    id: "doc-1",
    tenant_id: "tenant-1",
    kind,
    name:
      kind === "session_briefing"
        ? "runner-session"
        : kind === "product_intent"
          ? "vision"
          : "session-protocol",
    description: "the briefing",
    format: "markdown",
    default_source: "prompt_doc/x/y/v1",
    current_version: 3,
    updated_by: "editor@example.com",
    updated_at: "2026-08-20T10:00:00Z",
    body: "Original body.",
    attrs: null,
    ...overrides,
  };
}

function renderDialog(
  kind: PromptDocumentKind,
  onUpdate = vi.fn().mockResolvedValue(true),
  overrides: Partial<PromptDocument> = {}
) {
  render(
    <PromptDocumentEditorDialog
      open
      onOpenChange={vi.fn()}
      document={doc(kind, overrides)}
      loadingBody={false}
      saving={false}
      onUpdate={onUpdate}
      onRestore={vi.fn().mockResolvedValue(true)}
      onShowHistory={vi.fn()}
    />
  );
  return { onUpdate };
}

describe("PromptDocumentEditorDialog — session_briefing change note", () => {
  it("labels the note required and explains why", async () => {
    renderDialog("session_briefing");
    expect(screen.getByText(/Change note \(required\)/)).toBeInTheDocument();
    expect(
      screen.getByTestId("doc-change-note-required")
    ).toBeInTheDocument();
  });

  it("keeps Save disabled while the note is empty, even with a dirty body", async () => {
    const user = userEvent.setup();
    renderDialog("session_briefing");

    await user.type(screen.getByTestId("doc-body"), " edited");
    expect(screen.getByTestId("doc-save")).toBeDisabled();
  });

  it("keeps Save disabled for a whitespace-only note", async () => {
    const user = userEvent.setup();
    renderDialog("session_briefing");

    await user.type(screen.getByTestId("doc-body"), " edited");
    await user.type(screen.getByTestId("doc-change-note"), "   ");
    expect(screen.getByTestId("doc-save")).toBeDisabled();
  });

  it("enables Save once a real note is typed, and SENDS it", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDialog("session_briefing");

    await user.type(screen.getByTestId("doc-body"), " edited");
    await user.type(
      screen.getByTestId("doc-change-note"),
      "tightened the escalation wording"
    );

    const save = screen.getByTestId("doc-save");
    expect(save).toBeEnabled();
    await user.click(save);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(
      "session_briefing",
      "runner-session",
      expect.objectContaining({
        body: "Original body. edited",
        change_description: "tightened the escalation wording",
      })
    );
  });

  it("does NOT require a note for any other kind", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDialog("policy");

    expect(screen.getByText(/Change note \(optional\)/)).toBeInTheDocument();
    expect(
      screen.queryByTestId("doc-change-note-required")
    ).not.toBeInTheDocument();

    await user.type(screen.getByTestId("doc-body"), " edited");
    const save = screen.getByTestId("doc-save");
    expect(save).toBeEnabled();

    await user.click(save);
    expect(onUpdate).toHaveBeenCalledWith(
      "policy",
      "session-protocol",
      expect.not.objectContaining({ change_description: expect.anything() })
    );
  });

  it("still requires a dirty edit — a note alone does not enable Save", async () => {
    const user = userEvent.setup();
    renderDialog("session_briefing");

    await user.type(screen.getByTestId("doc-change-note"), "a note");
    expect(screen.getByTestId("doc-save")).toBeDisabled();
  });
});

/**
 * `attrs.overview_order` — the reading-order position the Summary page's
 * `sortIntentEntries` reads (`overview/_lib/intent.ts`). Before this control
 * existed, the only way to set it was a hand-crafted PATCH: the field was
 * read but had no write path an operator could reach.
 */
describe("PromptDocumentEditorDialog — overview_order", () => {
  it("shows the order control only for a Summary intent kind", () => {
    renderDialog("product_intent");
    expect(screen.getByTestId("doc-overview-order")).toBeInTheDocument();
  });

  it("hides the order control for a kind the Summary does not read", () => {
    renderDialog("policy");
    expect(screen.queryByTestId("doc-overview-order")).not.toBeInTheDocument();
  });

  it("pre-fills the current order, blank when unset", () => {
    renderDialog("product_intent", undefined, {
      attrs: { overview_order: 2 },
    });
    expect(screen.getByTestId("doc-overview-order")).toHaveValue("2");
  });

  it("rejects a non-integer and keeps Save disabled", async () => {
    const user = userEvent.setup();
    renderDialog("product_intent");

    await user.type(screen.getByTestId("doc-overview-order"), "1.5");
    expect(screen.getByTestId("doc-overview-order-error")).toBeInTheDocument();
    expect(screen.getByTestId("doc-save")).toBeDisabled();
  });

  it("sends the new order merged into attrs, preserving other keys", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDialog("product_intent", undefined, {
      attrs: { default_tier: "allow", overview_order: 3 },
    });

    const input = screen.getByTestId("doc-overview-order");
    await user.clear(input);
    await user.type(input, "1");

    const save = screen.getByTestId("doc-save");
    expect(save).toBeEnabled();
    await user.click(save);

    expect(onUpdate).toHaveBeenCalledWith(
      "product_intent",
      "vision",
      expect.objectContaining({
        attrs: { default_tier: "allow", overview_order: 1 },
      })
    );
  });

  it("clearing the field to blank drops the key from attrs", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDialog("product_intent", undefined, {
      attrs: { overview_order: 2 },
    });

    await user.clear(screen.getByTestId("doc-overview-order"));

    const save = screen.getByTestId("doc-save");
    expect(save).toBeEnabled();
    await user.click(save);

    expect(onUpdate).toHaveBeenCalledWith(
      "product_intent",
      "vision",
      expect.objectContaining({ attrs: {} })
    );
  });
});
