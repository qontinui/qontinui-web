/**
 * The upstream dialog's three DECISIONS, wired through the list (plan
 * `2026-09-04-cross-tenant-policy-publishing` D4 + Phase 7).
 *
 * What is pinned here, and why each would fail silently:
 *
 * 1. **`Keep mine` and `Adopt` reach coord's decision routes, carrying the
 *    open document's `current_version`.** Before these doors existed the two
 *    buttons rendered disabled with a notice; a regression that unwires a prop
 *    puts the notice back and the operator reads "already decided".
 * 2. **`Merge clauses` is offered for a `policy` document only.** Coord has no
 *    clause decomposition for any other kind and answers `400`; a control
 *    whose only outcome is that refusal is a dead end.
 * 3. **The merge apply is withheld until every conflict has a choice, and no
 *    choice is pre-selected.** Coord refuses an unresolved conflict
 *    (`409 unresolved_conflicts`) rather than defaulting a side; this surface
 *    must not quietly pick one either — pre-selecting "upstream" would be the
 *    exact silent side-pick the design refuses.
 * 4. **The resolutions the operator made are what is sent.** Nothing else.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { PromptDocumentList } from "./PromptDocumentList";
import type {
  ClauseMergeEntry,
  ClauseMergePreview,
  MergeClauseSide,
  PromptDocumentKind,
  PromptDocumentSummary,
} from "../types";

const API = "/api/v1/operations";

function summary(
  kind: PromptDocumentKind,
  name: string,
  upstream: Partial<PromptDocumentSummary> = {}
): PromptDocumentSummary {
  return {
    id: `doc-${kind}-${name}`,
    kind,
    name,
    description: null,
    format: "markdown",
    default_source: "prompt_doc_pub/policy/testing/v4",
    current_version: 7,
    updated_by: "someone@example.com",
    updated_at: "2026-08-20T10:00:00Z",
    upstream_publication_version: 4,
    latest_publication_version: 5,
    local_modified: true,
    update_available: true,
    ...upstream,
  };
}

function publication(version: number, body: string) {
  return {
    publication_id: `p${version}`,
    kind: "policy",
    name: "testing",
    publication_version: version,
    format: "markdown",
    description: null,
    release_note: version === 5 ? "tightened the bounds" : null,
    content_sha256: `sha-${version}`,
    source_version: 20 + version,
    published_by: "operator@example.com",
    published_at: "2026-09-04T10:00:00Z",
    body,
  };
}

function side(action: string): MergeClauseSide {
  return {
    clause_id: "x",
    category: "testing",
    status: "active",
    tier: null,
    trigger: null,
    action,
    bounds: null,
    escalate_if: null,
    anti_triggers: [],
    depends_on: [],
    links: [],
  };
}

function entry(
  clause: string,
  decision: ClauseMergeEntry["decision"],
  sides: Pick<ClauseMergeEntry, "local" | "upstream" | "base">
): ClauseMergeEntry {
  return {
    clause,
    decision,
    requires_choice: decision === "conflict",
    ...(decision === "conflict" ? { conflict_reason: "both_edited" } : {}),
    ...sides,
  };
}

const CLAUSE_PLAN: ClauseMergePreview = {
  mode: "clauses",
  kind: "policy",
  name: "testing",
  current_version: 7,
  tracked_publication_version: 4,
  publication_version: 5,
  publication_release_note: "tightened the bounds",
  base_source: "tracked_publication",
  base_publication_version: 4,
  base_known: true,
  entries: [
    entry("tempo", "take_upstream_edit", {
      base: side("old"),
      local: side("old"),
      upstream: side("new"),
    }),
    entry("scope", "conflict", {
      base: side("base"),
      local: side("ours"),
      upstream: side("theirs"),
    }),
  ],
  conflicts: ["scope"],
  noop: false,
};

/**
 * Route the GET mock by path: the list, the body-bearing get-one, the two
 * publications the dialog compares, and the merge preview.
 */
function routeGets(docs: PromptDocumentSummary[], plan: ClauseMergePreview) {
  getMock.mockImplementation((url: string) => {
    if (url === `${API}/coord/prompt-documents`) {
      return Promise.resolve({ documents: docs, degraded: null });
    }
    if (/\/coord\/prompt-documents\/[^/]+\/[^/]+\/upstream-merge\?/.test(url)) {
      return Promise.resolve(plan);
    }
    if (
      /\/coord\/prompt-document-publications\/[^/]+\/[^/]+\/(\d+)$/.test(url)
    ) {
      const version = Number(url.split("/").pop());
      return Promise.resolve(publication(version, `body v${version}`));
    }
    if (/\/coord\/prompt-documents\/[^/]+\/[^/]+$/.test(url)) {
      const [, kind, name] =
        /\/coord\/prompt-documents\/([^/]+)\/([^/]+)$/.exec(
          url
        ) as RegExpExecArray;
      const doc = docs.find((d) => d.kind === kind && d.name === name);
      return Promise.resolve({ ...doc, body: "our local body" });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

async function openUpstream(kind: PromptDocumentKind, name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId(`doc-upstream-${kind}-${name}`));
  // The dialog is on screen with the publication loaded once the Adopt
  // control names its version.
  await screen.findByText(/Adopt v5/);
  return user;
}

describe("the whole-body decisions", () => {
  it("Keep mine records the reviewed publication against the version on screen", async () => {
    routeGets([summary("policy", "testing")], CLAUSE_PLAN);
    postMock.mockResolvedValue({
      kept: true,
      kind: "policy",
      name: "testing",
      from_version: 7,
      to_version: 8,
      publication_version: 5,
      local_modified: true,
    });
    render(<PromptDocumentList />);
    const user = await openUpstream("policy", "testing");

    // Wired, not the "cannot yet decide" notice.
    expect(
      screen.queryByTestId("upstream-decisions-unwired")
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId("upstream-keep-mine"));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const [url, body] = postMock.mock.calls[0] as [string, unknown];
    expect(url).toBe(
      `${API}/coord/prompt-documents/policy/testing/upstream-keep`
    );
    expect(body).toEqual({ publication_version: 5, expected_version: 7 });
    // The decision moved the badge, so the list re-reads.
    await waitFor(() =>
      expect(
        getMock.mock.calls.filter(
          ([u]) => u === `${API}/coord/prompt-documents`
        ).length
      ).toBeGreaterThanOrEqual(2)
    );
  });

  it("Adopt reaches the adopt route with the same concurrency check", async () => {
    routeGets([summary("policy", "testing")], CLAUSE_PLAN);
    postMock.mockResolvedValue({
      adopted: true,
      kind: "policy",
      name: "testing",
      from_version: 7,
      to_version: 8,
      publication_version: 5,
      local_modified: true,
    });
    render(<PromptDocumentList />);
    const user = await openUpstream("policy", "testing");

    await user.click(screen.getByTestId("upstream-adopt"));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const [url, body] = postMock.mock.calls[0] as [string, unknown];
    expect(url).toBe(
      `${API}/coord/prompt-documents/policy/testing/upstream-adopt`
    );
    expect(body).toEqual({ publication_version: 5, expected_version: 7 });
  });
});

describe("Merge clauses", () => {
  it("is offered for a policy document and withheld from every other kind", async () => {
    routeGets(
      [summary("policy", "testing"), summary("agent_playbook", "plan-capture")],
      CLAUSE_PLAN
    );
    render(<PromptDocumentList />);

    await openUpstream("policy", "testing");
    expect(screen.getByTestId("upstream-merge-clauses")).toBeVisible();
  });

  it("withholds the control for a non-policy kind", async () => {
    routeGets([summary("agent_playbook", "plan-capture")], CLAUSE_PLAN);
    render(<PromptDocumentList />);

    await openUpstream("agent_playbook", "plan-capture");
    expect(
      screen.queryByTestId("upstream-merge-clauses")
    ).not.toBeInTheDocument();
  });

  it("asks for every conflict, pre-selects nothing, and sends exactly the choices made", async () => {
    routeGets([summary("policy", "testing")], CLAUSE_PLAN);
    postMock.mockResolvedValue({
      merged: true,
      kind: "policy",
      name: "testing",
      from_version: 7,
      to_version: 8,
      publication_version: 5,
      clauses: 2,
      entries: [],
    });
    render(<PromptDocumentList />);
    const user = await openUpstream("policy", "testing");

    await user.click(screen.getByTestId("upstream-merge-clauses"));
    const summaryLine = await screen.findByTestId("clause-merge-summary");
    expect(summaryLine).toHaveTextContent("1 from upstream");
    expect(summaryLine).toHaveTextContent("1 need a choice");

    // The conflict is named, and nothing is chosen for it.
    expect(screen.getByTestId("clause-merge-unresolved")).toHaveTextContent(
      "scope"
    );
    const conflict = screen.getByTestId("clause-merge-entry-scope");
    const radios = within(conflict).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    // And the decided row carries no radio at all.
    expect(
      within(screen.getByTestId("clause-merge-entry-tempo")).queryAllByRole(
        "radio"
      )
    ).toHaveLength(0);

    const apply = screen.getByTestId("upstream-merge-apply");
    expect(apply).toBeDisabled();
    // Clicking a disabled apply sends nothing — coord would 409, but this
    // surface never even asks.
    expect(postMock).not.toHaveBeenCalled();

    await user.click(
      within(
        screen.getByTestId("clause-merge-choice-scope-upstream")
      ).getByRole("radio")
    );
    await waitFor(() => expect(apply).toBeEnabled());
    expect(
      screen.queryByTestId("clause-merge-unresolved")
    ).not.toBeInTheDocument();

    await user.click(apply);

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const [url, body] = postMock.mock.calls[0] as [string, unknown];
    expect(url).toBe(
      `${API}/coord/prompt-documents/policy/testing/upstream-merge`
    );
    expect(body).toEqual({
      publication_version: 5,
      expected_version: 7,
      resolutions: { scope: "upstream" },
    });
  });

  it("relays coord's whole-body fallback and offers no apply", async () => {
    routeGets([summary("policy", "testing")], {
      mode: "whole_body",
      kind: "policy",
      name: "testing",
      current_version: 7,
      tracked_publication_version: 4,
      publication_version: 5,
      publication_release_note: null,
      base_source: "tracked_publication",
      base_publication_version: 4,
      fallback: {
        reason: "preamble_not_representable",
        detail: "the local body carries prose before its first clause header",
      },
    });
    render(<PromptDocumentList />);
    const user = await openUpstream("policy", "testing");

    await user.click(screen.getByTestId("upstream-merge-clauses"));

    const notice = await screen.findByTestId("clause-merge-whole-body");
    expect(notice).toHaveTextContent(/prose before its first clause header/i);
    expect(notice).toHaveTextContent(/Keep mine/);
    expect(screen.getByTestId("upstream-merge-apply")).toBeDisabled();
    // Back to the comparison, where the whole-body pair still is.
    await user.click(screen.getByTestId("upstream-merge-back"));
    expect(await screen.findByTestId("upstream-keep-mine")).toBeEnabled();
  });
});
