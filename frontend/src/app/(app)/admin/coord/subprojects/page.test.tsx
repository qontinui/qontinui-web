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

/** Answer each read by its filter: counts (`limit=1`) from `totals`, rows
 *  from `rows` for the view asked. */
function route(
  totals: Partial<Record<string, number | null>>,
  rows: Partial<Record<string, SubprojectSummary[]>> = {}
) {
  fetchSubprojects.mockImplementation(async (query: URLSearchParams) => {
    const view = query.get("headline") ?? "all";
    if (query.get("limit") === "1") return page([], totals[view] ?? 0);
    return page(rows[view] ?? [], totals[view] ?? 0);
  });
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

  it("opens with a red strip and live tab counts when anything is stalled", async () => {
    route({ ...CALM, stalled: 2, needs_you: 1 }, { all: [summary()] });
    render(<CoordSubprojectsPage />);
    const strip = await screen.findByTestId("coord-subprojects-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent("1 needs you · 2 stalled")
    );
    expect(
      within(screen.getByTestId("coord-subprojects-tab-stalled")).getByText("2")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-subprojects-unattached")
    ).toHaveTextContent(
      "Work units that belong to no subproject: 4 (stalled 1, not started 3)"
    );
  });

  it("reads each view's count from coord's own total", async () => {
    route(CALM, { all: [] });
    render(<CoordSubprojectsPage />);
    await waitFor(() => expect(fetchSubprojects).toHaveBeenCalled());
    const queries = fetchSubprojects.mock.calls.map((c) =>
      (c[0] as URLSearchParams).toString()
    );
    expect(queries).toEqual(
      expect.arrayContaining([
        "status=open&headline=needs_you&limit=1",
        "status=open&headline=stalled&limit=1",
        "status=open&headline=working&limit=1",
        "status=open&headline=waiting&limit=1",
        "status=all&headline=done&limit=1",
        "status=all&limit=1",
        "status=open&headline=unknown&limit=1",
        "status=all&limit=100",
      ])
    );
  });

  it("renders one line per subproject: sessions, title, headline, reason, times", async () => {
    route(CALM, { all: [summary()] });
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
  });

  it("expands a row in place with the way into the subproject's page", async () => {
    route(CALM, { all: [summary()] });
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
    expect(
      within(screen.getByTestId("coord-subprojects-tab-stalled")).getByText("–")
    ).toBeInTheDocument();
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
    expect(
      within(screen.getByTestId("coord-subprojects-tab-all")).getByText("–")
    ).toBeInTheDocument();
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

  it("switches views through the URL, so a view can be linked", async () => {
    route(CALM, { all: [] });
    render(<CoordSubprojectsPage />);
    fireEvent.click(await screen.findByTestId("coord-subprojects-tab-stalled"));
    expect(replace).toHaveBeenCalledWith(
      "/admin/coord/subprojects?tab=stalled",
      {
        scroll: false,
      }
    );
  });

  it("keeps a view's rows across a failed refresh and says they are the last good read", async () => {
    route(CALM, { all: [summary()] });
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
