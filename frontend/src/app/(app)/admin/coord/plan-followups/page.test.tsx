/**
 * `/admin/coord/plan-followups` — the follow-ups reach the screen, by state.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 * The load-bearing assertion is that the `note` is rendered IN FULL: with no
 * far-end artifact there is nowhere else for the finding to live, and before
 * this route it was prose in a plan body that nothing could query.
 *
 * Plan `2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down`
 * Phase 3 step 6: the state selector reads `?state=`, a `fixing` row shows its
 * PR and age, anchors render as `repo:path[:line]`, and Dismiss sends nothing
 * without a reason — the `dismissed` state's only writer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OpenFollowup, OpenFollowupResponse } from "./followupStatus";

const get = vi.fn();
const post = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plan-followups",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import CoordPlanFollowupsPage from "./page";

const LONG_NOTE =
  "coord's work-unit list door answering 504 on 5 of 8 reads from the web " +
  "backend is a real availability defect with a blast radius well beyond " +
  "this page. This plan makes no backend change and does not fix it; a " +
  "separate plan owns the 504, and until one exists this is the only " +
  "record that the measurement was taken at all.";

function row(over: Partial<OpenFollowup> = {}): OpenFollowup {
  return {
    edge_id: "e1",
    from_id: "a1",
    from_kind: "plan",
    from_slug: "2026-09-20-the-operator-plans-page-reads-the-wrong-store",
    from_title: "The operator's plans page reads the wrong store",
    note: LONG_NOTE,
    created_by: "agent",
    created_at: "2026-08-20T00:00:00Z",
    age_days: 31,
    state: "open",
    anchors: [
      { repo: "acme/widgets", path: "backend/app/a.py", line_start: 17 },
      { repo: "acme/widgets", path: "docs/readme.md" },
    ],
    size_class: "trivial",
    size_class_source: "declared",
    ...over,
  };
}

function response(
  over: Partial<OpenFollowupResponse> = {}
): OpenFollowupResponse {
  return {
    items: [row()],
    count: 1,
    total: 9,
    truncated: true,
    next_cursor: "opaque",
    bound_kind: "exact",
    limit: 50,
    ordering: "oldest_first",
    ...over,
  };
}

const FIXING_ROW = row({
  edge_id: "e-fixing",
  note: "held by an open PR",
  state: "fixing",
  resolution: "fixing",
  resolution_pr: "acme/widgets#1234",
  resolved_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  resolved_by: "agent",
});

/** Route each read by its `state`: the fixing view gets the fixing row. */
function byState(url: string): OpenFollowupResponse {
  if (url.includes("state=fixing")) {
    return response({
      items: [FIXING_ROW],
      total: 1,
      truncated: false,
      next_cursor: null,
    });
  }
  if (url.includes("state=resolved")) {
    return response({
      items: [],
      count: 0,
      total: 0,
      truncated: false,
      next_cursor: null,
    });
  }
  return response();
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("/admin/coord/plan-followups consumes /plan-library/followups", () => {
  it("asks the route by name — it had no consumer before this page", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    await screen.findByTestId("coord-followup");
    const url = String(get.mock.calls[0]?.[0]);
    expect(url).toContain("/api/v1/plan-library/followups");
    expect(url).toContain("state=open");
    expect(url).not.toContain("offset=");
    expect(url).not.toContain("cursor=");
    expect(url).toContain("limit=50");
  });

  it("renders the note IN FULL, not truncated to a headline", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    const note = await screen.findByTestId("coord-followup-note");
    expect(note.textContent).toBe(LONG_NOTE);
    // No ellipsis, no "show more" — the finding has no other home.
    expect(note.textContent).not.toMatch(/…|\.\.\.$/);
    expect(screen.queryByText(/show more/i)).toBeNull();
  });

  it("names the plan that surfaced it, and how long it has gone unowned", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    const followup = await screen.findByTestId("coord-followup");
    expect(followup).toHaveTextContent(
      "2026-09-20-the-operator-plans-page-reads-the-wrong-store"
    );
    expect(screen.getByTestId("coord-followup-age")).toHaveTextContent(
      "31d unowned"
    );
    expect(screen.getByTestId("coord-followup-size")).toHaveTextContent(
      "trivial"
    );
  });

  it("renders each anchor as repo:path[:line]", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    const anchors = await screen.findAllByTestId("coord-followup-anchor");
    expect(anchors.map((a) => a.textContent)).toEqual([
      "acme/widgets:backend/app/a.py:17",
      "acme/widgets:docs/readme.md",
    ]);
  });

  it("says when a follow-up names no file, and why when it says", async () => {
    get.mockResolvedValue(
      response({
        items: [
          row({
            edge_id: "u1",
            anchors: [],
            unanchored_reason: "a process finding",
          }),
          row({ edge_id: "u2", anchors: [] }),
        ],
      })
    );
    render(<CoordPlanFollowupsPage />);

    const unanchored = await screen.findAllByTestId(
      "coord-followup-unanchored"
    );
    expect(unanchored[0]).toHaveTextContent("a process finding");
    expect(unanchored[1]).toHaveTextContent("no diff can match it");
  });

  it("reports the window and the DECLARED oldest-first ordering", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    const window = await screen.findByTestId("coord-followups-window");
    expect(window).toHaveTextContent("Showing 1 of 9");
    expect(screen.getByTestId("coord-followups-ordering")).toHaveTextContent(
      "oldest_first"
    );
    expect(
      screen.queryByTestId("coord-followups-ordering-unexpected")
    ).toBeNull();
  });

  it("withdraws the oldest-first reading when the route declares another", async () => {
    get.mockResolvedValue(response({ ordering: "newest_first" }));
    render(<CoordPlanFollowupsPage />);

    expect(
      await screen.findByTestId("coord-followups-ordering-unexpected")
    ).toHaveTextContent("not the");
  });

  it("says an empty open view is 'nothing UNOWNED', not 'nothing surfaced'", async () => {
    get.mockResolvedValue(response({ items: [], count: 0, total: 0 }));
    render(<CoordPlanFollowupsPage />);

    const empty = await screen.findByTestId("coord-followups-empty");
    expect(empty).toHaveTextContent(
      "claimed or resolved follow-up drops out of the open view"
    );
    expect(empty).toHaveTextContent("without being deleted");
    expect(empty).toHaveTextContent("no plan surfaced any follow-up");
  });

  it("states that a claimed or resolved follow-up drops out of the open view", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    expect(
      await screen.findByTestId("coord-followups-semantics")
    ).toHaveTextContent(
      "A claimed or resolved follow-up drops out of the open view"
    );
  });

  it("reads a failed request as UNKNOWN, never as an empty queue", async () => {
    get.mockRejectedValue(new Error("GET /x failed: 503 - upstream"));
    render(<CoordPlanFollowupsPage />);

    expect(
      await screen.findByTestId("coord-followups-unknown")
    ).toHaveTextContent("unknown, not none");
    expect(screen.queryByTestId("coord-followups-empty")).toBeNull();
  });

  it("links back to the candidates that carry these along", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    expect(
      await screen.findByTestId("coord-followups-candidates-link")
    ).toHaveAttribute("href", "/admin/coord/plan-candidates");
  });
});

describe("the state selector", () => {
  it("sends state=fixing when Fixing is chosen", async () => {
    const user = userEvent.setup();
    get.mockImplementation((url: string) => Promise.resolve(byState(url)));
    render(<CoordPlanFollowupsPage />);
    await screen.findByTestId("coord-followup");

    await user.click(screen.getByTestId("coord-followups-view-fixing"));
    await waitFor(() =>
      expect(
        get.mock.calls.some(
          ([url]) =>
            String(url).includes("state=fixing") &&
            String(url).includes("limit=50")
        )
      ).toBe(true)
    );
  });

  it("renders a fixing row with its PR and how long it has been fixing", async () => {
    const user = userEvent.setup();
    get.mockImplementation((url: string) => Promise.resolve(byState(url)));
    render(<CoordPlanFollowupsPage />);
    await screen.findByTestId("coord-followup");

    await user.click(screen.getByTestId("coord-followups-view-fixing"));
    const fixing = await screen.findByTestId("coord-followup-fixing");
    expect(fixing).toHaveTextContent("acme/widgets#1234");
    expect(screen.getByTestId("coord-followup-pr")).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/pull/1234"
    );
    expect(screen.getByTestId("coord-followup-fixing-age")).toHaveTextContent(
      "for 3d"
    );
    // A fixing row is held by its PR: it offers no Dismiss.
    expect(screen.queryByTestId("coord-followup-dismiss")).toBeNull();
  });

  it("carries a live count on every tab, from the other views' reads", async () => {
    get.mockImplementation((url: string) => Promise.resolve(byState(url)));
    render(<CoordPlanFollowupsPage />);
    await screen.findByTestId("coord-followup");

    await waitFor(() =>
      expect(
        screen.getByTestId("coord-followups-view-fixing")
      ).toHaveTextContent("1")
    );
    expect(screen.getByTestId("coord-followups-view-open")).toHaveTextContent(
      "9"
    );
    expect(
      screen.getByTestId("coord-followups-view-resolved")
    ).toHaveTextContent("0");
  });
});

describe("Dismiss", () => {
  it("sends nothing while the reason is blank", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    await user.click(await screen.findByTestId("coord-followup-dismiss"));
    await user.type(screen.getByTestId("coord-followup-dismiss-reason"), "   ");
    const confirm = screen.getByTestId("coord-followup-dismiss-confirm");
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(post).not.toHaveBeenCalled();
  });

  it("posts the dismissed resolution with the reason, then re-reads", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(response());
    post.mockResolvedValue({
      changed: true,
      followup: row({ state: "dismissed" }),
    });
    render(<CoordPlanFollowupsPage />);

    await user.click(await screen.findByTestId("coord-followup-dismiss"));
    await user.type(
      screen.getByTestId("coord-followup-dismiss-reason"),
      "superseded by the rewrite"
    );
    const readsBefore = get.mock.calls.length;
    await user.click(screen.getByTestId("coord-followup-dismiss-confirm"));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      "/api/v1/plan-library/edges/e1/resolution",
      { resolution: "dismissed", resolution_note: "superseded by the rewrite" }
    );
    await waitFor(() =>
      expect(get.mock.calls.length).toBeGreaterThan(readsBefore)
    );
  });

  it("shows a refused dismissal instead of swallowing it", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(response());
    post.mockRejectedValue(
      new Error("POST failed: 409 - followup_transition_conflict")
    );
    render(<CoordPlanFollowupsPage />);

    await user.click(await screen.findByTestId("coord-followup-dismiss"));
    await user.type(
      screen.getByTestId("coord-followup-dismiss-reason"),
      "stale"
    );
    await user.click(screen.getByTestId("coord-followup-dismiss-confirm"));

    expect(
      await screen.findByTestId("coord-followup-dismiss-error")
    ).toHaveTextContent("409");
  });
});
