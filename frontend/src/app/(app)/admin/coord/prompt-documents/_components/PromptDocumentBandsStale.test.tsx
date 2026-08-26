/**
 * The per-band empty line must be withheld when the list on screen is STALE.
 *
 * This is the one state `PromptDocumentBands.test.tsx` cannot reach. Its
 * "coord could not be reached" case is a FIRST-load failure, where `documents`
 * is empty and the outer band gate suppresses every band anyway. The dangerous
 * state is the other one:
 *
 *   `documents.length > 0`  AND  `error !== null`
 *
 * `usePromptDocuments` produces it deliberately — on a failed fetch it keeps the
 * last-good list on screen rather than blanking it, and the banner says the view
 * is stale. Because the outer gate passes on `documents.length > 0` alone, the
 * empty-line branch is reachable with `canAssertEmpty === false`, and a band
 * holding nothing in the STALE list would state "nobody has authored one" while
 * the banner above says the corpus could not be read.
 *
 * Reachable in production without anything exotic: an operator loads the page
 * with behavior documents and no intent documents, edits anything, and the
 * post-write refetch fails during a coord deploy. `loadDocuments` is re-run
 * after every mutation, so the window is ordinary rather than rare.
 *
 * That is the `silent-empty-is-unknown` failure applied to a heading — the very
 * thing the per-band line was added to prevent — so it is pinned in its own file
 * rather than left to the component's own gate.
 *
 * This file mocks the HOOK rather than the HTTP client, because the component
 * exposes no reload control a test could click; the state is a property of the
 * render gate, not of any user path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PromptDocumentSummary } from "../types";

const hookState = {
  documents: [] as PromptDocumentSummary[],
  loading: false,
  saving: false,
  error: null as string | null,
  degraded: null as string | null,
};

vi.mock("../_hooks/usePromptDocuments", () => ({
  usePromptDocuments: () => ({
    ...hookState,
    reload: vi.fn(),
    fetchDocument: vi.fn(),
    fetchVersions: vi.fn(),
    fetchVersion: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    restoreDefault: vi.fn(),
    restoreVersion: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PromptDocumentList } from "./PromptDocumentList";

function behaviorOnlyCorpus(): PromptDocumentSummary[] {
  return [
    {
      kind: "policy",
      name: "engineering-priorities",
      description: "capability > scalability > robustness > clean code",
      format: "markdown",
      default_source: "prompt_doc/policy/engineering-priorities/v1",
      current_version: 1,
      updated_by: "seed",
      updated_at: "2026-08-25T00:00:00Z",
      agent_writable: null,
    },
  ];
}

beforeEach(() => {
  hookState.documents = behaviorOnlyCorpus();
  hookState.loading = false;
  hookState.saving = false;
  hookState.error = null;
  hookState.degraded = null;
});

describe("per-band empty line vs a stale list", () => {
  it("states emptiness when coord ANSWERED and the Intent band is genuinely empty", () => {
    render(<PromptDocumentList />);

    // Control: with no error, the line is legitimate and must appear — otherwise
    // the negative assertions below would pass for the wrong reason.
    expect(screen.getByTestId("kind-band-empty-intent")).toBeInTheDocument();
    expect(screen.getByTestId("kind-band-behavior")).toBeInTheDocument();
  });

  it("withholds it when the list is stale and errored", () => {
    hookState.error = "coord unreachable";
    render(<PromptDocumentList />);

    // The stale list is still on screen, with the banner explaining why.
    expect(screen.getByTestId("prompt-documents-error")).toBeInTheDocument();
    expect(screen.getByTestId("kind-band-behavior")).toBeInTheDocument();

    // ...but nothing may claim the tenant authored no intent documents.
    expect(
      screen.queryByTestId("kind-band-empty-intent")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kind-band-empty-behavior")
    ).not.toBeInTheDocument();
  });

  it("withholds it when the list is stale and the store is degraded", () => {
    hookState.degraded = "coord.prompt_documents is not provisioned";
    render(<PromptDocumentList />);

    expect(
      screen.queryByTestId("kind-band-empty-intent")
    ).not.toBeInTheDocument();
  });
});
