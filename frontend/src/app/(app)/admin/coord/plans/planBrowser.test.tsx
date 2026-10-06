/**
 * `/admin/coord/plans` as the one Plan Browser — the page-level half of plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phases 1-6.
 *
 * The pure readings are pinned beside their modules (`statusClass.test.ts`,
 * `custody.test.ts`, `deriveMode.test.ts`, `throughput.test.ts`,
 * `rowFilters.test.ts`, `corpusHealth.test.ts`); what is pinned HERE is that
 * the page sends the right question and puts each reading on screen,
 * including every UNKNOWN arm.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ReconciliationResponse,
  ReconciliationRowData,
} from "@/components/admin/coord/planReconciliationStatus";

/** url-substring → answer (a value, an Error to reject with, or a function). */
type Answer = unknown | Error | ((url: string) => unknown);
let answers: Array<[string, Answer]> = [];
const get = vi.fn((url: string) => {
  const hit = answers.find(([path]) => url.includes(path));
  if (!hit) return Promise.reject(new Error(`unrouted ${url}`));
  const a =
    typeof hit[1] === "function"
      ? (hit[1] as (u: string) => unknown)(url)
      : hit[1];
  return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plans",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (url: string) => get(url),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));
// The two imported corpus-health panels own their reads and their tests; here
// they are stand-ins so opening the strip asserts placement, not their body.
vi.mock("../plan-library/_components/ScanSourcesPanel", () => ({
  ScanSourcesPanel: () => <div data-testid="stub-scan-sources" />,
}));
vi.mock("../plan-library/_components/PlanCoveragePanel", () => ({
  PlanCoveragePanel: () => <div data-testid="stub-plan-coverage" />,
}));

import CoordPlansListPage from "./page";

function row(over: Partial<ReconciliationRowData> = {}): ReconciliationRowData {
  return {
    slug: "2026-09-05-a-draft-plan",
    title: "A draft plan",
    artifact_id: "art-1",
    document_state: "present",
    document_axis_complete: true,
    axis_a: {
      readable: true,
      present: true,
      status: "draft",
      status_class: "free_known",
      vet_state: null,
      live_sessions: [],
      custody_resolved: true,
    },
    axis_b: {
      readable: true,
      present: true,
      status: "draft",
      document_state: "present",
      complete: true,
    },
    axis_c: { readable: true, present: true, computed: false },
    classification: "AGREE_OPEN",
    verdict: "agree",
    reason: "both say draft",
    ...over,
  };
}

function body(
  over: Partial<ReconciliationResponse> = {}
): ReconciliationResponse {
  return {
    items: [row()],
    total: 1,
    offset: 0,
    limit: 25,
    ordering: "slug_asc",
    document_axis_source: "artifact_store",
    document_axis_complete: true,
    document_present_count: 1,
    document_missing_count: 0,
    coord_available: true,
    work_unit_population_state: "included",
    work_unit_population_reason: null,
    axis_c_scope: "page",
    axis_c_computed_count: 1,
    facets: {
      denominator: 1,
      by_class: { AGREE_OPEN: 1 },
      by_verdict: { agree: 1, disagree: 0, unknown: 0 },
      corpus_complete: true,
      corpus_incomplete_reasons: [],
    },
    q: null,
    ...over,
  };
}

function route(over: Record<string, Answer> = {}) {
  const base: Record<string, Answer> = {
    "/plan-library/reconciliation": body(),
    "/plan-library/capture-health": { total: 0, doors: [] },
    "/plan-library/difficulty": { items: [], model_tiers: {} },
    "/operations/plans/overview": { derive_mode: "live" },
    "/operations/plans/throughput": {
      since: "2026-09-06T00:00:00Z",
      until: "2026-10-06T00:00:00Z",
      bucket: "day",
      timezone: "UTC",
      count: 0,
      buckets: [],
    },
    "/plan-library/scan-roots": {
      state: "reported",
      count: 2,
      fresh_count: 2,
      rows: [],
    },
    "/plan-library/art-": {
      id: "art-1",
      organization_id: null,
      created_by_user_id: null,
      kind: "plan",
      kind_locked: false,
      slug: "2026-09-05-a-draft-plan",
      title: "A draft plan",
      status: "draft",
      content_sha256: "abc",
      source_path: "plans/2026-09-05-a-draft-plan.md",
      source_repo: "qontinui-dev-notes/plans",
      work_unit_slug: "2026-09-05-a-draft-plan",
      repos: [],
      authored_at: null,
      captured_by: "runner_scan",
      current_version: 1,
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-05T00:00:00Z",
      body: "# A draft plan",
      versions: [],
      edges: [],
      coord: {
        work_unit_slug: null,
        work_unit_state: "unlinked",
        work_unit_status: null,
        work_unit_title: null,
        linked_prs_state: "unlinked",
        linked_prs: [],
        unavailable_reason: null,
      },
      status_currency: null,
    },
    ...over,
  };
  answers = Object.entries(base);
}

function reconciliationCalls(): string[] {
  return get.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/plan-library/reconciliation"));
}

beforeEach(() => {
  get.mockClear();
  window.localStorage.clear();
  route();
});

describe("the reconciliation question", () => {
  it("asks for custody on the first read", async () => {
    render(<CoordPlansListPage />);
    await screen.findByTestId("coord-plan-reconciliation-row");
    expect(reconciliationCalls()[0]).toContain("include_custody=true");
    expect(reconciliationCalls()[0]).not.toContain("q=");
  });

  it("links to the all-kinds artifact list", async () => {
    render(<CoordPlansListPage />);
    expect(
      await screen.findByTestId("coord-plans-all-kinds-link")
    ).toHaveAttribute("href", "/admin/coord/plan-library/artifacts");
  });
});

describe("custody across the background poll", () => {
  const sole = row({
    axis_a: {
      readable: true,
      present: true,
      status: "in_progress",
      status_class: "free_known",
      custody_resolved: true,
      live_sessions: [
        {
          device_id: "box",
          custody: { state: "sole", session_name: "plan-foo" },
        },
      ],
    },
  });
  const pollRow = row({
    axis_a: {
      readable: true,
      present: true,
      status: "in_progress",
      status_class: "free_known",
      live_sessions: null,
      custody_resolved: null,
    },
  });

  it("the poll omits include_custody and keeps the last reading with its age", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      route({
        "/plan-library/reconciliation": (url: string) =>
          url.includes("include_custody=true")
            ? body({ items: [sole] })
            : body({ items: [pollRow] }),
      });
      render(<CoordPlansListPage />);
      expect(await screen.findByTestId("coord-plan-custody")).toHaveTextContent(
        "claimed by plan-foo"
      );
      const fresh = screen.getByTestId("coord-plans-custody-as-of");
      expect(fresh).toHaveAttribute("data-held", "false");
      expect(fresh).toHaveTextContent(/custody as of \d\d:\d\d/);

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(reconciliationCalls().length).toBe(2));
      expect(reconciliationCalls()[1]).not.toContain("include_custody");

      // The poll answer carried no custody: the held reading stays, and the
      // page says it is held and how old it is.
      await waitFor(() =>
        expect(screen.getByTestId("coord-plans-custody-as-of")).toHaveAttribute(
          "data-held",
          "true"
        )
      );
      expect(screen.getByTestId("coord-plans-custody-as-of")).toHaveTextContent(
        /custody as of \d\d:\d\d — held from an earlier read/
      );
      expect(screen.getByTestId("coord-plan-custody")).toHaveTextContent(
        "claimed by plan-foo"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a poll asks for custody again when the operator-caused read failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let n = 0;
      route({
        "/plan-library/reconciliation": () => {
          n += 1;
          if (n === 1) throw new Error("503 transient");
          return body({ items: [sole] });
        },
      });
      render(<CoordPlansListPage />);
      await waitFor(() => expect(reconciliationCalls().length).toBe(1));
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(reconciliationCalls().length).toBe(2));
      expect(reconciliationCalls()[1]).toContain("include_custody=true");
      expect(await screen.findByTestId("coord-plan-custody")).toHaveTextContent(
        "claimed by plan-foo"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops asking for custody on the poll once a custody read succeeded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      route({
        "/plan-library/reconciliation": (url: string) =>
          url.includes("include_custody=true")
            ? body({ items: [sole] })
            : body({ items: [pollRow] }),
      });
      render(<CoordPlansListPage />);
      await screen.findByTestId("coord-plans-custody-as-of");
      for (const n of [2, 3]) {
        await act(async () => {
          vi.advanceTimersByTime(30_000);
        });
        await waitFor(() => expect(reconciliationCalls().length).toBe(n));
        expect(reconciliationCalls()[n - 1]).not.toContain("include_custody");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("a search change drops the old window's held custody", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      route({
        "/plan-library/reconciliation": (url: string) => {
          if (url.includes("q=") && url.includes("include_custody=true")) {
            throw new Error("503 custody join timed out");
          }
          return url.includes("include_custody=true")
            ? body({ items: [sole], q: null })
            : body({
                items: [pollRow],
                q: url.includes("q=") ? "merge" : null,
              });
        },
      });
      render(<CoordPlansListPage />);
      await screen.findByTestId("coord-plans-custody-as-of");
      await user.type(screen.getByTestId("coord-plans-search"), "merge");
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      await waitFor(() =>
        expect(reconciliationCalls().some((u) => u.includes("q=merge"))).toBe(
          true
        )
      );
      const before = reconciliationCalls().length;
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() =>
        expect(reconciliationCalls().length).toBeGreaterThan(before)
      );
      // The new window has no custody read yet, so its poll asks again — and
      // the old window's reading is never re-applied or dated against it.
      expect(reconciliationCalls().at(-1)).toContain("include_custody=true");
      expect(screen.queryByTestId("coord-plans-custody-as-of")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not claim a held reading when the poll's rows took none of it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const other = row({
        slug: "2026-09-30-some-other-plan",
        axis_a: {
          readable: true,
          present: true,
          status: "in_progress",
          status_class: "free_known",
          live_sessions: null,
          custody_resolved: null,
        },
      });
      route({
        "/plan-library/reconciliation": (url: string) =>
          url.includes("include_custody=true")
            ? body({ items: [sole] })
            : body({ items: [other] }),
      });
      render(<CoordPlansListPage />);
      await screen.findByTestId("coord-plans-custody-as-of");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(reconciliationCalls().length).toBe(2));
      // No row on screen carries the held reading, so no age line dates it.
      await waitFor(() =>
        expect(screen.queryByTestId("coord-plans-custody-as-of")).toBeNull()
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a manual refresh asks for custody again", async () => {
    const user = userEvent.setup();
    render(<CoordPlansListPage />);
    await screen.findByTestId("coord-plan-reconciliation-row");
    await user.click(screen.getByTestId("coord-plans-refresh"));
    await waitFor(() => expect(reconciliationCalls().length).toBe(2));
    expect(reconciliationCalls()[1]).toContain("include_custody=true");
  });
});

describe("Phase 2 — server-side search", () => {
  it("says 'no plan stem matches' only when the route applied THIS search", async () => {
    const user = userEvent.setup();
    route({
      "/plan-library/reconciliation": (url: string) =>
        url.includes("q=")
          ? body({ items: [], total: 0, q: "something-else" })
          : body(),
    });
    render(<CoordPlansListPage />);
    await screen.findByTestId("coord-plan-reconciliation-row");
    await user.type(screen.getByTestId("coord-plans-search"), "merge");
    expect(
      await screen.findByTestId(
        "coord-plans-search-mismatch",
        {},
        { timeout: 4000 }
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId("coord-plans-search-empty")).toBeNull();
    expect(screen.getByTestId("coord-plans-empty")).toBeInTheDocument();
  });

  it("sends q (debounced), returns to offset 0, and shows the echo", async () => {
    const user = userEvent.setup();
    route({
      "/plan-library/reconciliation": (url: string) =>
        url.includes("q=")
          ? body({ q: "devops-unfiltered-push-trigger", offset: 0 })
          : body({
              total: 80,
              items: Array.from({ length: 25 }, (_, i) =>
                row({ slug: `2026-01-${String(i).padStart(2, "0")}-p` })
              ),
            }),
    });
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-reconciliation-row");

    await user.click(screen.getByTestId("coord-plans-page-next"));
    await waitFor(() =>
      expect(reconciliationCalls().some((u) => u.includes("offset=25"))).toBe(
        true
      )
    );

    await user.type(
      screen.getByTestId("coord-plans-search"),
      "devops-unfiltered-push-trigger"
    );
    await waitFor(
      () =>
        expect(
          reconciliationCalls().some((u) =>
            u.includes("q=devops-unfiltered-push-trigger")
          )
        ).toBe(true),
      { timeout: 4000 }
    );
    const searched = reconciliationCalls().filter((u) => u.includes("q="));
    // Debounced: one search request for ~30 keystrokes, not one per key.
    expect(searched.length).toBeLessThanOrEqual(2);
    expect(searched.every((u) => u.includes("offset=0"))).toBe(true);

    expect(
      await screen.findByTestId(
        "coord-plans-search-echo",
        {},
        { timeout: 4000 }
      )
    ).toHaveTextContent("devops-unfiltered-push-trigger");
  });

  it("says a backend that does not echo q most likely ignored it", async () => {
    const user = userEvent.setup();
    const { q: _drop, ...noEcho } = body();
    void _drop;
    route({ "/plan-library/reconciliation": noEcho });
    render(<CoordPlansListPage />);
    await screen.findByTestId("coord-plan-reconciliation-row");
    await user.type(screen.getByTestId("coord-plans-search"), "merge");
    expect(
      await screen.findByTestId(
        "coord-plans-search-not-applied",
        {},
        { timeout: 4000 }
      )
    ).toHaveTextContent("NOT filtered");
  });
});

describe("Phase 3 — status class and needs a /vet-imp", () => {
  it("badges the class, and marks a draft plan as needing a /vet-imp", async () => {
    render(<CoordPlansListPage />);
    const r = await screen.findByTestId("coord-plan-reconciliation-row");
    expect(within(r).getByTestId("coord-plan-status-class")).toHaveAttribute(
      "data-status-class",
      "free_known"
    );
    expect(within(r).getByTestId("coord-plan-needs-vet-imp")).toHaveAttribute(
      "data-need",
      "yes"
    );
  });

  it("renders an absent status_class as UNKNOWN, not as a class", async () => {
    route({
      "/plan-library/reconciliation": body({
        items: [
          row({ axis_a: { readable: true, present: true, status: "vetted" } }),
        ],
      }),
    });
    render(<CoordPlansListPage />);
    const badge = await screen.findByTestId("coord-plan-status-class");
    expect(badge).toHaveAttribute("data-status-class", "unknown");
    expect(badge).toHaveTextContent("class not reported");
  });

  it("badges off_vocabulary as needs cleanup", async () => {
    route({
      "/plan-library/reconciliation": body({
        items: [
          row({
            axis_a: {
              readable: true,
              present: true,
              status: "Shipped",
              status_class: "off_vocabulary",
            },
          }),
        ],
      }),
    });
    render(<CoordPlansListPage />);
    const badge = await screen.findByTestId("coord-plan-status-class");
    expect(badge).toHaveAttribute("data-needs-cleanup", "true");
    expect(badge).toHaveTextContent("needs cleanup");
  });

  it("the needs-vet-imp chip narrows THIS page and says so", async () => {
    const user = userEvent.setup();
    route({
      "/plan-library/reconciliation": body({
        total: 2,
        items: [
          row(),
          row({
            slug: "2026-09-06-shipped",
            axis_a: {
              readable: true,
              present: true,
              status: "shipped",
              status_class: "derived",
            },
          }),
        ],
      }),
    });
    render(<CoordPlansListPage />);
    expect(
      await screen.findAllByTestId("coord-plan-reconciliation-row")
    ).toHaveLength(2);

    await user.click(screen.getByTestId("coord-plans-chips-needs_vet_imp"));
    await waitFor(() =>
      expect(
        screen.getAllByTestId("coord-plan-reconciliation-row")
      ).toHaveLength(1)
    );
    const scope = screen.getByTestId("coord-plans-status-filter-scope");
    expect(scope).toHaveTextContent("filters this page only");
    expect(scope).toHaveTextContent("needs a /vet-imp");
  });

  it.each([
    [
      "shadow",
      "decay detection runs in shadow mode on this coord deployment — this signal may be stale",
    ],
    [undefined, "decay-detection mode UNKNOWN"],
  ])("derive_mode %s → caveat", async (mode, text) => {
    route({
      "/operations/plans/overview":
        mode === undefined ? { row_count: 3 } : { derive_mode: mode },
    });
    render(<CoordPlansListPage />);
    expect(
      await screen.findByTestId("coord-plans-derive-mode-caveat")
    ).toHaveTextContent(text);
  });

  it("derive_mode live → no caveat", async () => {
    render(<CoordPlansListPage />);
    await screen.findByTestId("coord-plan-reconciliation-row");
    await waitFor(() =>
      expect(screen.queryByTestId("coord-plans-derive-mode-caveat")).toBeNull()
    );
  });

  it("a failed overview read is UNKNOWN, never live", async () => {
    route({ "/operations/plans/overview": new Error("502") });
    render(<CoordPlansListPage />);
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-plans-derive-mode-caveat")
      ).toHaveAttribute("data-derive-mode", "failed")
    );
  });
});

describe("Phase 4 — throughput", () => {
  it("an empty range says 'no data in this range', not a zero chart", async () => {
    render(<CoordPlansListPage />);
    expect(
      await screen.findByTestId("coord-plans-throughput-empty")
    ).toHaveTextContent("No data in this range");
    expect(screen.queryByTestId("coord-plans-throughput-chart")).toBeNull();
  });

  it("lays out only the buckets coord returned", async () => {
    route({
      "/operations/plans/throughput": {
        since: "2026-09-06T00:00:00Z",
        until: "2026-10-06T00:00:00Z",
        count: 2,
        buckets: [
          { day: "2026-09-10", to_status: "shipped", count: 2 },
          { day: "2026-09-12", to_status: "in_progress", count: 1 },
        ],
      },
    });
    render(<CoordPlansListPage />);
    const days = await screen.findAllByTestId("coord-plans-throughput-day");
    expect(days).toHaveLength(2);
    expect(within(days[0]).getByText("2026-09-10")).toBeInTheDocument();
    expect(days[0].querySelector('[data-series="started"]')).toHaveTextContent(
      "no bucket"
    );
    expect(
      screen.getByTestId("coord-plans-throughput-summary")
    ).toHaveTextContent("2 shipped · 1 started (work-unit-days");
  });

  it("marks a held reading when a refresh fails", async () => {
    const user = userEvent.setup();
    route({
      "/operations/plans/throughput": {
        since: "2026-09-06T00:00:00Z",
        until: "2026-10-06T00:00:00Z",
        count: 1,
        buckets: [{ day: "2026-09-10", to_status: "shipped", count: 2 }],
      },
    });
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plans-throughput-day");
    expect(
      screen.queryByTestId("coord-plans-throughput-refresh-failed")
    ).toBeNull();

    route({ "/operations/plans/throughput": new Error("coord timed out") });
    await user.click(screen.getByTestId("coord-plans-refresh"));
    expect(
      await screen.findByTestId("coord-plans-throughput-refresh-failed")
    ).toHaveTextContent(/refresh failed — showing reading from \d\d:\d\d/);
    // The held bars are still there.
    expect(screen.getAllByTestId("coord-plans-throughput-day")).toHaveLength(1);
  });

  it("asks for the default 30 days, and re-asks when the range changes", async () => {
    const user = userEvent.setup();
    render(<CoordPlansListPage />);
    await screen.findByTestId("coord-plans-throughput-empty");
    const first = get.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/operations/plans/throughput"));
    expect(first).toMatch(/since=\d{4}-\d{2}-\d{2}/);

    await user.click(screen.getByTestId("coord-plans-throughput-range"));
    await user.click(
      await screen.findByRole("option", { name: "last 90 days" })
    );
    await waitFor(() =>
      expect(
        get.mock.calls.filter((c) =>
          String(c[0]).includes("/operations/plans/throughput")
        ).length
      ).toBeGreaterThanOrEqual(2)
    );
  });

  it("a failed read is UNKNOWN, and a 404 says the route is not served", async () => {
    route({
      "/operations/plans/throughput": new Error(
        "GET /api/v1/operations/plans/throughput?since=x failed: 404 - Not Found"
      ),
    });
    render(<CoordPlansListPage />);
    expect(
      await screen.findByTestId("coord-plans-throughput-unknown")
    ).toHaveTextContent("does not serve");
  });
});

describe("Phase 5 — difficulty", () => {
  it("renders an unrated plan as unrated, never low", async () => {
    render(<CoordPlansListPage />);
    const chip = await within(
      await screen.findByTestId("coord-plan-reconciliation-row")
    ).findByTestId("coord-plan-difficulty");
    await waitFor(() =>
      expect(chip).toHaveAttribute("data-difficulty", "unrated")
    );
    expect(chip).toHaveTextContent("unrated");
    expect(chip).not.toHaveTextContent("low");
  });

  it("joins a rating by stem", async () => {
    route({
      "/plan-library/difficulty": {
        items: [
          {
            id: "art-1",
            kind: "plan",
            slug: "2026-09-05-a-draft-plan",
            work_unit_slug: "2026-09-05-a-draft-plan",
            difficulty: "high",
            difficulty_source: "computed",
            difficulty_rubric_version: 1,
            difficulty_conceptual: "high",
            difficulty_implementation: "medium",
          },
        ],
        model_tiers: { high: "opus" },
      },
    });
    render(<CoordPlansListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-plan-difficulty")).toHaveAttribute(
        "data-difficulty",
        "high"
      )
    );
  });
});

describe("Phase 6 — custody", () => {
  it("says 'no live claim' for an empty live_sessions list", async () => {
    render(<CoordPlansListPage />);
    expect(await screen.findByTestId("coord-plan-custody")).toHaveTextContent(
      "no live claim"
    );
  });

  it("renders an ambiguous device as a count", async () => {
    route({
      "/plan-library/reconciliation": body({
        items: [
          row({
            axis_a: {
              readable: true,
              present: true,
              status: "in_progress",
              status_class: "free_known",
              custody_resolved: true,
              live_sessions: [
                {
                  device_id: "box",
                  custody: { state: "ambiguous", live_session_count: 4 },
                },
              ],
            },
          }),
        ],
      }),
    });
    render(<CoordPlansListPage />);
    expect(await screen.findByTestId("coord-plan-custody")).toHaveTextContent(
      "4 sessions active on this device"
    );
  });

  it("says coord did not resolve custody", async () => {
    route({
      "/plan-library/reconciliation": body({
        items: [
          row({
            axis_a: {
              readable: true,
              present: true,
              status: "in_progress",
              custody_resolved: false,
              live_sessions: [{ device_id: "box" }],
            },
          }),
        ],
      }),
    });
    render(<CoordPlansListPage />);
    expect(await screen.findByTestId("coord-plan-custody")).toHaveTextContent(
      "custody not resolved (coord did not resolve names)"
    );
  });
});

describe("Phase 1 — one page for both stores", () => {
  it("flags a document-only row with its own chip", async () => {
    const user = userEvent.setup();
    route({
      "/plan-library/reconciliation": body({
        total: 2,
        items: [
          row(),
          row({
            slug: "2026-09-07-orphan",
            artifact_id: "art-2",
            axis_a: { readable: true, present: false },
          }),
        ],
      }),
    });
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-reconciliation-row");
    const chip = screen.getByTestId("coord-plans-chips-document_only");
    expect(chip).toHaveTextContent("1");
    await user.click(chip);
    await waitFor(() => {
      const rows = screen.getAllByTestId("coord-plan-reconciliation-row");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("orphan");
    });
  });

  it("opens the plan document in place from the row's detail", async () => {
    const user = userEvent.setup();
    render(<CoordPlansListPage />);
    const r = await screen.findByTestId("coord-plan-reconciliation-row");
    await user.click(within(r).getAllByRole("button")[0]);
    await user.click(await screen.findByTestId("coord-plan-open-document"));
    expect(
      await screen.findByTestId("artifact-detail-dialog")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        get.mock.calls.some(
          (c) => String(c[0]) === "/api/v1/plan-library/art-1"
        )
      ).toBe(true)
    );
  });

  it("says when a stem has no document to open", async () => {
    const user = userEvent.setup();
    route({
      "/plan-library/reconciliation": body({
        items: [row({ artifact_id: null, document_state: "absent" })],
      }),
    });
    render(<CoordPlansListPage />);
    const r = await screen.findByTestId("coord-plan-reconciliation-row");
    await user.click(within(r).getAllByRole("button")[0]);
    expect(
      await screen.findByTestId("coord-plan-no-document")
    ).toHaveTextContent("nothing to open");
  });

  it("collapses corpus health to one line, with a fork link out of the toggle", async () => {
    const user = userEvent.setup();
    route({
      "/plan-library/reconciliation": body({
        items: [
          row({
            axis_b: {
              readable: true,
              present: true,
              status: "draft",
              document_state: "present",
              complete: true,
              variant_count: 2,
            },
          }),
        ],
      }),
    });
    render(<CoordPlansListPage />);
    await screen.findByTestId("coord-plan-reconciliation-row");
    expect(
      await screen.findByTestId("coord-plans-corpus-health-scan")
    ).toHaveTextContent("0 of 2 scan sources stale");
    expect(screen.queryByTestId("stub-scan-sources")).toBeNull();
    const link = screen.getByTestId("coord-plans-forks-link");
    expect(link).toHaveAttribute("href", "/admin/coord/plan-forks");
    expect(link).toHaveTextContent("1 forked stem on this page");

    await user.click(screen.getByRole("button", { name: /corpus health/i }));
    expect(await screen.findByTestId("stub-scan-sources")).toBeInTheDocument();
    expect(screen.getByTestId("stub-plan-coverage")).toBeInTheDocument();
  });

  it("an unreadable scan census is UNKNOWN in the summary", async () => {
    route({ "/plan-library/scan-roots": new Error("500") });
    render(<CoordPlansListPage />);
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-plans-corpus-health-scan")
      ).toHaveTextContent("UNKNOWN")
    );
  });
});
