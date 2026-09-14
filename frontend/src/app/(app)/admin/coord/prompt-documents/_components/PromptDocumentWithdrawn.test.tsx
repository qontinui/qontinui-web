/**
 * The document list's mark for a WITHDRAWN decision record (plan
 * `2026-09-13-decision-records-are-agent-writable-but-policy-says-they-are-not`,
 * §7 3.1/3.3).
 *
 * Coord parses a record's frontmatter `status` server-side and serves
 * `withdrawn` beside it. The list marks an explicit `true` and nothing else: a
 * coord that predates withdrawal omits the field, and absent is UNKNOWN — it
 * must neither mint the badge nor be read as a statement that the record is
 * live.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PromptDocumentList } from "./PromptDocumentList";
import type { PromptDocumentSummary } from "../types";

function record(
  name: string,
  over: Partial<PromptDocumentSummary> = {}
): PromptDocumentSummary {
  return {
    id: `doc-${name}`,
    kind: "decision_record",
    name,
    description: null,
    format: "markdown",
    default_source: null,
    current_version: 2,
    updated_by: "operator:1:ops@example.com",
    updated_at: "2026-09-13T10:00:00Z",
    ...over,
  } as PromptDocumentSummary;
}

function renderList(documents: PromptDocumentSummary[]) {
  getMock.mockResolvedValue({ documents, degraded: null });
  render(<PromptDocumentList />);
}

beforeEach(() => {
  getMock.mockReset();
});

describe("prompt-document list — withdrawn decision records", () => {
  it("marks a record coord says is withdrawn, with the reason in the title", async () => {
    renderList([
      record("voided", {
        status: "withdrawn",
        withdrawn: true,
        withdrawn_reason: "never decided — recorded from a guess",
      }),
    ]);
    const row = await screen.findByTestId("doc-row-decision_record-voided");
    const badge = within(row).getByTestId("doc-withdrawn-decision_record-voided");
    expect(badge).toHaveTextContent("Withdrawn");
    expect(badge.getAttribute("title")).toContain(
      "never decided — recorded from a guess"
    );
  });

  it("does not mark a live record, or one from a coord that serves no field", async () => {
    renderList([
      record("accepted-one", { status: "accepted", withdrawn: false }),
      record("older-coord"),
    ]);
    for (const name of ["accepted-one", "older-coord"]) {
      const row = await screen.findByTestId(`doc-row-decision_record-${name}`);
      expect(
        within(row).queryByTestId(`doc-withdrawn-decision_record-${name}`)
      ).not.toBeInTheDocument();
    }
  });
});
