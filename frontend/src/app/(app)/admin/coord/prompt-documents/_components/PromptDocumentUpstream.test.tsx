/**
 * The list's publication surface: the badge column, the two row controls, and
 * the refusal that retires the Publish control.
 *
 * What is pinned here, and why each would fail silently:
 *
 * 1. **The badge and the Update control are driven by the SERVED flags.** The
 *    fixtures below hand the list version numbers that contradict the flags, so
 *    anything re-deriving the answer from them renders the wrong thing.
 * 2. **Publish is offered only for a publishable kind.** The six Intent kinds
 *    and `domain_spec` describe the tenant's own product; coord refuses them
 *    with `kind_not_publishable`, and a control whose only outcome is that
 *    refusal is a dead end.
 * 3. **A `not_system_tenant` refusal retires the control WITH a notice.** The
 *    controls vanish from every row after that answer, and a control that
 *    disappears without a word reads as a bug in the page.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
import type { PromptDocumentKind, PromptDocumentSummary } from "../types";

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
    default_source: "prompt_doc/x/y/v1",
    current_version: 2,
    updated_by: "someone@example.com",
    updated_at: "2026-08-20T10:00:00Z",
    ...upstream,
  };
}

function renderList(documents: PromptDocumentSummary[]) {
  getMock.mockResolvedValue({ documents, degraded: null });
  return render(<PromptDocumentList />);
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe("the upstream badge column", () => {
  it("badges a row coord flagged, even when the version numbers say otherwise", async () => {
    // `latest === tracked` would read as "nothing new" to anything deriving the
    // answer itself. Coord said `update_available`, and coord is the authority.
    renderList([
      summary("policy", "testing", {
        upstream_publication_version: 5,
        latest_publication_version: 5,
        local_modified: false,
        update_available: true,
      }),
    ]);

    expect(
      await screen.findByTestId("doc-upstream-update-available-policy-testing")
    ).toHaveTextContent("Update v5");
    // And the control that opens the three-way view is there beside it.
    expect(screen.getByTestId("doc-upstream-policy-testing")).toBeVisible();
  });

  it("marks a diverged row without offering an update it was not told about", async () => {
    renderList([
      summary("policy", "coordination", {
        upstream_publication_version: 4,
        latest_publication_version: 4,
        local_modified: true,
        update_available: false,
      }),
    ]);

    expect(
      await screen.findByTestId("doc-upstream-diverged-policy-coordination")
    ).toHaveTextContent("Diverged from v4");
    expect(
      screen.queryByTestId("doc-upstream-policy-coordination")
    ).not.toBeInTheDocument();
  });

  it("badges nothing for a document with no upstream", async () => {
    // Coord degrades `local_modified` to true for any unresolvable baseline,
    // which is every document that tracks no publication. Badging on the
    // boolean alone would mark the whole store diverged.
    renderList([
      summary("policy", "local-only", {
        upstream_publication_version: null,
        latest_publication_version: null,
        local_modified: true,
        update_available: false,
      }),
    ]);

    await screen.findByTestId("doc-row-policy-local-only");
    expect(
      screen.queryByTestId("doc-upstream-diverged-policy-local-only")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("doc-upstream-update-available-policy-local-only")
    ).not.toBeInTheDocument();
  });

  it("badges nothing when coord served none of the four fields", async () => {
    // A coord predating the channel. Absent is UNKNOWN, and UNKNOWN renders
    // nothing rather than a claim.
    renderList([summary("policy", "old-coord")]);

    await screen.findByTestId("doc-row-policy-old-coord");
    expect(
      screen.queryByTestId("doc-upstream-update-available-policy-old-coord")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("doc-upstream-diverged-policy-old-coord")
    ).not.toBeInTheDocument();
  });
});

describe("the Publish control", () => {
  it("is offered for a Behavior kind and withheld from an Intent kind", async () => {
    renderList([
      summary("policy", "testing"),
      summary("product_intent", "vision"),
    ]);

    expect(
      await screen.findByTestId("doc-publish-policy-testing")
    ).toBeVisible();
    // `product_intent` describes the tenant's own product — coord refuses it
    // with `kind_not_publishable`, so the control would be a dead end.
    expect(
      screen.queryByTestId("doc-publish-product_intent-vision")
    ).not.toBeInTheDocument();
  });

  it("states the immutability of a publication before the operator commits", async () => {
    renderList([summary("policy", "testing")]);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("doc-publish-policy-testing"));

    const notice = await screen.findByTestId("publish-immutability-notice");
    expect(notice).toHaveTextContent(/immutable and is distributed on save/i);
    expect(notice).toHaveTextContent(/publishing again/i);
    // Before the click, not after: nothing has been sent yet.
    expect(postMock).not.toHaveBeenCalled();
  });

  it("retires itself with a notice once coord says this is not the system tenant", async () => {
    renderList([summary("policy", "testing")]);
    const user = userEvent.setup();
    postMock.mockRejectedValue(
      new Error(
        'POST /api/v1/operations/coord/prompt-documents/policy/testing/publish failed: 403 - {"error":"not_system_tenant"}'
      )
    );

    await user.click(await screen.findByTestId("doc-publish-policy-testing"));
    await user.click(await screen.findByTestId("publish-confirm"));

    await waitFor(() =>
      expect(
        screen.getByTestId("prompt-documents-publish-unavailable")
      ).toHaveTextContent(/only from the system tenant/i)
    );
    // And the control is gone from the row, so the operator meets the refusal
    // once rather than per document.
    await waitFor(() =>
      expect(
        screen.queryByTestId("doc-publish-policy-testing")
      ).not.toBeInTheDocument()
    );
  });

  it("sends the version shown on the row as the concurrency check", async () => {
    renderList([summary("policy", "testing", { current_version: 11 })]);
    const user = userEvent.setup();
    postMock.mockResolvedValue({
      published: true,
      publication: {
        publication_id: "p1",
        kind: "policy",
        name: "testing",
        publication_version: 3,
        format: "markdown",
        description: null,
        release_note: "why",
        content_sha256: "abc",
        source_version: 11,
        published_by: "operator@example.com",
        published_at: "2026-09-04T10:00:00Z",
        body: "hello",
      },
      lint: [],
      lint_is_advisory: true,
      immutable: "a publication is never withdrawn",
    });

    await user.click(await screen.findByTestId("doc-publish-policy-testing"));
    await user.click(await screen.findByTestId("publish-confirm"));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const [, body] = postMock.mock.calls[0] as [
      string,
      { expected_version: number },
    ];
    expect(body.expected_version).toBe(11);
    // The lint is reported even when it is empty, so "no hits" is a stated
    // result rather than an absent one.
    expect(await screen.findByTestId("publish-lint-clean")).toBeVisible();
  });

  it("shows lint hits as warnings on a publication that already went out", async () => {
    renderList([summary("policy", "testing")]);
    const user = userEvent.setup();
    postMock.mockResolvedValue({
      published: true,
      publication: {
        publication_id: "p1",
        kind: "policy",
        name: "testing",
        publication_version: 1,
        format: "markdown",
        description: null,
        release_note: null,
        content_sha256: "abc",
        source_version: 2,
        published_by: "operator@example.com",
        published_at: "2026-09-04T10:00:00Z",
        body: "see qontinui-coord",
      },
      lint: [
        {
          category: "repo_name",
          token: "qontinui-coord",
          line: 1,
          reason: "names a repository specific to this fleet",
        },
      ],
      lint_is_advisory: true,
      immutable: "a publication is never withdrawn",
    });

    await user.click(await screen.findByTestId("doc-publish-policy-testing"));
    await user.click(await screen.findByTestId("publish-confirm"));

    const hits = await screen.findByTestId("publish-lint-hits");
    expect(hits).toHaveTextContent("qontinui-coord");
    // The lint NEVER blocks — it ran on the body that shipped.
    expect(hits).toHaveTextContent(/warning, not a refusal/i);
    expect(hits).toHaveTextContent(/the publication went out/i);
  });
});
