/**
 * `/admin/coord/subprojects` — the list says which subprojects have stopped,
 * counts every view from coord's own totals, and never renders an unanswered
 * read as an empty list (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6, D12; style guide R1, R2, R5, R6).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  SubprojectListResponse,
  SubprojectSummary,
} from "@/lib/api/operations/coordSubprojects";

const fetchSubprojects = vi.fn();
vi.mock("@/lib/api/operations/coordSubprojects", () => ({
  fetchSubprojects: (...args: unknown[]) => fetchSubprojects(...args),
}));

let mockTab: string | null = null;
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockTab ? { tab: mockTab } : {}),
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/admin/coord/subprojects",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import CoordSubprojectsPage from "./page";
import {
  SUBPROJECTS_COUNTS_POLL_MS,
  SUBPROJECTS_ROWS_POLL_MS,
} from "./_hooks/useSubprojectsList";

function summary(over: Partial<SubprojectSummary> = {}): SubprojectSummary {
  return {
    id: "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
    slug: "dashboards",
    title: "dashboards-and-presentation",
    title_source: "root_session",
    goal: null,
    origin: "operator_prompt",
    status: "open",
    merged_into: null,
    root_agent_session_id: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-08T00:00:00Z",
    closed_at: null,
    headline: "stalled",
    top_reason: {
      kind: "gate_dependency_unowned",
      summary: "Waiting on qontinui-runner#2569, whose author session closed",
      refs: [],
      detail: null,
    },
    reasons_count: 2,
    sessions: { live: 0, total: 3 },
    work_units: { total: 2, open: 1 },
    last_activity_at: "2026-11-08T00:00:00Z",
    verdict_as_of: "2026-11-08T15:00:00Z",
    ...over,
  };
}

function page(
  items: SubprojectSummary[],
  total: number | null
): SubprojectListResponse {
  return {
    items,
    next_cursor: null,
    truncated: false,
    total,
    unattached_units: { count: 4, by_class: { stalled: 1, not_started: 3 } },
    generated_at: "2026-11-08T15:01:00Z",
  };
}

const NOT_DONE = [
  "needs_you",
  "stalled",
  "working",
  "waiting",
  "unknown",
] as const;

/** coord's `counts` facet over `totals` (a missing headline counts 0). */
function facetOf(totals: Partial<Record<string, number | null>>) {
  const n = (k: string) => totals[k] ?? 0;
  return {
    by_headline: {
      needs_you: n("needs_you"),
      stalled: n("stalled"),
      working: n("working"),
      waiting: n("waiting"),
      done: n("done"),
      unknown: n("unknown"),
    },
    folded: { one_off: 0, scheduled: 0, merged: 0 },
    as_of: "2026-11-08T15:00:00Z",
  };
}

/**
 * Answer each read by its filter. A `limit=1` read with no headline is a
 * SCOPE read and carries the `counts` facet (unless `facet: false`, an older
 * coord); a `limit=1` read with a headline is that view's own count; any
 * other read is rows — `rows[view]` for the first page, with
 * `cursors[view]` as its next cursor, and `rows["<view>@<cursor>"]` for the
 * page after it.
 */
function route(
  totals: Partial<Record<string, number | null>>,
  rows: Partial<Record<string, SubprojectSummary[]>> = {},
  opts: { facet?: boolean; cursors?: Partial<Record<string, string>> } = {}
) {
  fetchSubprojects.mockImplementation(async (query: URLSearchParams) => {
    const headline = query.get("headline");
    if (query.get("limit") === "1") {
      if (headline !== null) return page([], totals[headline] ?? 0);
      const scopeTotal =
        query.get("status") === "all"
          ? (totals.all ?? 0)
          : NOT_DONE.reduce((sum, h) => sum + (totals[h] ?? 0), 0);
      return opts.facet === false
        ? page([], scopeTotal)
        : { ...page([], scopeTotal), counts: facetOf(totals) };
    }
    const view = headline ?? "all";
    const cursor = query.get("cursor");
    if (cursor) return page(rows[`${view}@${cursor}`] ?? [], totals[view] ?? 0);
    return {
      ...page(rows[view] ?? [], totals[view] ?? 0),
      next_cursor: opts.cursors?.[view] ?? null,
    };
  });
}

function queries(): string[] {
  return fetchSubprojects.mock.calls.map((c) =>
    (c[0] as URLSearchParams).toString()
  );
}

function tabCount(tab: string): HTMLElement {
  return screen.getByTestId(`coord-subprojects-tab-${tab}`);
}

const CALM = {
  needs_you: 0,
  stalled: 0,
  working: 1,
  waiting: 2,
  done: 5,
  all: 8,
  unknown: 0,
};

describe("/admin/coord/subprojects", () => {
  beforeEach(() => {
    fetchSubprojects.mockReset();
    replace.mockReset();
    mockTab = null;
  });

  it("opens on Open with a red strip and live tab counts when anything is stalled", async () => {
    route({ ...CALM, stalled: 2, needs_you: 1 }, { stalled: [summary()] });
    render(<CoordSubprojectsPage />);
    const strip = await screen.findByTestId("coord-subprojects-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent("1 needs you · 2 stalled")
    );
    expect(within(tabCount("stalled")).getByText("2")).toBeInTheDocument();
    // Open is every headline but done: 1 + 2 + 1 + 2 + 0.
    expect(within(tabCount("open")).getByText("6")).toBeInTheDocument();
    // Open is the default view: no tab parameter reads its five headlines.
    await waitFor(() =>
      expect(queries()).toContain("status=open&headline=waiting&limit=100")
    );
    expect(
      screen.getByTestId("coord-subprojects-unattached")
    ).toHaveTextContent(
      "Work units that belong to no subproject: 4 (stalled 1, not started 3)"
    );
    expect(
      await screen.findByTestId("coord-subproject-row")
    ).toBeInTheDocument();
  });

  it("reads every count from coord's facet in two reads, and Open's rows as its five headlines", async () => {
    route({ ...CALM, stalled: 2 });
    render(<CoordSubprojectsPage />);
    await waitFor(() =>
      expect(within(tabCount("stalled")).getByText("2")).toBeInTheDocument()
    );
    expect(
      queries()
        .filter((q) => q.endsWith("limit=1"))
        .sort()
    ).toEqual(["status=all&limit=1", "status=open&limit=1"]);
    expect(queries()).toEqual(
      expect.arrayContaining([
        "status=open&headline=needs_you&limit=100",
        "status=open&headline=stalled&limit=100",
        "status=open&headline=working&limit=100",
        "status=open&headline=waiting&limit=100",
        "status=open&headline=unknown&limit=100",
      ])
    );
    expect(queries()).not.toContain("status=all&limit=100");
    expect(within(tabCount("open")).getByText("5")).toBeInTheDocument();
    expect(within(tabCount("done")).getByText("5")).toBeInTheDocument();
    expect(within(tabCount("all")).getByText("8")).toBeInTheDocument();
  });

  it("falls back to one count read per view when coord sends no facet", async () => {
    route({ ...CALM, stalled: 2 }, {}, { facet: false });
    render(<CoordSubprojectsPage />);
    await waitFor(() =>
      expect(within(tabCount("stalled")).getByText("2")).toBeInTheDocument()
    );
    expect(queries().filter((q) => q.endsWith("limit=1"))).toEqual(
      expect.arrayContaining([
        "status=open&limit=1",
        "status=all&limit=1",
        "status=open&headline=needs_you&limit=1",
        "status=open&headline=stalled&limit=1",
        "status=open&headline=working&limit=1",
        "status=open&headline=waiting&limit=1",
        "status=open&headline=unknown&limit=1",
        "status=all&headline=done&limit=1",
      ])
    );
    // Open is the sum of its five views' own counts: 0 + 2 + 1 + 2 + 0.
    await waitFor(() =>
      expect(within(tabCount("open")).getByText("5")).toBeInTheDocument()
    );
    expect(within(tabCount("all")).getByText("8")).toBeInTheDocument();
  });

  it("words a per-view count that failed as a failed read, never as 'not taken'", async () => {
    route(CALM, {}, { facet: false });
    const answered = fetchSubprojects.getMockImplementation();
    fetchSubprojects.mockImplementation(async (query: URLSearchParams) => {
      if (query.get("headline") === "stalled" && query.get("limit") === "1")
        throw new TypeError("Failed to fetch");
      return answered?.(query);
    });
    render(<CoordSubprojectsPage />);
    const strip = screen.getByTestId("coord-subprojects-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent(/the stalled count could not be read/)
    );
    expect(strip).toHaveAttribute("data-health-level", "amber");
    expect(within(tabCount("stalled")).getByText("–")).toBeInTheDocument();
  });

  it("re-reads the counts less often than the rows", () => {
    expect(SUBPROJECTS_COUNTS_POLL_MS).toBeGreaterThan(
      SUBPROJECTS_ROWS_POLL_MS
    );
  });

  it("renders one line per subproject: sessions, title, headline, reason, times", async () => {
    route(CALM, { stalled: [summary()] });
    render(<CoordSubprojectsPage />);
    const row = await screen.findByTestId("coord-subproject-row");
    expect(row).toHaveTextContent("0/3");
    expect(row).toHaveTextContent("dashboards-and-presentation");
    expect(row).toHaveTextContent("Stalled");
    expect(row).toHaveTextContent("Waiting on qontinui-runner#2569");
    expect(row.querySelector("[data-status-kind]")).toHaveAttribute(
      "data-status-kind",
      "stalled"
    );
    // A label that may truncate carries its full text as a tooltip.
    expect(
      within(row).getByTitle("dashboards-and-presentation")
    ).toBeInTheDocument();
  });

  it("expands a row in place with the way into the subproject's page", async () => {
    route(CALM, { stalled: [summary()] });
    render(<CoordSubprojectsPage />);
    const row = await screen.findByTestId("coord-subproject-row");
    // The testid is on the row's wrapper; the line itself is the toggle.
    fireEvent.click(row.querySelector("[data-console-row]") as HTMLElement);
    expect(await screen.findByTestId("coord-subproject-open")).toHaveAttribute(
      "href",
      "/admin/coord/subprojects/6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f"
    );
  });

  it("dashes every count before any read answers, and never claims an empty list", async () => {
    fetchSubprojects.mockReturnValue(new Promise(() => {}));
    render(<CoordSubprojectsPage />);
    expect(screen.getByTestId("coord-subprojects-strip")).toHaveAttribute(
      "data-health-level",
      "amber"
    );
    expect(within(tabCount("stalled")).getByText("–")).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-subprojects-empty")
    ).not.toBeInTheDocument();
  });

  it("says a pending migration is unknown, never 'no subprojects'", async () => {
    fetchSubprojects.mockRejectedValue(
      new Error(
        'GET /api/v1/operations/subprojects failed: 503 - {"error":"schema_migration_pending"}'
      )
    );
    render(<CoordSubprojectsPage />);
    const strip = screen.getByTestId("coord-subprojects-strip");
    await waitFor(() => expect(strip).toHaveTextContent(/not migrated/));
    expect(strip).toHaveAttribute("data-health-level", "amber");
    const empty = await screen.findByTestId("coord-subprojects-empty");
    expect(empty).toHaveTextContent(/is unknown/);
    expect(empty).not.toHaveTextContent(/^No subproject/);
    expect(within(tabCount("all")).getByText("–")).toBeInTheDocument();
  });

  it("calls a failed read under a newly chosen tab unknown, and never shows another tab's rows", async () => {
    route(CALM, {
      waiting: [summary({ headline: "waiting", title: "an-open-row" })],
    });
    const { rerender } = render(<CoordSubprojectsPage />);
    await screen.findByText("an-open-row");
    const answered = fetchSubprojects.getMockImplementation();
    fetchSubprojects.mockImplementation(async (query: URLSearchParams) => {
      if (query.get("headline") === "stalled" && query.get("limit") !== "1")
        throw new TypeError("Failed to fetch");
      return answered?.(query);
    });
    mockTab = "stalled";
    rerender(<CoordSubprojectsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-subprojects-empty")).toHaveTextContent(
        /^Whether any subproject is in this view is unknown/
      )
    );
    expect(screen.queryByText("an-open-row")).not.toBeInTheDocument();
    // Nothing of THIS view was ever read, so there is nothing to call stale.
    expect(
      screen.queryByTestId("coord-subprojects-rows-stale")
    ).not.toBeInTheDocument();
  });

  it("folds one-offs out of Done into All, and says how many it folded", async () => {
    mockTab = "done";
    const oneOff = summary({
      id: "11111111-1111-4111-8111-111111111111",
      title: "a-quick-question",
      headline: "done",
      top_reason: null,
      sessions: { live: 0, total: 1 },
      work_units: { total: 0, open: 0 },
    });
    const real = summary({
      id: "22222222-2222-4222-8222-222222222222",
      title: "shipped-feature",
      headline: "done",
      top_reason: null,
    });
    route({ ...CALM, done: 2 }, { done: [oneOff, real] });
    render(<CoordSubprojectsPage />);
    await screen.findByText("shipped-feature");
    expect(screen.queryByText("a-quick-question")).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-subprojects-folded")).toHaveTextContent(
      "1 more on this page is a one-off, scheduled or merged subproject, listed under All."
    );
  });

  it("says a Done page made only of one-offs is listed under All, never 'No subproject is done'", async () => {
    mockTab = "done";
    const oneOff = (id: string, title: string) =>
      summary({
        id,
        title,
        headline: "done",
        top_reason: null,
        sessions: { live: 0, total: 1 },
        work_units: { total: 0, open: 0 },
      });
    route(
      { ...CALM, done: 40 },
      {
        done: [
          oneOff("11111111-1111-4111-8111-111111111111", "q-one"),
          oneOff("22222222-2222-4222-8222-222222222222", "q-two"),
        ],
      },
      { cursors: { done: "c2" } }
    );
    render(<CoordSubprojectsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-subprojects-empty")).toHaveTextContent(
        "The 2 subprojects on this page in this view are one-off, scheduled or merged, listed under All. More may be on the next page: Load more."
      )
    );
    expect(screen.getByTestId("coord-subprojects-empty")).not.toHaveTextContent(
      /No subproject/
    );
    expect(
      screen.getByTestId("coord-subprojects-load-more")
    ).toBeInTheDocument();
  });

  it("after Load more, dates the rows and says their minute refresh is paused", async () => {
    mockTab = "stalled";
    route(
      { ...CALM, stalled: 2 },
      {
        stalled: [summary({ title: "first-page" })],
        "stalled@c2": [
          summary({
            id: "33333333-3333-4333-8333-333333333333",
            title: "second-page",
          }),
        ],
      },
      { cursors: { stalled: "c2" } }
    );
    render(<CoordSubprojectsPage />);
    await screen.findByText("first-page");
    expect(
      screen.queryByTestId("coord-subprojects-rows-paused")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("coord-subprojects-load-more"));
    await screen.findByText("second-page");
    const paused = screen.getByTestId("coord-subprojects-rows-paused");
    expect(paused).toHaveTextContent(/^These rows are as of/);
    expect(paused).toHaveTextContent(/not re-read every minute/);
    expect(
      screen.getByTestId("coord-subprojects-page-count")
    ).toHaveTextContent("2 loaded of 2.");
    expect(queries()).toContain(
      "status=open&headline=stalled&limit=100&cursor=c2"
    );
  });

  it("switches views through the URL: Open needs no parameter, every other view is named", async () => {
    mockTab = "stalled";
    route(CALM);
    render(<CoordSubprojectsPage />);
    fireEvent.click(await screen.findByTestId("coord-subprojects-tab-all"));
    expect(replace).toHaveBeenLastCalledWith(
      "/admin/coord/subprojects?tab=all",
      {
        scroll: false,
      }
    );
    fireEvent.click(screen.getByTestId("coord-subprojects-tab-waiting"));
    expect(replace).toHaveBeenLastCalledWith(
      "/admin/coord/subprojects?tab=waiting",
      { scroll: false }
    );
    fireEvent.click(screen.getByTestId("coord-subprojects-tab-open"));
    expect(replace).toHaveBeenLastCalledWith("/admin/coord/subprojects", {
      scroll: false,
    });
  });

  it("keeps a view's rows across a failed refresh and says they are the last good read", async () => {
    route(CALM, { stalled: [summary()] });
    render(<CoordSubprojectsPage />);
    await screen.findByTestId("coord-subproject-row");
    fetchSubprojects.mockRejectedValue(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByTestId("coord-subprojects-refresh"));
    expect(
      await screen.findByTestId("coord-subprojects-rows-stale")
    ).toHaveTextContent(/latest read of this view failed/);
    expect(screen.getByTestId("coord-subproject-row")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("coord-subprojects-strip")).toHaveAttribute(
        "data-health-level",
        "amber"
      )
    );
  });
});
