/**
 * `/admin/coord/work-units/[slug]` — the Delivery KPIs panel.
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4. Pinned:
 *   - the panel asks coord for THIS unit — one `GET /api/v1/operations/kpis
 *     ?slug=<slug>`, no window — and every figure the plan lists is in the
 *     block;
 *   - UNKNOWN is `unknown — <reason> (n of m observed)`, never a zero; partial
 *     coverage is stated; cost is a list-price equivalent;
 *   - an empty `units` for that slug request is coord having no row for the
 *     unit: "No KPIs recorded", not a block of zeros, and not "outside a
 *     window" or "unknown" (there is no window, and truncation does not apply);
 *     an answer carrying a DIFFERENT unit is unavailable, not an absence;
 *   - a failed KPI read is "KPIs unavailable" with no figure, and the rest of
 *     the page — the unit's meta, the transition lever, the status history —
 *     is unaffected;
 *   - there is no window control: a slug read does not depend on one.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { kpi, payload, unit, unknown } from "@/test/kpisFixtures";

const httpGet = vi.fn();
vi.mock("@/services/service-factory", async () => {
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: (...args: unknown[]) => httpGet(...args),
      post: vi.fn(),
    }),
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: SLUG }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: false }),
}));

import CoordPlanDetailPage from "./page";

const SLUG = "2026-10-01-a-plan";
const KPI_URL = "/api/v1/operations/kpis";

function kpiReads(): string[] {
  return httpGet.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith(KPI_URL));
}

/** Route the page's three GETs. `kpis` may be a body or an Error. */
function route(kpis: unknown) {
  httpGet.mockImplementation((url: string) => {
    if (url.startsWith(KPI_URL)) {
      return kpis instanceof Error
        ? Promise.reject(kpis)
        : Promise.resolve(kpis);
    }
    if (url.endsWith("/history")) return Promise.resolve({ history: [] });
    return Promise.resolve({
      work_unit: { slug: SLUG, status: "shipped", title: "A plan" },
    });
  });
}

beforeEach(() => {
  httpGet.mockReset();
});

describe("CoordPlanDetailPage — Delivery KPIs", () => {
  it("asks coord for this unit by slug — one request, no window — and renders every figure the plan lists", async () => {
    route(
      payload([unit(SLUG)], {
        population: { shipped_units: 250, units_returned: 1, truncated: false },
      })
    );
    render(<CoordPlanDetailPage />);

    const block = await screen.findByTestId("coord-plan-kpis-block");
    expect(kpiReads()).toEqual([`${KPI_URL}?slug=${SLUG}`]);

    for (const [id, text] of [
      ["lead_time", "Lead time: 1h 30m (1 of 1 observed)"],
      ["lead_time_to_first_pr", "In progress → first PR opened: 30m"],
      ["lead_time_first_pr_to_landed", "First PR opened → last PR landed: 1h"],
      ["sessions", "Agent sessions: 3 (3 of 3 observed)"],
      ["tokens_input", "Input tokens: 12,345"],
      ["tokens_output", "Output tokens: 4,100"],
      ["tokens_cache_creation_input", "Cache-creation input tokens: 900"],
      ["tokens_cache_read_input", "Cache-read input tokens: 250,000"],
      [
        "cost",
        "Cost (list-price equivalent): $2.50 list-price equivalent (1 of 1 observed)",
      ],
      ["ci_attempts", "CI attempts: 4"],
      ["red_to_green", "Red→green iterations: 1"],
      ["interventions", "Interventions: 2"],
      [
        "rework",
        "Rework (reverted within 14 days of landing): 0 (1 of 1 observed)",
      ],
    ] as const) {
      expect(
        within(block).getByTestId(`coord-plan-kpi-row-${id}`)
      ).toHaveTextContent(text);
    }
    const status = screen.getByTestId("coord-plan-kpis-status");
    expect(status).toHaveTextContent("KPIs for this work unit.");
    expect(status).toHaveTextContent("list-price equivalent");
    // The window sentence belongs to the list read; this is not that.
    expect(status).not.toHaveTextContent(/last \d+ days|returned/);
    expect(screen.getByTestId("coord-plan-kpis-summary")).toHaveTextContent(
      "recorded"
    );
  });

  it("renders UNKNOWN figures as unknown — reason (coverage), never zero, and partial coverage as such", async () => {
    route(
      payload([
        unit(SLUG, {
          tokens: {
            input: unknown("no_usage_rows"),
            output: unknown("no_usage_rows"),
            cache_creation_input: unknown("no_usage_rows"),
            cache_read_input: unknown("no_usage_rows"),
          },
          cost_microusd: unknown("no_usage_rows"),
          interventions: unknown("not_yet_measured"),
          rework: unknown("revert_probe_not_run"),
          ci_attempts: kpi(7, { coverage_n: 1, population_n: 2 }),
        }),
      ])
    );
    render(<CoordPlanDetailPage />);
    const block = await screen.findByTestId("coord-plan-kpis-block");

    for (const [id, text] of [
      [
        "tokens_input",
        "Input tokens: unknown — no usage rows recorded (0 of 3 observed)",
      ],
      [
        "cost",
        "Cost (list-price equivalent): unknown — no usage rows recorded (0 of 3 observed)",
      ],
      [
        "interventions",
        "Interventions: unknown — not yet measured (0 of 3 observed)",
      ],
      ["rework", "unknown — revert probe has not run (0 of 3 observed)"],
      ["ci_attempts", "CI attempts: 7 (1 of 2 observed)"],
    ] as const) {
      const row = within(block).getByTestId(`coord-plan-kpi-row-${id}`);
      expect(row).toHaveTextContent(text);
    }
    const cost = within(block).getByTestId("coord-plan-kpi-row-cost");
    expect(cost).toHaveAttribute("data-kpi-state", "unknown");
    expect(cost.textContent).not.toMatch(/\$|: 0\b/);
    expect(
      within(block).getByTestId("coord-plan-kpi-row-ci_attempts")
    ).toHaveAttribute("data-kpi-partial", "true");
  });

  it("says 'No KPIs recorded' — not zeros — when coord has no row for the unit", async () => {
    route(payload([]));
    render(<CoordPlanDetailPage />);
    const note = await screen.findByTestId("coord-plan-kpis-unrecorded");
    expect(note).toHaveTextContent(
      "No KPIs recorded: coord has no KPI row for this work unit."
    );
    expect(
      screen.queryByTestId("coord-plan-kpis-block")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-plan-kpis-outside-detail")
    ).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-testid^='coord-plan-kpi-row-']")
    ).toBeNull();
    expect(screen.getByTestId("coord-plan-kpis-summary")).toHaveTextContent(
      "none recorded"
    );
    expect(kpiReads()).toEqual([`${KPI_URL}?slug=${SLUG}`]);
  });

  it("does not read a truncated flag into an absence: a slug read's empty units is still 'recorded none'", async () => {
    route(
      payload([], {
        population: { shipped_units: 250, units_returned: 0, truncated: true },
      })
    );
    render(<CoordPlanDetailPage />);
    expect(
      await screen.findByTestId("coord-plan-kpis-unrecorded")
    ).toHaveTextContent("No KPIs recorded");
  });

  it("is unavailable, not 'no KPIs recorded', when coord answers with a different unit", async () => {
    route(payload([unit("someone-else")]));
    render(<CoordPlanDetailPage />);
    expect(
      await screen.findByTestId("coord-plan-kpis-unavailable")
    ).toHaveTextContent(
      "KPIs unavailable — coord answered a request for one work unit with a different one"
    );
    expect(
      screen.queryByTestId("coord-plan-kpis-unrecorded")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-plan-kpis-block")
    ).not.toBeInTheDocument();
  });

  it("says KPIs are unavailable, with no figure, when the coord route is not deployed — and the rest of the page works", async () => {
    route(
      new Error(
        `GET ${KPI_URL}?slug=${SLUG} failed: 404 - {"error":"no_such_route"}`
      )
    );
    render(<CoordPlanDetailPage />);

    expect(
      await screen.findByTestId("coord-plan-kpis-unavailable")
    ).toHaveTextContent(
      "KPIs unavailable — coord does not serve work-unit KPIs yet (GET /coord/kpis). No figures are shown for this work unit."
    );
    expect(
      screen.queryByTestId("coord-plan-kpis-block")
    ).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-testid^='coord-plan-kpi-row-']")
    ).toBeNull();
    expect(screen.getByTestId("coord-plan-kpis-summary")).toHaveTextContent(
      "unavailable"
    );

    // Nothing else on the page depends on the KPIs.
    expect(await screen.findByTestId("coord-plan-meta")).toBeInTheDocument();
    expect(screen.getByTestId("coord-plan-history")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
  });

  it("has no window control, because a slug read does not depend on one", async () => {
    route(payload([unit(SLUG)]));
    render(<CoordPlanDetailPage />);
    await screen.findByTestId("coord-plan-kpis-block");
    expect(
      screen.queryByTestId("coord-plan-kpi-window-select")
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("KPI window")).not.toBeInTheDocument();
    // And nothing re-asked on its own.
    expect(kpiReads()).toHaveLength(1);
  });
});
