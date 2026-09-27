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
    latest_publication_version: null,
    lint: [],
    direction: "other",
    publish_mode: "manual",
    edited_by: "agent:runner",
    versions_since_publication: [],
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
  /** Coord's own `count`. Omitted ⇒ the candidate array's length. */
  statusCount?: number;
  statusError?: Error;
  /** Coord's resolved D5 switch. Omitted ⇒ not served (UNKNOWN). */
  publishingEnabled?: boolean;
}) {
  getMock.mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("/auto-publish/status")) {
      if (opts.statusError) throw opts.statusError;
      const candidates = opts.status ?? [];
      const switchState =
        opts.publishingEnabled === undefined
          ? {}
          : { publishing_enabled: opts.publishingEnabled };
      return opts.statusCount === undefined
        ? { candidates, count: candidates.length, ...switchState }
        : { candidates, count: opts.statusCount, ...switchState };
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

  it("counts with coord's own `count`, not with the array it happened to send", async () => {
    // If the two disagree, the array is the thing that got truncated — and a
    // button that under-reports the batch is one an operator stops trusting.
    renderList({
      documents: [summary("policy", "testing")],
      status: [statusEntry("policy", "testing")],
      statusCount: 26,
    });

    expect(await screen.findByTestId("publish-all")).toHaveTextContent(
      "Publish all changed (26)"
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

  it("renders the change notes out of coord's version ROWS, not as raw objects", async () => {
    // `versions_since_publication` is `[{version_number, change_note,
    // edited_by, created_at, loosening?}]`, not a string array — the plan's
    // prose ("the change notes of every version") reads like the latter. A
    // `join` over the rows prints "[object Object]"; a `join` over the notes
    // without filtering prints the word "null" for a version saved without
    // one. Both land in the one line an operator reads before sending a body
    // to every tenant.
    renderList({
      documents: [summary("policy", "testing")],
      status: [statusEntry("policy", "testing")],
    });
    await openDialog([
      candidate("policy", "testing", {
        versions_since_publication: [
          {
            version_number: 6,
            change_note: "retired the same-actor rule",
            edited_by: "agent:runner",
            created_at: "2026-09-19T08:00:00Z",
            loosening: true,
          },
          // No note at all. Ordinary, and must not print as "null".
          {
            version_number: 7,
            change_note: null,
            edited_by: "operator@example.com",
            created_at: "2026-09-19T09:00:00Z",
            loosening: null,
          },
        ],
      }),
    ]);

    const row = screen.getByTestId("publish-all-row-policy-testing");
    expect(row).toHaveTextContent("retired the same-actor rule");
    expect(row).not.toHaveTextContent("[object Object]");
    expect(row).not.toHaveTextContent("null");
  });

  it("says whether the fleet fan-out actually started", async () => {
    // A batch that published nothing and a batch whose fan-out was lost look
    // identical from outside, and the lost one logs nothing at all.
    renderList({
      documents: [summary("policy", "testing")],
      status: [statusEntry("policy", "testing")],
    });
    await openDialog([candidate("policy", "testing")]);

    postMock.mockResolvedValueOnce({
      dry_run: false,
      published: 1,
      requested: 1,
      results: [
        {
          kind: "policy",
          name: "testing",
          outcome: "published",
          publication_version: 1,
        },
      ],
      fan_out: "spawned",
    });
    await user().click(screen.getByTestId("publish-all-confirm"));

    expect(await screen.findByTestId("publish-all-fan-out")).toHaveTextContent(
      /Distribution to the fleet has started/i
    );
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

  it("badges nothing on a manual document, whatever coord says would settle", async () => {
    // Coord serves `settles_at` and `held` for every candidate, because
    // publish-all can publish a manual document by hand. The worker never
    // will, so a "Publishes <time>" here names a publication nothing makes.
    renderList({
      documents: [summary("policy", "coordination")],
      status: [
        statusEntry("policy", "coordination", {
          publish_mode: "manual",
          direction: "other",
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

    await screen.findByTestId("doc-row-policy-coordination");
    for (const id of ["settles", "held", "paused"]) {
      expect(
        screen.queryByTestId(`doc-auto-publish-${id}-policy-coordination`)
      ).not.toBeInTheDocument();
    }
  });

  it("follows undecided_default for an undecided document", async () => {
    renderList({
      documents: [
        summary("policy", "testing"),
        summary("policy", "coordination"),
      ],
      status: [
        statusEntry("policy", "testing", {
          publish_mode: null,
          undecided_default: "auto",
          direction: "other",
          settles_at: "2026-09-21T09:00:00Z",
        }),
        statusEntry("policy", "coordination", {
          publish_mode: null,
          undecided_default: "manual",
          direction: "other",
          settles_at: "2026-09-21T09:00:00Z",
        }),
      ],
    });

    expect(
      await screen.findByTestId("doc-auto-publish-settles-policy-testing")
    ).toHaveTextContent("(6 h)");
    expect(
      screen.queryByTestId("doc-auto-publish-settles-policy-coordination")
    ).not.toBeInTheDocument();
  });

  it("re-reads the status when the page bumps its refresh key, and not on mount", async () => {
    const { rerender } = renderList({
      documents: [summary("policy", "testing")],
      status: [statusEntry("policy", "testing")],
    });
    await screen.findByTestId("doc-row-policy-testing");
    const statusReads = () =>
      getMock.mock.calls.filter(([url]) =>
        String(url).includes("/auto-publish/status")
      ).length;
    await waitFor(() => expect(statusReads()).toBe(1));

    rerender(<PromptDocumentList autoPublishRefreshKey={1} />);

    await waitFor(() => expect(statusReads()).toBe(2));
  });

  it("keeps the ordinary schedule when coord says the switch is on", async () => {
    renderList({
      documents: [summary("policy", "testing")],
      publishingEnabled: true,
      status: [
        statusEntry("policy", "testing", {
          direction: "other",
          settles_at: "2026-09-21T09:00:00Z",
        }),
      ],
    });

    expect(
      await screen.findByTestId("doc-auto-publish-settles-policy-testing")
    ).toHaveTextContent(/^Publishes /);
  });

  it("turns a hold into the off badge too, naming what it would hold on", async () => {
    renderList({
      documents: [summary("policy", "git-operations")],
      publishingEnabled: false,
      status: [
        statusEntry("policy", "git-operations", {
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

    const badge = await screen.findByTestId(
      "doc-auto-publish-paused-policy-git-operations"
    );
    expect(badge).toHaveTextContent("Auto-publish off");
    expect(badge.getAttribute("title")).toMatch(/would be held/);
    expect(
      screen.queryByTestId("doc-auto-publish-held-policy-git-operations")
    ).not.toBeInTheDocument();
  });

  it("says auto-publish is off rather than promising a time while the switch is off", async () => {
    renderList({
      documents: [summary("policy", "testing")],
      publishingEnabled: false,
      status: [
        statusEntry("policy", "testing", {
          direction: "loosening",
          settles_at: "2026-09-21T09:00:00Z",
        }),
      ],
    });

    expect(
      await screen.findByTestId("doc-auto-publish-paused-policy-testing")
    ).toHaveTextContent("Auto-publish off");
    expect(
      screen.queryByTestId("doc-auto-publish-settles-policy-testing")
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

  it("re-reads the status after a mode write, so a stale schedule does not linger", async () => {
    const entry = statusEntry("policy", "testing", {
      settles_at: "2026-09-21T09:00:00Z",
      direction: "other",
    });
    // Coord's answer changes with the write: the next status read serves the
    // new mode, and only a re-read can take the badge away.
    patchMock.mockImplementation(async () => {
      entry.publish_mode = "never";
      return { current_version: 3 };
    });
    renderList({
      documents: [summary("policy", "testing", { publish_mode: "auto" })],
      status: [entry],
    });
    await screen.findByTestId("doc-auto-publish-settles-policy-testing");

    await user().click(screen.getByTestId("doc-publish-mode-policy-testing"));
    await user().click(
      await screen.findByTestId("doc-publish-mode-never-policy-testing")
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("doc-auto-publish-settles-policy-testing")
      ).not.toBeInTheDocument()
    );
  });

  it("keeps only the newest status answer when two reads overlap", async () => {
    // First read (mount) answers late with the switch OFF; the second (a
    // refresh) answers first with it ON. The late, older answer must not win.
    let releaseFirst: (value: unknown) => void = () => {};
    let statusCalls = 0;
    const entry = statusEntry("policy", "testing", {
      settles_at: "2026-09-21T09:00:00Z",
      direction: "other",
    });
    getMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/auto-publish/status")) {
        statusCalls += 1;
        if (statusCalls === 1) {
          return new Promise((resolve) => {
            releaseFirst = resolve;
          });
        }
        return { candidates: [entry], count: 1, publishing_enabled: true };
      }
      return { documents: [summary("policy", "testing")], degraded: null };
    });
    const { rerender } = render(<PromptDocumentList />);
    await screen.findByTestId("doc-row-policy-testing");
    rerender(<PromptDocumentList autoPublishRefreshKey={1} />);
    await screen.findByTestId("doc-auto-publish-settles-policy-testing");

    releaseFirst({ candidates: [entry], count: 1, publishing_enabled: false });
    // Give the stale answer every chance to land before asserting it did not.
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.getByTestId("doc-auto-publish-settles-policy-testing")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("doc-auto-publish-paused-policy-testing")
    ).not.toBeInTheDocument();
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

  it("names what coord will decide for an undecided document", async () => {
    // "Something will be decided" and "`manual` will be set" are different
    // facts, and only the second says whether the operator needs to act before
    // the next worker pass — the only moment acting is cheap. Coord serves the
    // answer; deriving it here would need a browser copy of its carve-out list
    // and its five lint patterns.
    renderList({
      documents: [summary("policy", "security-and-autonomy")],
      status: [
        statusEntry("policy", "security-and-autonomy", {
          publish_mode: null,
          undecided_default: "manual",
        }),
      ],
    });

    const trigger = await screen.findByTestId(
      "doc-publish-mode-policy-security-and-autonomy"
    );
    expect(trigger).toHaveTextContent("Publish: undecided");
    expect(trigger.getAttribute("title") ?? "").toContain(
      'will set it to "manual"'
    );
  });

  it("reads a refused write as a pending migration, not as a coord fault", async () => {
    // Coord's READS of `publish_mode` degrade on a missing column and answer
    // UNDECIDED; the WRITE deliberately does not, because an authority
    // decision the schema cannot hold must not look like it was saved. So this
    // 500 is expected during the `pdpub_03` deploy window, and it has to read
    // that way — a bare "failed to save" toast sends an operator to debug a
    // system behaving exactly as designed, and vanishes before they can act.
    patchMock.mockRejectedValue(
      new Error(
        "PATCH /api/v1/operations/coord/prompt-documents/policy/testing failed: 500 - " +
          'db error: ERROR: column "publish_mode" of relation "prompt_documents" does not exist'
      )
    );
    renderList({
      documents: [summary("policy", "testing", { publish_mode: "manual" })],
      status: [statusEntry("policy", "testing")],
    });

    await user().click(
      await screen.findByTestId("doc-publish-mode-policy-testing")
    );
    await user().click(
      await screen.findByTestId("doc-publish-mode-never-policy-testing")
    );

    const banner = await screen.findByTestId("publish-mode-schema-pending");
    expect(banner).toHaveTextContent(/cannot record a publish mode yet/i);
    expect(banner).toHaveTextContent("pdpub_03");
    // Coord's own words are carried, not swallowed.
    expect(banner).toHaveTextContent(/does not exist/);
    // And the control STAYS: the migration lands during this page's life, and
    // retiring it would leave no route to the setting when it does.
    expect(
      screen.getByTestId("doc-publish-mode-policy-testing")
    ).toBeInTheDocument();
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
