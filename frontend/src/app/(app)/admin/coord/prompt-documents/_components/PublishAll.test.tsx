/**
 * The publish-all surface: the button and its count, the dialog's version
 * guarantee, the lint grouping, the settles-at / held badges, and the
 * per-document publish-mode write.
 *
 * Plan `2026-09-19-policy-publish-all-and-auto-publish`, Phase 5. Modelled on
 * `PromptDocumentUpstream.test.tsx` — and note the one place it departs from
 * that file's mock: its `service-factory` stub leaves `patch: vi.fn()` with no
 * implementation, which is fine for a surface that never writes a document.
 * The publish-mode control does, so `patch` is wired here.
 *
 * What is pinned, and how each would fail silently:
 *
 * 1. **The armed run sends the version the DRY RUN returned.** The fixtures
 *    below deliberately give the document LIST a different `current_version`
 *    from the dry run's, so anything re-reading the version off the row arms
 *    the wrong one — and arming the wrong one is exactly what publishes a body
 *    the operator never saw. There is no other signal: coord would accept it.
 * 2. **The button is absent at N = 0 and counts coord's answer at N > 0.**
 * 3. **Lint hits are grouped at the top and INCLUDED by default.** The lint is
 *    advisory; excluding by default would turn it into the gate the 2026-09-04
 *    plan's D2 refuses to make it. Each row still unticks.
 * 4. **A `not_system_tenant` answer retires the whole surface**, badges
 *    included — the mode control and the badges are meaningless outside the
 *    system tenant.
 * 5. **The badges are read off the status route, never derived.** No settle
 *    time is computed here; a held document shows its token.
 * 6. **The publish-mode write sends `publish_mode`, and `auto` is confirmed.**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    // Filled in, unlike the template's bare `vi.fn()`: the publish-mode control
    // is a WRITE, and a stub with no implementation returns `undefined`, which
    // the document hook would report as a successful save of nothing.
    patch: (...args: unknown[]) => patchMock(...args),
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
  AutoPublishStatusEntry,
  PromptDocumentKind,
  PromptDocumentSummary,
  PublishAllCandidate,
} from "../types";

// Radix opens its menus on a pointer sequence, not a bare MouseEvent click.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function summary(
  kind: PromptDocumentKind,
  name: string,
  over: Partial<PromptDocumentSummary> = {}
): PromptDocumentSummary {
  return {
    id: `doc-${kind}-${name}`,
    kind,
    name,
    description: null,
    format: "markdown",
    default_source: null,
    current_version: 2,
    updated_by: "someone@example.com",
    updated_at: "2026-08-20T10:00:00Z",
    ...over,
  };
}

function candidate(
  kind: PromptDocumentKind,
  name: string,
  over: Partial<PublishAllCandidate> = {}
): PublishAllCandidate {
  return {
    kind,
    name,
    current_version: 7,
    next_publication_version: 1,
    lint: [],
    direction: "other",
    publish_mode: "manual",
    edited_by: "agent:runner",
    change_notes: [],
    ...over,
  };
}

function statusEntry(
  kind: PromptDocumentKind,
  name: string,
  over: Partial<AutoPublishStatusEntry> = {}
): AutoPublishStatusEntry {
  return { kind, name, publish_mode: "auto", ...over };
}

/**
 * Mount the list with coord answering each door separately.
 *
 * URL-keyed rather than call-ordered: the list now reads two GETs and the
 * order between them is an implementation detail no test should pin.
 */
function renderList(opts: {
  documents: PromptDocumentSummary[];
  status?: AutoPublishStatusEntry[];
  statusError?: Error;
}) {
  getMock.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("/auto-publish/status")) {
      if (opts.statusError) throw opts.statusError;
      return { candidates: opts.status ?? [] };
    }
    return { documents: opts.documents, degraded: null };
  });
  return render(<PromptDocumentList />);
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  patchMock.mockReset();
});

describe("the Publish all changed button", () => {
  it("is absent when coord names no changed documents", async () => {
    renderList({ documents: [summary("policy", "testing")], status: [] });

    await screen.findByTestId("doc-row-policy-testing");
    expect(screen.queryByTestId("publish-all")).not.toBeInTheDocument();
    // And nothing was POSTed: the preview is taken when the dialog opens, not
    // on a page load, so visiting this page issues no write-shaped request.
    expect(postMock).not.toHaveBeenCalled();
  });

  it("counts coord's candidates and does not derive the count from the list", async () => {
    // Four publishable rows, two candidates. Anything counting the LIST would
    // say four — and "Publish all changed (4)" on a corpus with two changed
    // documents is a button that lies about what it is about to do.
    renderList({
      documents: [
        summary("policy", "testing"),
        summary("policy", "coordination"),
        summary("policy", "git-operations"),
        summary("prompt_template", "review"),
      ],
      status: [
        statusEntry("policy", "testing"),
        statusEntry("prompt_template", "review"),
      ],
    });

    expect(await screen.findByTestId("publish-all")).toHaveTextContent(
      "Publish all changed (2)"
    );
  });

  it("retires the whole surface once coord says this is not the system tenant", async () => {
    renderList({
      documents: [summary("policy", "testing")],
      statusError: new Error(
        'GET /api/v1/operations/coord/prompt-documents/auto-publish/status failed: 403 - {"error":"not_system_tenant"}'
      ),
    });

    await screen.findByTestId("doc-row-policy-testing");
    expect(screen.queryByTestId("publish-all")).not.toBeInTheDocument();
    // The per-document mode control goes with it: the mode is meaningful only
    // on system-tenant rows, so the control's only outcome here is a refusal.
    await waitFor(() =>
      expect(
        screen.queryByTestId("doc-publish-mode-policy-testing")
      ).not.toBeInTheDocument()
    );
  });
});

describe("the Publish all changed dialog", () => {
  const openDialog = async (dryRun: PublishAllCandidate[]) => {
    postMock.mockResolvedValueOnce({ dry_run: true, candidates: dryRun });
    await user().click(await screen.findByTestId("publish-all"));
    return screen.findByTestId("publish-all-candidates");
  };

  it("sends each item's expected_version exactly as the dry run returned it", async () => {
    // The row says v2; the dry run says v9. Coord would accept either, so a
    // control that re-read the row would publish a body nobody previewed and
    // nothing downstream would ever report it.
    renderList({
      documents: [summary("policy", "testing", { current_version: 2 })],
      status: [statusEntry("policy", "testing")],
    });
    await openDialog([candidate("policy", "testing", { current_version: 9 })]);

    postMock.mockResolvedValueOnce({
      dry_run: false,
      results: [
        {
          kind: "policy",
          name: "testing",
          outcome: "published",
          publication_version: 1,
        },
      ],
    });
    await user().click(screen.getByTestId("publish-all-confirm"));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    const [, armed] = postMock.mock.calls[1] as [
      string,
      { dry_run: boolean; items: { expected_version: number }[] },
    ];
    expect(armed.dry_run).toBe(false);
    expect(armed.items).toEqual([
      { kind: "policy", name: "testing", expected_version: 9 },
    ]);
  });

  it("states the immutability of a publication before the operator commits", async () => {
    renderList({
      documents: [summary("policy", "testing")],
      status: [statusEntry("policy", "testing")],
    });
    await openDialog([candidate("policy", "testing")]);

    const notice = screen.getByTestId("publish-all-immutability-notice");
    expect(notice).toHaveTextContent(/immutable and is distributed on save/i);
    expect(notice).toHaveTextContent(/publishing again/i);
    // Only the dry run has been sent.
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("groups the lint hits at the top and includes those documents by default", async () => {
    renderList({
      documents: [
        summary("policy", "coordination"),
        summary("policy", "testing"),
      ],
      status: [
        statusEntry("policy", "coordination"),
        statusEntry("policy", "testing"),
      ],
    });
    await openDialog([
      candidate("policy", "coordination", {
        current_version: 22,
        lint: [
          {
            category: "repo_name",
            token: "qontinui-coord",
            line: 3,
            reason: "names a repository specific to this fleet",
          },
        ],
      }),
      candidate("policy", "testing", { current_version: 4 }),
    ]);

    const group = screen.getByTestId("publish-all-lint-group");
    expect(group).toHaveTextContent("qontinui-coord");
    expect(group).toHaveTextContent("policy/coordination");
    // Advisory, not a gate — and the button counts BOTH, so the hit document
    // ships unless the operator says otherwise.
    expect(group).toHaveTextContent(/warning, not a refusal/i);
    expect(screen.getByTestId("publish-all-confirm")).toHaveTextContent(
      "Publish 2 documents"
    );
    expect(
      screen.getByTestId("publish-all-include-policy-coordination")
    ).toBeChecked();
  });

  it("leaves an unticked document out of the armed run", async () => {
    renderList({
      documents: [
        summary("policy", "coordination"),
        summary("policy", "testing"),
      ],
      status: [
        statusEntry("policy", "coordination"),
        statusEntry("policy", "testing"),
      ],
    });
    await openDialog([
      candidate("policy", "coordination", { current_version: 22 }),
      candidate("policy", "testing", { current_version: 4 }),
    ]);

    await user().click(
      screen.getByTestId("publish-all-include-policy-coordination")
    );
    expect(screen.getByTestId("publish-all-confirm")).toHaveTextContent(
      "Publish 1 document"
    );

    postMock.mockResolvedValueOnce({ dry_run: false, results: [] });
    await user().click(screen.getByTestId("publish-all-confirm"));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    const [, armed] = postMock.mock.calls[1] as [
      string,
      { items: { name: string }[] },
    ];
    expect(armed.items).toEqual([
      { kind: "policy", name: "testing", expected_version: 4 },
    ]);
  });

  it("reports a per-item version conflict beside the items that published", async () => {
    // The designed outcome of the guarantee above: one document moved under
    // the operator, the rest still shipped. A batch-level error would report
    // this as "nothing published", which is false and would send the operator
    // to republish work that is already out.
    renderList({
      documents: [
        summary("policy", "coordination"),
        summary("policy", "testing"),
      ],
      status: [
        statusEntry("policy", "coordination"),
        statusEntry("policy", "testing"),
      ],
    });
    await openDialog([
      candidate("policy", "coordination", { current_version: 22 }),
      candidate("policy", "testing", { current_version: 4 }),
    ]);

    postMock.mockResolvedValueOnce({
      dry_run: false,
      results: [
        {
          kind: "policy",
          name: "coordination",
          outcome: "version_conflict",
          expected: 22,
          actual: 23,
        },
        {
          kind: "policy",
          name: "testing",
          outcome: "published",
          publication_version: 2,
        },
      ],
    });
    await user().click(screen.getByTestId("publish-all-confirm"));

    const conflict = await screen.findByTestId(
      "publish-all-result-policy-coordination"
    );
    expect(conflict).toHaveTextContent("version_conflict");
    expect(conflict).toHaveTextContent("You published v22; coord holds v23");
    expect(
      screen.getByTestId("publish-all-result-policy-testing")
    ).toHaveTextContent("publication v2");
  });
});

describe("the auto-publish badges", () => {
  it("names the settle time and which wait applied", async () => {
    renderList({
      documents: [summary("policy", "testing")],
      status: [
        statusEntry("policy", "testing", {
          direction: "loosening",
          settles_at: "2026-09-21T09:00:00Z",
          held: false,
        }),
      ],
    });

    const badge = await screen.findByTestId(
      "doc-auto-publish-settles-policy-testing"
    );
    expect(badge).toHaveTextContent(/^Publishes /);
    // The 24 h / 6 h split is the one fact `settles_at` alone does not carry,
    // and it is the difference between a routine change and a loosening.
    expect(badge).toHaveTextContent("(24 h)");
  });

  it("names the token that is holding a publication, and shows no settle time beside it", async () => {
    renderList({
      documents: [summary("policy", "git-operations")],
      status: [
        statusEntry("policy", "git-operations", {
          direction: "other",
          // Coord may still report when it WOULD have settled. A badge showing
          // both would name a publication that is not going to happen then.
          settles_at: "2026-09-20T15:00:00Z",
          held: true,
          held_tokens: [
            {
              category: "repo_name",
              token: "qontinui-coord",
              line: 2,
              reason: "names a repository specific to this fleet",
            },
          ],
        }),
      ],
    });

    expect(
      await screen.findByTestId("doc-auto-publish-held-policy-git-operations")
    ).toHaveTextContent("Held: qontinui-coord");
    expect(
      screen.queryByTestId("doc-auto-publish-settles-policy-git-operations")
    ).not.toBeInTheDocument();
  });

  it("badges nothing for a document coord did not name as a candidate", async () => {
    // Absent is UNKNOWN, not "nothing scheduled" — the same rule the upstream
    // badge column follows.
    renderList({
      documents: [summary("policy", "settled")],
      status: [],
    });

    await screen.findByTestId("doc-row-policy-settled");
    expect(
      screen.queryByTestId("doc-auto-publish-settles-policy-settled")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("doc-auto-publish-held-policy-settled")
    ).not.toBeInTheDocument();
  });
});

describe("the per-document publish mode", () => {
  it("is offered for a publishable kind and withheld from an Intent kind", async () => {
    renderList({
      documents: [
        summary("policy", "testing"),
        summary("product_intent", "vision"),
      ],
      status: [statusEntry("policy", "testing")],
    });

    expect(
      await screen.findByTestId("doc-publish-mode-policy-testing")
    ).toBeVisible();
    expect(
      screen.queryByTestId("doc-publish-mode-product_intent-vision")
    ).not.toBeInTheDocument();
  });

  it("renders an absent mode as undecided rather than as one of the three", async () => {
    renderList({
      documents: [summary("policy", "testing")],
      status: [statusEntry("policy", "testing")],
    });

    expect(
      await screen.findByTestId("doc-publish-mode-policy-testing")
    ).toHaveTextContent("Publish: undecided");
  });

  it("writes publish_mode on a safe choice, with no confirmation", async () => {
    patchMock.mockResolvedValue({ current_version: 3 });
    renderList({
      documents: [summary("policy", "testing", { publish_mode: "auto" })],
      status: [statusEntry("policy", "testing")],
    });

    await user().click(
      await screen.findByTestId("doc-publish-mode-policy-testing")
    );
    await user().click(
      await screen.findByTestId("doc-publish-mode-never-policy-testing")
    );

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const [url, body] = patchMock.mock.calls[0] as [
      string,
      { publish_mode: string },
    ];
    expect(url).toContain("/coord/prompt-documents/policy/testing");
    expect(body.publish_mode).toBe("never");
  });

  it("confirms auto before writing it, and writes nothing if cancelled", async () => {
    patchMock.mockResolvedValue({ current_version: 3 });
    renderList({
      documents: [summary("policy", "testing", { publish_mode: "manual" })],
      status: [statusEntry("policy", "testing")],
    });

    await user().click(
      await screen.findByTestId("doc-publish-mode-policy-testing")
    );
    await user().click(
      await screen.findByTestId("doc-publish-mode-auto-policy-testing")
    );

    const confirm = await screen.findByTestId("publish-mode-confirm");
    // The sentence that makes this bigger than the inbound dial's `auto`.
    expect(confirm).toHaveTextContent(/cannot be withdrawn/i);
    expect(patchMock).not.toHaveBeenCalled();

    await user().click(screen.getByTestId("publish-mode-confirm-accept"));
    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const [, body] = patchMock.mock.calls[0] as [
      string,
      { publish_mode: string },
    ];
    expect(body.publish_mode).toBe("auto");
  });

  it("shows a mode this build does not know as itself, and closes the picker", async () => {
    renderList({
      documents: [
        summary("policy", "testing", { publish_mode: "on-tuesdays" }),
      ],
      status: [statusEntry("policy", "testing")],
    });

    const trigger = await screen.findByTestId(
      "doc-publish-mode-policy-testing"
    );
    expect(trigger).toHaveTextContent("Publish: on-tuesdays");
    // Moving a control whose current position this build cannot state is how a
    // setting gets changed by accident.
    expect(trigger).toBeDisabled();
  });
});
