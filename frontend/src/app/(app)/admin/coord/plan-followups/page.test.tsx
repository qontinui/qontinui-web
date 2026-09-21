/**
 * `/admin/coord/plan-followups` — the unowned queue reaches the screen.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 * The load-bearing assertion is that the `note` is rendered IN FULL: with no
 * far-end artifact there is nowhere else for the finding to live, and before
 * this route it was prose in a plan body that nothing could query.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OpenFollowupResponse } from "./followupStatus";

const get = vi.fn();

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
    post: vi.fn(),
  },
}));

import CoordPlanFollowupsPage from "./page";

const LONG_NOTE =
  "coord's work-unit list door answering 504 on 5 of 8 reads from the web " +
  "backend is a real availability defect with a blast radius well beyond " +
  "this page. This plan makes no backend change and does not fix it; a " +
  "separate plan owns the 504, and until one exists this is the only " +
  "record that the measurement was taken at all.";

function response(
  over: Partial<OpenFollowupResponse> = {}
): OpenFollowupResponse {
  return {
    items: [
      {
        edge_id: "e1",
        from_id: "a1",
        from_kind: "plan",
        from_slug: "2026-09-20-the-operator-plans-page-reads-the-wrong-store",
        from_title: "The operator's plans page reads the wrong store",
        note: LONG_NOTE,
        created_by: "agent",
        created_at: "2026-08-20T00:00:00Z",
        age_days: 31,
      },
    ],
    count: 1,
    total: 9,
    offset: 0,
    limit: 50,
    ordering: "oldest_first",
    ...over,
  };
}

beforeEach(() => {
  get.mockReset();
});

describe("/admin/coord/plan-followups consumes /plan-library/followups", () => {
  it("asks the route by name — it had no consumer before this page", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanFollowupsPage />);

    await screen.findByTestId("coord-followup");
    const url = String(get.mock.calls[0]?.[0]);
    expect(url).toContain("/api/v1/plan-library/followups");
    expect(url).toContain("offset=0");
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

    const row = await screen.findByTestId("coord-followup");
    expect(row).toHaveTextContent(
      "2026-09-20-the-operator-plans-page-reads-the-wrong-store"
    );
    expect(screen.getByTestId("coord-followup-age")).toHaveTextContent(
      "31d unowned"
    );
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

  it("says an empty queue is 'nothing UNOWNED', not 'nothing surfaced'", async () => {
    get.mockResolvedValue(response({ items: [], count: 0, total: 0 }));
    render(<CoordPlanFollowupsPage />);

    const empty = await screen.findByTestId("coord-followups-empty");
    expect(empty).toHaveTextContent("without being deleted");
    expect(empty).toHaveTextContent("no plan surfaced any follow-up");
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
