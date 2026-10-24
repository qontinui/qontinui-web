/**
 * The KPI cells as they reach the DOM — on a `<PlanRow>` (the list page's
 * unit) and as the detail block (the `[slug]` page's).
 *
 * Plan `2026-10-09-kpi-telemetry-and-dashboards` Phase 4. The pure words are
 * pinned in `workUnitKpis.test.ts`; this asserts the components wire them
 * through without a path that prints a number for an UNKNOWN figure:
 *   - a row with no `kpi` prop (every other surface) renders no KPI markup;
 *   - pending and unavailable rows render no chip at all;
 *   - an UNKNOWN chip prints `unknown`, never `0`, and carries its reason;
 *   - a partially covered chip prints `(n/m)`;
 *   - the cost chip is labelled a list-price equivalent;
 *   - the expanded detail carries the whole block, on its own testids.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { kpi, payload, unit, unknown } from "@/test/kpisFixtures";
import { PlanRow } from "./PlanRow";
import { KpiBlock, KpiRowChips } from "./WorkUnitKpiCells";
import { indexKpis, kpiCell, KPI_PENDING, type KpiCell } from "./workUnitKpis";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const READ = "2026-10-24T12:01:00Z";

function cellFor(slug: string, units = [unit(slug)]): KpiCell {
  return kpiCell(indexKpis(payload(units), READ), slug);
}

function renderRow(kpiCellValue: KpiCell | undefined, expanded = false) {
  return render(
    <PlanRow
      plan={{ slug: "2026-10-01-a-plan", status: "shipped" }}
      expanded={expanded}
      onToggle={() => {}}
      kpi={kpiCellValue}
    />
  );
}

describe("KPI chips on a PlanRow", () => {
  it("renders no KPI markup when the surface passed no `kpi`", () => {
    renderRow(undefined, true);
    expect(screen.queryByTestId("coord-plan-kpis")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-plan-kpis-outside")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-plan-kpis-detail")
    ).not.toBeInTheDocument();
  });

  it("renders no chip while pending or unavailable — the page line says it once", () => {
    const { rerender } = renderRow({ kind: "pending" });
    expect(screen.queryByTestId("coord-plan-kpis")).not.toBeInTheDocument();
    rerender(
      <PlanRow
        plan={{ slug: "p", status: "shipped" }}
        expanded={false}
        onToggle={() => {}}
        kpi={{ kind: "unavailable", reason: "coord is not reachable" }}
      />
    );
    expect(screen.queryByTestId("coord-plan-kpis")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$|list-price/);
  });

  it("prints the four headline figures of a known unit", () => {
    renderRow(cellFor("2026-10-01-a-plan"));
    expect(screen.getByTestId("coord-plan-kpi-lead_time")).toHaveTextContent(
      "lead1h 30m"
    );
    expect(screen.getByTestId("coord-plan-kpi-cost")).toHaveTextContent(
      "list-price equiv.$2.50"
    );
    expect(
      screen.getByTestId("coord-plan-kpi-interventions")
    ).toHaveTextContent("interventions2");
    expect(screen.getByTestId("coord-plan-kpi-rework")).toHaveTextContent(
      "rework0"
    );
    // Known, including the known zero.
    expect(screen.getByTestId("coord-plan-kpi-rework")).toHaveAttribute(
      "data-kpi-state",
      "known"
    );
  });

  it("labels the cost chip a list-price equivalent, in text and hover", () => {
    renderRow(cellFor("2026-10-01-a-plan"));
    const chip = screen.getByTestId("coord-plan-kpi-cost");
    expect(chip).toHaveTextContent("list-price equiv.");
    expect(chip.getAttribute("title")).toContain("list-price equivalent");
  });

  it("prints UNKNOWN for a null figure — never 0 — with its reason on the chip", () => {
    renderRow(
      cellFor("2026-10-01-a-plan", [
        unit("2026-10-01-a-plan", {
          cost_microusd: unknown("no_usage_rows"),
          interventions: unknown("not_yet_measured"),
          rework: unknown("revert_probe_not_run"),
        }),
      ])
    );
    const cost = screen.getByTestId("coord-plan-kpi-cost");
    expect(cost).toHaveTextContent("list-price equiv.unknown");
    expect(cost).toHaveAttribute("data-kpi-state", "unknown");
    expect(cost).toHaveAttribute("data-kpi-reason", "no_usage_rows");
    expect(cost.getAttribute("title")).toContain(
      "unknown — no usage rows recorded (0 of 3 observed)"
    );
    expect(cost.textContent).not.toMatch(/\$|\b0\b/);

    const rework = screen.getByTestId("coord-plan-kpi-rework");
    expect(rework).toHaveTextContent("reworkunknown");
    expect(rework.textContent).not.toMatch(/\b0\b/);
    expect(rework.getAttribute("title")).toContain("revert probe has not run");
  });

  it("prints partial coverage as (n/m) beside the number", () => {
    renderRow(
      cellFor("2026-10-01-a-plan", [
        unit("2026-10-01-a-plan", {
          cost_microusd: kpi(2_500_000, { coverage_n: 2, population_n: 3 }),
        }),
      ])
    );
    const cost = screen.getByTestId("coord-plan-kpi-cost");
    expect(cost).toHaveTextContent("$2.50 (2/3)");
    expect(cost).toHaveAttribute("data-kpi-partial", "true");
    expect(cost.getAttribute("title")).toContain("2 of 3 observed");
  });

  it("says 'no KPIs in window' for a unit coord returned no row for — not a row of zeros", () => {
    renderRow(
      kpiCell(
        indexKpis(payload([unit("someone-else")]), READ),
        "2026-10-01-a-plan"
      )
    );
    const chip = screen.getByTestId("coord-plan-kpis-outside");
    expect(chip).toHaveTextContent("no KPIs in window");
    expect(chip).toHaveAttribute("data-kpi-state", "none");
    expect(screen.queryByTestId("coord-plan-kpi-cost")).not.toBeInTheDocument();
  });

  it("says 'KPIs unknown' when the answer was truncated", () => {
    renderRow(
      kpiCell(
        indexKpis(
          payload([unit("someone-else")], {
            population: {
              shipped_units: 9,
              units_returned: 1,
              truncated: true,
            },
          }),
          READ
        ),
        "2026-10-01-a-plan"
      )
    );
    const chip = screen.getByTestId("coord-plan-kpis-outside");
    expect(chip).toHaveTextContent("KPIs unknown");
    expect(chip).toHaveAttribute("data-kpi-state", "unknown");
  });

  it("carries the whole block in the expanded detail", () => {
    renderRow(cellFor("2026-10-01-a-plan"), true);
    const detail = screen.getByTestId("coord-plan-kpis-detail");
    expect(
      within(detail).getByTestId("coord-plan-kpis-block")
    ).toBeInTheDocument();
    // Every figure the plan lists is in the detail, not only the four chips.
    for (const id of [
      "lead_time",
      "tokens_input",
      "tokens_output",
      "cost",
      "ci_attempts",
      "red_to_green",
      "interventions",
      "rework",
    ]) {
      expect(
        within(detail).getByTestId(`coord-plan-kpi-row-${id}`)
      ).toBeInTheDocument();
    }
  });

  it("renders the unavailable state in the detail, with no figure", () => {
    renderRow({ kind: "unavailable", reason: "coord is not reachable" }, true);
    const detail = screen.getByTestId("coord-plan-kpis-detail");
    expect(
      within(detail).getByTestId("coord-plan-kpis-unavailable")
    ).toHaveTextContent("KPIs unavailable — coord is not reachable");
    expect(
      within(detail).queryByTestId("coord-plan-kpis-block")
    ).not.toBeInTheDocument();
  });
});

describe("KpiRowChips", () => {
  it("renders nothing for pending", () => {
    const { container } = render(
      <KpiRowChips cell={kpiCell(KPI_PENDING, "a")} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("KpiBlock", () => {
  it("renders every figure with its basis and coverage", () => {
    render(<KpiBlock cell={cellFor("a")} />);
    const lead = screen.getByTestId("coord-plan-kpi-row-lead_time");
    expect(lead).toHaveTextContent("Lead time: 1h 30m (1 of 1 observed)");
    expect(lead).toHaveTextContent("first in_progress to last cited PR landed");
    const cost = screen.getByTestId("coord-plan-kpi-row-cost");
    expect(cost).toHaveTextContent(
      "Cost (list-price equivalent): $2.50 list-price equivalent (1 of 1 observed)"
    );
    expect(
      screen.getByTestId("coord-plan-kpi-row-interventions-split")
    ).toHaveTextContent(
      "policy-authorized 1 · not policy-authorized 0 · authorization unknown 1"
    );
    expect(screen.getByTestId("coord-plan-kpi-row-prs")).toHaveTextContent(
      "cited 2 · landed 2"
    );
  });

  it("renders an UNKNOWN row as unknown — reason (coverage), with no number", () => {
    render(
      <KpiBlock
        cell={cellFor("a", [
          unit("a", {
            tokens: {
              input: unknown("no_usage_rows"),
              output: unknown("no_usage_rows"),
              cache_creation_input: unknown("no_usage_rows"),
              cache_read_input: unknown("no_usage_rows"),
            },
          }),
        ])}
      />
    );
    const row = screen.getByTestId("coord-plan-kpi-row-tokens_input");
    expect(row).toHaveAttribute("data-kpi-state", "unknown");
    expect(row).toHaveAttribute("data-kpi-reason", "no_usage_rows");
    expect(row).toHaveTextContent(
      "Input tokens: unknown — no usage rows recorded (0 of 3 observed)"
    );
    expect(row.textContent).not.toMatch(/: 0\b/);
  });

  it("marks a partially covered row, in the sentence and as an attribute", () => {
    render(
      <KpiBlock
        cell={cellFor("a", [
          unit("a", {
            ci_attempts: kpi(7, { coverage_n: 1, population_n: 2 }),
          }),
        ])}
      />
    );
    const row = screen.getByTestId("coord-plan-kpi-row-ci_attempts");
    expect(row).toHaveAttribute("data-kpi-partial", "true");
    expect(row).toHaveTextContent("CI attempts: 7 (1 of 2 observed)");
  });

  it("states pending, unavailable and outside in words, with no figure", () => {
    const { rerender } = render(<KpiBlock cell={{ kind: "pending" }} />);
    expect(screen.getByTestId("coord-plan-kpis-pending")).toHaveTextContent(
      "Reading KPIs…"
    );
    rerender(
      <KpiBlock
        cell={{ kind: "unavailable", reason: "timeout waiting for coord" }}
      />
    );
    expect(screen.getByTestId("coord-plan-kpis-unavailable")).toHaveTextContent(
      "KPIs unavailable — timeout waiting for coord. No figures are shown for this work unit."
    );
    rerender(
      <KpiBlock
        cell={{
          kind: "outside",
          coverageUnknown: false,
          sentence: "No KPIs in the last 28 days: gone.",
        }}
      />
    );
    expect(
      screen.getByTestId("coord-plan-kpis-outside-detail")
    ).toHaveTextContent("No KPIs in the last 28 days: gone.");
    expect(
      screen.queryByTestId("coord-plan-kpis-block")
    ).not.toBeInTheDocument();
  });
});
