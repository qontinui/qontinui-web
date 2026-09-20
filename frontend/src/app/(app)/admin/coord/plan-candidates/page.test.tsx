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
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

  it("dates the empty copy once a later read over the same window fails", async () => {
    // The third arm the two older coord lists carry. A poll deliberately does
    // not blank a loaded page, so `data` stays non-null — which left the
    // present-tense "No unshipped plan in this window." on screen while the
    // read was currently failing.
    const user = userEvent.setup();
    let call = 0;
    get.mockImplementation(async () => {
      call += 1;
      if (call === 1) return response({ items: [] });
      throw new Error("coord unreachable");
    });
    render(<CoordPlanCandidatesPage />);

    await screen.findByTestId("coord-candidates-empty");
    await user.click(screen.getByTestId("coord-candidates-refresh"));

    const stale = await screen.findByTestId("coord-candidates-stale");
    expect(stale).toHaveTextContent(/at the last good read/i);
    expect(screen.queryByTestId("coord-candidates-empty")).toBeNull();
  });

  it("renders a row with no document_state as UNKNOWN, never as ready", async () => {
    // The field is optional on the wire. Defaulting it to `present` walked
    // the confident arm on the strength of a field nobody served.
    get.mockResolvedValue(
      response({
        items: [candidate({ document_state: undefined, unmet_depends_on: [] })],
      })
    );
    render(<CoordPlanCandidatesPage />);

    const readiness = await screen.findByTestId("coord-candidate-readiness");
    expect(readiness).toHaveAttribute("data-readiness", "unknown");
    expect(
      screen.getByTestId("coord-candidate-document-state")
    ).toHaveAttribute("data-document-state", "unstated");
    expect(screen.getByTestId("coord-candidate-reason")).toHaveTextContent(
      /UNKNOWN/
    );
  });

  it("renders a row with no coord block as UNKNOWN on both halves", async () => {
    get.mockResolvedValue(
      response({ items: [candidate({ coord: undefined })] })
    );
    render(<CoordPlanCandidatesPage />);

    const cell = await screen.findByTestId("coord-candidate-coord");
    expect(cell).toHaveAttribute("data-unknown", "true");
    expect(cell).not.toHaveTextContent("no unit link");
  });

  it("does not call an ABSENT open_followups list 'no open follow-up'", async () => {
    // A backend not carrying the field has said nothing. The total beside it
    // already renders `–`, so a measured-zero sentence next to it would make
    // one paragraph disagree with itself.
    get.mockResolvedValue(
      response({ open_followups: undefined, open_followup_total: undefined })
    );
    render(<CoordPlanCandidatesPage />);

    const unstated = await screen.findByTestId(
      "coord-candidates-followups-unstated"
    );
    expect(unstated).toHaveTextContent("UNKNOWN — not none");
    expect(screen.queryByTestId("coord-candidates-followups-empty")).toBeNull();
    expect(
      screen.getByTestId("coord-candidates-followup-total")
    ).toHaveTextContent("–");
  });
});

/**
 * The request-generation guard, lifted into `useGuardedPoll`.
 *
 * This page has a window control, so both races that hook documents are
 * reachable here — and neither was guarded before the review. The subtler one
 * is pinned first: a superseded SUCCESS landing on top of a newer FAILURE
 * clears the banner, flips `loaded` true, and states a discarded window as a
 * confident answer to a question that errored.
 */
describe("a superseded read may not speak", () => {
  /** Route by the `limit` on the wire — never by call order. */
  function routeByLimit(handlers: {
    first: () => unknown;
    switched: () => unknown;
  }) {
    get.mockImplementation(async (url: string) =>
      url.includes("limit=100") ? handlers.switched() : handlers.first()
    );
  }

  async function switchPageSize(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId("coord-candidates-page-size-select"));
    await user.click(
      await screen.findByRole("option", { name: "100 per page" })
    );
  }

  /**
   * `waitFor` invokes its callback synchronously on entry, so a negative
   * assertion straight after a `resolve()` would pass before the
   * continuation had a chance to run — green whether or not the guard exists.
   */
  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("does not let a late success clear the banner of a newer failure", async () => {
    let releaseFirstRead: ((body: unknown) => void) | undefined;
    routeByLimit({
      first: () =>
        new Promise((resolve) => {
          releaseFirstRead = resolve;
        }),
      switched: () => {
        throw new Error("coord unreachable");
      },
    });
    const user = userEvent.setup();
    render(<CoordPlanCandidatesPage />);

    await switchPageSize(user);
    await screen.findByTestId("coord-candidates-unknown");

    releaseFirstRead?.(response());
    await flushMicrotasks();

    // The failure still speaks, and the discarded window did not repaint.
    expect(screen.getByTestId("coord-candidates-error")).toBeInTheDocument();
    expect(screen.getByTestId("coord-candidates-unknown")).toBeInTheDocument();
    expect(screen.queryByTestId("coord-candidate-row")).toBeNull();
  });

  it("does not repaint the discarded window when the old read lands late", async () => {
    let releaseFirstRead: ((body: unknown) => void) | undefined;
    routeByLimit({
      first: () =>
        new Promise((resolve) => {
          releaseFirstRead = resolve;
        }),
      switched: () => response({ items: [] }),
    });
    const user = userEvent.setup();
    render(<CoordPlanCandidatesPage />);

    await switchPageSize(user);
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(expect.stringContaining("limit=100"))
    );
    await screen.findByTestId("coord-candidates-empty");

    releaseFirstRead?.(response());
    await flushMicrotasks();

    expect(screen.queryByTestId("coord-candidate-row")).toBeNull();
    expect(screen.getByTestId("coord-candidates-empty")).toBeInTheDocument();
  });
});
