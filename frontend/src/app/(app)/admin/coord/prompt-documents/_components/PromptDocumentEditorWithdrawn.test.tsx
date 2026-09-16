/**
 * The editor dialog's notice for a WITHDRAWN decision record (plan
 * `2026-09-13-decision-records-are-agent-writable-but-policy-says-they-are-not`,
 * §7 3.1/3.3).
 *
 * `withdrawn` / `withdrawn_reason` are served on the get-one document the same
 * way as on the list summary (`PromptDocument extends PromptDocumentSummary`),
 * but until now only the list row and the landed-write feed read them — this
 * dialog let an operator open and edit a withdrawn record's body with no sign
 * it was void. The notice marks an explicit `true` and nothing else: a coord
 * that predates withdrawal omits the field, and absent must render as neither
 * "withdrawn" nor "live".
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { PromptDocumentEditorDialog } from "./PromptDocumentEditorDialog";
import type { PromptDocument } from "../types";

function decisionRecord(over: Partial<PromptDocument> = {}): PromptDocument {
  return {
    id: "doc-1",
    tenant_id: "tenant-1",
    kind: "decision_record",
    name: "voided",
    description: "a decision",
    format: "markdown",
    default_source: null,
    current_version: 2,
    updated_by: "operator:1:ops@example.com",
    updated_at: "2026-09-13T10:00:00Z",
    body: "decision: something\nstatus: withdrawn\n---\nBody text.",
    attrs: null,
    ...over,
  };
}

function renderDialog(document: PromptDocument) {
  render(
    <PromptDocumentEditorDialog
      open
      onOpenChange={vi.fn()}
      document={document}
      loadingBody={false}
      saving={false}
      onUpdate={vi.fn().mockResolvedValue(true)}
      onRestore={vi.fn().mockResolvedValue(true)}
      onShowHistory={vi.fn()}
    />
  );
}

describe("PromptDocumentEditorDialog — withdrawn notice", () => {
  it("shows the notice, with the reason, for a withdrawn record", () => {
    renderDialog(
      decisionRecord({
        withdrawn: true,
        withdrawn_reason: "never decided — recorded from a guess",
      })
    );
    const notice = screen.getByTestId("doc-editor-withdrawn-notice");
    expect(notice).toHaveTextContent("This record is withdrawn");
    expect(notice).toHaveTextContent(
      "never decided — recorded from a guess"
    );
  });

  it("shows the notice with no reason clause when none was recorded", () => {
    renderDialog(decisionRecord({ withdrawn: true, withdrawn_reason: null }));
    const notice = screen.getByTestId("doc-editor-withdrawn-notice");
    expect(notice).toHaveTextContent("This record is withdrawn");
    expect(notice).not.toHaveTextContent("Reason given");
  });

  it("shows no notice for a live record", () => {
    renderDialog(decisionRecord({ withdrawn: false }));
    expect(
      screen.queryByTestId("doc-editor-withdrawn-notice")
    ).not.toBeInTheDocument();
  });

  it("shows no notice when coord serves no withdrawn field at all", () => {
    renderDialog(decisionRecord());
    expect(
      screen.queryByTestId("doc-editor-withdrawn-notice")
    ).not.toBeInTheDocument();
  });
});
