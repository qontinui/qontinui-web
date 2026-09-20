/**
 * `/admin/coord/plan-candidates` — the candidate list reaches the screen.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 * `candidateStatus.test.ts` pins the derivations; what is pinned here is the
 * absent-`corpus_health` arm (a ranking drawn from a corpus we could not
 * characterise), the `open_followups` that ride along, and that a
 * work-unit-only row's empty dependency list never renders as "ready".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlanCandidate, PlanCandidateResponse } from "./candidateStatus";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plan-candidates",
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

import CoordPlanCandidatesPage from "./page";

function candidate(over: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "plan",
    slug: "2026-09-05-every-bounded-read",
    title: "Every bounded read",
    status: "vetted",
    document_state: "present",
    age_days: 15,
    last_touched: "2026-09-18T00:00:00Z",
    unmet_depends_on: [],
    prompt_chain: [],
    coord: { work_unit_state: "linked", linked_prs_state: "available" },
    ...over,
  };
}

function response(
  over: Partial<PlanCandidateResponse> = {}
): PlanCandidateResponse {
  return {
    items: [candidate()],
    count: 1,
    total: 606,
    offset: 0,
    limit: 25,
    ordering: "oldest_vetted_first",
    coord_available: true,
    work_unit_population_state: "included",
    work_unit_population_reason: null,
    open_followups: [],
    open_followup_total: 0,
    corpus_health: {
      artifact_count: 2100,
      plan_count: 1887,
      newest_updated_at: "2026-09-20T09:00:00Z",
      capture: {
        total: 1887,
        doors: [
          { captured_by: "runner_scan", count: 1887, known: true },
          { captured_by: "agent", count: 0, known: true },
          { captured_by: "operator", count: 0, known: true },
        ],
        newest_updated_at: "2026-09-20T09:00:00Z",
      },
      scan_roots: { state: "reported", count: 3, fresh_count: 2 },
    },
    corpus_health_unavailable_reason: null,
    ...over,
  };
}

beforeEach(() => {
  get.mockReset();
});

describe("/admin/coord/plan-candidates consumes /plan-library/candidates", () => {
  it("asks the route by name — it had no consumer before this page", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanCandidatesPage />);

    await screen.findByTestId("coord-candidate-row");
    const url = String(get.mock.calls[0]?.[0]);
    expect(url).toContain("/api/v1/plan-library/candidates");
    expect(url).toContain("offset=0");
    expect(url).toContain("limit=25");
  });

  it("renders the declared ordering and never invents a score control", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanCandidatesPage />);

    expect(
      await screen.findByTestId("coord-candidates-ordering")
    ).toHaveTextContent("oldest_vetted_first");
    const page = screen.getByTestId("coord-plan-candidates-page");
    expect(page).not.toHaveTextContent(/sort by (score|priority)/i);
  });

  it("renders a work-unit-only row as UNKNOWN, never as ready", async () => {
    get.mockResolvedValue(
      response({
        items: [
          candidate({
            id: null,
            document_state: "unsynced",
            unmet_depends_on: [],
          }),
        ],
      })
    );
    render(<CoordPlanCandidatesPage />);

    const badge = await screen.findByTestId("coord-candidate-readiness");
    expect(badge).toHaveAttribute("data-readiness", "unknown");
    expect(badge).toHaveTextContent("blockers not looked at");
    expect(
      screen.getByTestId("coord-candidate-document-state")
    ).toHaveAttribute("data-document-state", "unsynced");
  });

  it("says why the dependency list is empty on such a row", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(
      response({
        items: [candidate({ id: null, document_state: "absent" })],
      })
    );
    render(<CoordPlanCandidatesPage />);

    const row = await screen.findByTestId("coord-candidate-row");
    await user.click(within(row).getByRole("button"));
    expect(
      await screen.findByTestId("coord-candidate-unmet-empty")
    ).toHaveTextContent("UNKNOWN, not unblocked");
  });

  it("keeps 'PRs unreadable' from reading as 'this plan has no PRs'", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(
      response({
        coord_available: false,
        items: [
          candidate({
            coord: {
              work_unit_state: "unavailable",
              linked_prs_state: "unavailable",
              unavailable_reason: "coord returned 504",
            },
          }),
        ],
      })
    );
    render(<CoordPlanCandidatesPage />);

    const row = await screen.findByTestId("coord-candidate-row");
    await user.click(within(row).getByRole("button"));
    const prs = await screen.findByTestId("coord-candidate-prs");
    expect(prs).toHaveTextContent("PRs unreadable");
    expect(prs).toHaveTextContent("UNKNOWN");
  });

  it("discloses the corpus its ranking inputs came from", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanCandidatesPage />);

    expect(
      await screen.findByTestId("coord-candidates-disclosure-corpus-health")
    ).toHaveTextContent("ranks the corpus, not the work");
  });

  it("renders the ABSENT corpus_health arm with its reason verbatim", async () => {
    get.mockResolvedValue(
      response({
        corpus_health: null,
        corpus_health_unavailable_reason:
          "read_failed: the corpus health block could not be read (OperationalError); the candidates are unaffected, and a null block is UNKNOWN, not healthy.",
      })
    );
    render(<CoordPlanCandidatesPage />);

    const line = await screen.findByTestId(
      "coord-candidates-disclosure-corpus-health"
    );
    expect(line).toHaveTextContent("UNKNOWN");
    expect(
      within(line).getByTestId(
        "coord-candidates-disclosure-corpus-health-items"
      )
    ).toHaveTextContent("OperationalError");
    // And the candidates themselves are unaffected — the block is report-only.
    expect(screen.getByTestId("coord-candidate-row")).toBeInTheDocument();
  });

  it("states the population BEFORE the total, and dashes the count on the degraded arm", async () => {
    get.mockResolvedValue(
      response({
        work_unit_population_state: "unavailable",
        work_unit_population_reason: "coord returned 504: non-JSON body",
        total: 13,
      })
    );
    render(<CoordPlanCandidatesPage />);

    const population = await screen.findByTestId(
      "coord-candidates-disclosure-population"
    );
    expect(population).toHaveAttribute("data-level", "critical");
    expect(population).toHaveTextContent("2% view");
    expect(
      screen.getByTestId("coord-candidates-total-unknown")
    ).toHaveTextContent("document layer alone");
    expect(
      screen.getByTestId("coord-plan-candidates-health")
    ).toHaveTextContent("candidates –");
  });

  it("surfaces open_followups in full, with the unpaged total beside them", async () => {
    get.mockResolvedValue(
      response({
        open_followup_total: 9,
        open_followups: [
          {
            edge_id: "e1",
            from_id: "a1",
            from_kind: "plan",
            from_slug: "2026-08-16-plan-corpus-authority",
            from_title: "Plan corpus authority",
            note: "The 504 on coord's work-unit list door is a real availability defect with a blast radius well beyond this page, and it wants a plan of its own.",
            created_at: "2026-08-20T00:00:00Z",
            age_days: 31,
          },
        ],
      })
    );
    render(<CoordPlanCandidatesPage />);

    const followup = await screen.findByTestId("coord-candidates-followup");
    // In FULL: the note is the whole payload and has no other home.
    expect(followup).toHaveTextContent(
      "blast radius well beyond this page, and it wants a plan of its own"
    );
    expect(followup).toHaveTextContent("2026-08-16-plan-corpus-authority");
    // A bounded list must never read as the queue.
    expect(
      screen.getByTestId("coord-candidates-followup-total")
    ).toHaveTextContent("9");
    expect(
      screen.getByTestId("coord-candidates-followups-link")
    ).toHaveAttribute("href", "/admin/coord/plan-followups");
  });

  it("says a page carrying none of N open follow-ups is not an empty queue", async () => {
    get.mockResolvedValue(
      response({ open_followups: [], open_followup_total: 9 })
    );
    render(<CoordPlanCandidatesPage />);

    expect(
      await screen.findByTestId("coord-candidates-followups-empty")
    ).toHaveTextContent("carried none of the 9 open follow-ups");
  });

  it("composes the capture census from corpus_health, zero doors included", async () => {
    get.mockResolvedValue(response());
    render(<CoordPlanCandidatesPage />);

    const doors = await screen.findAllByTestId("coord-capture-door");
    expect(doors).toHaveLength(3);
    expect(
      doors.filter((d) => d.getAttribute("data-silent") === "true")
    ).toHaveLength(2);
  });

  it("reads a failed request as UNKNOWN, never as an empty backlog", async () => {
    get.mockRejectedValue(new Error("GET /x failed: 503 - upstream"));
    render(<CoordPlanCandidatesPage />);

    expect(
      await screen.findByTestId("coord-candidates-unknown")
    ).toHaveTextContent("unknown, not none");
    expect(screen.queryByTestId("coord-candidates-empty")).toBeNull();
  });
});
