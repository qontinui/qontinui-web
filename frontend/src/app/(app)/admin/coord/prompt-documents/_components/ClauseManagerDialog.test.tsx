/**
 * ClauseManagerDialog — the category default-tier editor reads the saved value
 * off the document's `attrs` (get-one shape; list summaries never carry it).
 *
 * Regression for the `attrs` read-path defect (plan
 * `2026-07-24-prompt-document-attrs-read-and-write-both-broken.md`): coord
 * historically never returned `attrs`, so the tier dropdown rendered empty on
 * every open even after a successful save. These tests pin the frontend half:
 * a `document` prop that DOES carry `attrs.default_tier` must render that tier
 * (and count as not-dirty, so Save stays disabled until the operator changes
 * it), and a document without attrs renders the "None"/inherit choice.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getMock = vi.fn();
const patchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ClauseManagerDialog } from "./ClauseManagerDialog";
import type { PromptDocument } from "../types";

function doc(attrs: PromptDocument["attrs"]): PromptDocument {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: "22222222-2222-2222-2222-222222222222",
    kind: "policy",
    name: "engineering-priorities",
    description: "Engineering Priorities",
    body: "Prefer the stronger design.",
    format: "markdown",
    default_source: "prompt_doc/policy/engineering-priorities/v1",
    current_version: 3,
    updated_by: "editor@example.com",
    updated_at: "2026-07-24T00:00:00Z",
    attrs,
  };
}

function renderDialog(document: PromptDocument) {
  render(
    <ClauseManagerDialog
      open
      onOpenChange={vi.fn()}
      document={document}
      loadingBody={false}
      onDocsReload={vi.fn()}
    />
  );
}

describe("ClauseManagerDialog category default tier", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue([]);
    patchMock.mockReset();
  });

  it("renders a previously saved default_tier from document.attrs", async () => {
    renderDialog(doc({ default_tier: "ask-first" }));

    // Let the clause fetch settle so no state update lands outside act.
    await screen.findByText(/No clauses yet/i);

    expect(screen.getByTestId("category-default-tier")).toHaveTextContent(
      "ask-first"
    );
    // The rendered value equals the saved value — nothing dirty to save yet.
    expect(screen.getByTestId("category-default-tier-save")).toBeDisabled();
  });

  it("renders the inherit choice (None) when the document has no attrs", async () => {
    renderDialog(doc(null));

    await screen.findByText(/No clauses yet/i);

    expect(screen.getByTestId("category-default-tier")).toHaveTextContent(
      "None"
    );
    expect(screen.getByTestId("category-default-tier-save")).toBeDisabled();
  });
});
