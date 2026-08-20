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

function doc(kind: PromptDocumentKind): PromptDocument {
  return {
    id: "doc-1",
    tenant_id: "tenant-1",
    kind,
    name: kind === "session_briefing" ? "runner-session" : "session-protocol",
    description: "the briefing",
    format: "markdown",
    default_source: "prompt_doc/x/y/v1",
    current_version: 3,
    updated_by: "editor@example.com",
    updated_at: "2026-08-20T10:00:00Z",
    body: "Original body.",
    attrs: null,
  };
}

function renderDialog(
  kind: PromptDocumentKind,
  onUpdate = vi.fn().mockResolvedValue(true)
) {
  render(
    <PromptDocumentEditorDialog
      open
      onOpenChange={vi.fn()}
      document={doc(kind)}
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
