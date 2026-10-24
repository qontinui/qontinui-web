/**
 * `/admin/coord/work-units` — the per-unit KPI cells, end to end on the page.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4. Pinned:
 *   - the page reads `GET /api/v1/operations/kpis` ONCE for the visible window
 *     however many rows it lists, and joins the answer to rows by slug;
 *   - a figure coord could not compute is `unknown` on its row — never `0` —
 *     and a partially covered one carries `(n/m)`;
 *   - the cost cell says it is a list-price equivalent;
 *   - a unit coord returned no row for says "no KPIs in window", not zeros;
 *   - a KPI read that FAILS (the coord route is not deployed yet, a timeout, a
 *     body that is not `kpis/v1`) is an explicit "KPIs unavailable" with no
 *     figure anywhere — and the work-unit list is untouched by it;
 *   - the window control re-asks once, with that window; Refresh re-reads once.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { kpi, payload, unit, unknown } from "@/test/kpisFixtures";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/work-units",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// The ratings are a different read with their own coverage; pending keeps them
// out of the `get` spy this file counts KPI reads on.
vi.mock("./usePlanDifficulty", () => ({
  usePlanDifficulty: () => ({
    index: { state: "pending" },
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("@/services/service-factory", async () => {
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: (...args: unknown[]) => get(...args),
      post: vi.fn(),
    }),
  };
});

import CoordWorkUnitsListPage from "./page";

const UNITS = {
  work_units: [
    { slug: "2026-10-01-measured", status: "shipped" },
    { slug: "2026-10-02-unmeasured", status: "shipped" },
    { slug: "2026-10-03-still-a-draft", status: "draft" },
  ],
};

const KPI_URL = "/api/v1/operations/kpis";

/** The URLs the page asked for, in order. */
function urls(): string[] {
  return get.mock.calls.map((c) => String(c[0]));
}
function kpiReads(): string[] {
  return urls().filter((u) => u.startsWith(KPI_URL));
}

/** Route `get` by URL; `kpis` is the KPI read's answer (a body or an Error). */
function route(kpis: unknown) {
  get.mockImplementation((url: string) => {
    if (url.startsWith(KPI_URL)) {
      return kpis instanceof Error
        ? Promise.reject(kpis)
        : Promise.resolve(kpis);
    }
    if (url.startsWith("/api/v1/operations/plans/overview")) {
      return Promise.resolve({});
    }
    return Promise.resolve(UNITS);
  });
}

function rowFor(slug: string): HTMLElement {
  const card = screen
    .getAllByTestId("coord-plan-card")
    .find((el) => el.getAttribute("data-row-key") === slug);
  if (!card) throw new Error(`no card for ${slug}`);
  return card;
}

async function renderLoaded() {
  render(<CoordWorkUnitsListPage />);
  await screen.findAllByTestId("coord-plan-card");
}

async function kpiState(state: string) {
  await waitFor(() =>
    expect(screen.getByTestId("coord-work-units-kpis-status")).toHaveAttribute(
      "data-kpi-state",
      state
    )
  );
}

beforeEach(() => {
  get.mockReset();
});

describe("/admin/coord/work-units KPI cells", () => {
  it("reads the KPIs once for the window, however many rows there are", async () => {
    route(payload([unit("2026-10-01-measured")]));
    await renderLoaded();
    await kpiState("loaded");

    expect(screen.getAllByTestId("coord-plan-card")).toHaveLength(3);
    expect(kpiReads()).toEqual([`${KPI_URL}?window=28d`]);
  });

  it("joins the figures to rows by slug", async () => {
    route(
      payload([
        unit("2026-10-01-measured", {
          lead_time_seconds: kpi(7200),
          ci_attempts: kpi(9),
        }),
      ])
    );
    await renderLoaded();
    await kpiState("loaded");

    const unitRow = rowFor("2026-10-01-measured");
    expect(
      within(unitRow).getByTestId("coord-plan-kpi-lead_time")
    ).toHaveTextContent("lead2h");
    expect(
      within(unitRow).getByTestId("coord-plan-kpi-cost")
    ).toHaveTextContent("list-price equiv.$2.50");
    // The other rows are not given this unit's figures.
    expect(
      within(rowFor("2026-10-02-unmeasured")).queryByTestId(
        "coord-plan-kpi-lead_time"
      )
    ).not.toBeInTheDocument();
  });

  it("says 'no KPIs in window' for units coord returned no row for — not zeros", async () => {
    route(payload([unit("2026-10-01-measured")]));
    await renderLoaded();
    await kpiState("loaded");

    for (const slug of ["2026-10-02-unmeasured", "2026-10-03-still-a-draft"]) {
      const chip = within(rowFor(slug)).getByTestId("coord-plan-kpis-outside");
      expect(chip).toHaveTextContent("no KPIs in window");
      expect(
        within(rowFor(slug)).queryByTestId("coord-plan-kpi-cost")
      ).toBeNull();
    }
  });

  it("renders an UNKNOWN figure as unknown with its reason, and partial coverage as (n/m)", async () => {
    route(
      payload([
        unit("2026-10-01-measured", {
          cost_microusd: unknown("no_usage_rows"),
          interventions: kpi(3, { coverage_n: 1, population_n: 2 }),
          rework: unknown("revert_probe_not_run"),
        }),
      ])
    );
    await renderLoaded();
    await kpiState("loaded");

    const row = rowFor("2026-10-01-measured");
    const cost = within(row).getByTestId("coord-plan-kpi-cost");
    expect(cost).toHaveTextContent("list-price equiv.unknown");
    expect(cost).toHaveAttribute("data-kpi-reason", "no_usage_rows");
    expect(cost.textContent).not.toMatch(/\$|\b0\b/);
    expect(
      within(row).getByTestId("coord-plan-kpi-interventions")
    ).toHaveTextContent("interventions3 (1/2)");
    expect(within(row).getByTestId("coord-plan-kpi-rework")).toHaveTextContent(
      "reworkunknown"
    );
  });

  it("shows what the cells are over, and that cost is a list-price equivalent", async () => {
    route(payload([unit("2026-10-01-measured")]));
    await renderLoaded();
    await kpiState("loaded");
    const status = screen.getByTestId("coord-work-units-kpis-status");
    expect(status).toHaveTextContent("last 28 days (2026-09-26 to 2026-10-24)");
    expect(status).toHaveTextContent("1 of 1 returned");
    expect(status).toHaveTextContent("list-price equivalent");
  });

  it("carries the whole block in a row's expanded detail", async () => {
    route(payload([unit("2026-10-01-measured")]));
    await renderLoaded();
    await kpiState("loaded");

    const user = userEvent.setup();
    await user.click(
      within(rowFor("2026-10-01-measured")).getByRole("button", {
        expanded: false,
      })
    );
    const detail = await screen.findByTestId("coord-plan-kpis-detail");
    expect(
      within(detail).getByTestId("coord-plan-kpi-row-cost")
    ).toHaveTextContent("Cost (list-price equivalent)");
    expect(
      within(detail).getByTestId("coord-plan-kpi-row-ci_attempts")
    ).toHaveTextContent("CI attempts: 4 (1 of 1 observed)");
  });
});

describe("/admin/coord/work-units when the KPI read fails", () => {
  it("says KPIs are unavailable and shows no figure when the coord route is not deployed (404)", async () => {
    route(
      new Error(
        `GET ${KPI_URL}?window=28d failed: 404 - {"error":"no_such_route"}`
      )
    );
    await renderLoaded();
    await kpiState("unavailable");

    expect(
      screen.getByTestId("coord-work-units-kpis-status")
    ).toHaveTextContent(
      "KPIs unavailable — coord does not serve work-unit KPIs yet (GET /coord/kpis). No KPI figures are shown"
    );
    expect(screen.queryByTestId("coord-plan-kpis")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-plan-kpis-outside")
    ).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-testid^='coord-plan-kpi-']")
    ).toBeNull();
    // No number was invented for any row: no cost, no lead time, no zero.
    for (const row of screen.getAllByTestId("coord-plan-card")) {
      expect(row.textContent).not.toMatch(/list-price|\$\d|lead\d/);
    }
  });

  it("leaves the work-unit list working", async () => {
    route(
      new Error(
        `GET ${KPI_URL}?window=28d failed: 502 - coord is not reachable`
      )
    );
    await renderLoaded();
    await kpiState("unavailable");

    expect(screen.getAllByTestId("coord-plan-card")).toHaveLength(3);
    expect(
      screen.queryByTestId("coord-work-units-error")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-work-units-health")).toBeInTheDocument();
  });

  it("says so in an expanded row's detail, with no figure", async () => {
    route(new Error("Failed to fetch"));
    await renderLoaded();
    await kpiState("unavailable");

    const user = userEvent.setup();
    await user.click(
      within(rowFor("2026-10-01-measured")).getByRole("button", {
        expanded: false,
      })
    );
    const detail = await screen.findByTestId("coord-plan-kpis-detail");
    expect(
      within(detail).getByTestId("coord-plan-kpis-unavailable")
    ).toHaveTextContent("KPIs unavailable — Failed to fetch");
    expect(
      within(detail).queryByTestId("coord-plan-kpis-block")
    ).not.toBeInTheDocument();
  });

  it("treats a 200 that is not kpis/v1 as unavailable, not as an empty window", async () => {
    route({ work_units: [] });
    await renderLoaded();
    await kpiState("unavailable");
    expect(
      screen.getByTestId("coord-work-units-kpis-status")
    ).toHaveTextContent(
      "KPIs unavailable — coord answered, but not with a kpis/v1 body this build can read"
    );
    expect(
      screen.queryByTestId("coord-plan-kpis-outside")
    ).not.toBeInTheDocument();
  });

  it("keeps the figures it had when a later re-read fails, and says so", async () => {
    route(payload([unit("2026-10-01-measured")]));
    await renderLoaded();
    await kpiState("loaded");

    route(
      new Error(
        `GET ${KPI_URL}?window=28d failed: 502 - coord is not reachable`
      )
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("coord-work-units-refresh"));
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-work-units-kpis-status")
      ).toHaveTextContent("The latest re-read failed")
    );
    expect(
      within(rowFor("2026-10-01-measured")).getByTestId(
        "coord-plan-kpi-lead_time"
      )
    ).toBeInTheDocument();
  });
});

describe("/admin/coord/work-units KPI window and refresh", () => {
  it("re-asks once with the chosen window and shows no old-window figure meanwhile", async () => {
    route(payload([unit("2026-10-01-measured")]));
    await renderLoaded();
    await kpiState("loaded");

    route(
      payload([unit("2026-10-02-unmeasured")], {
        window: {
          days: 7,
          from: "2026-10-17T12:00:00Z",
          to: "2026-10-24T12:00:00Z",
        },
      })
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("coord-work-units-kpi-window-select"));
    await user.click(
      await screen.findByRole("option", { name: "Last 7 days" })
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("coord-work-units-kpis-status")
      ).toHaveTextContent("last 7 days")
    );
    expect(kpiReads()).toEqual([
      `${KPI_URL}?window=28d`,
      `${KPI_URL}?window=7d`,
    ]);
    // The new window's unit has figures; the old window's no longer does.
    expect(
      within(rowFor("2026-10-02-unmeasured")).getByTestId("coord-plan-kpi-cost")
    ).toBeInTheDocument();
    expect(
      within(rowFor("2026-10-01-measured")).queryByTestId("coord-plan-kpi-cost")
    ).not.toBeInTheDocument();
  });

  it("re-reads the KPIs once on a Refresh press, not on a timer", async () => {
    route(payload([unit("2026-10-01-measured")]));
    await renderLoaded();
    await kpiState("loaded");
    expect(kpiReads()).toHaveLength(1);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("coord-work-units-refresh"));
    await waitFor(() => expect(kpiReads()).toHaveLength(2));
  });
});
