import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SpendSummary, SpendVendor } from "../_lib/spend-api";
import { SpendFigures } from "./SpendFigures";

/**
 * The ceiling meter reads what the ceiling is measured against when the
 * server says so, falls back to the month to date when it does not, and
 * never calls a known amount "not available" just because its share of the
 * ceiling was not reported.
 */

afterEach(cleanup);

function vendor(over: Partial<SpendVendor>): SpendVendor {
  return {
    id: "gh",
    name: "GitHub",
    category: "source_hosting",
    connector: "github_billing",
    status: "ok",
    status_reason: null,
    last_ok_at: "2026-10-03T06:10:00Z",
    newest_complete_day: "2026-10-02",
    expected_lag_hours: 24,
    provenance: "as reported by GitHub billing usage API",
    month_to_date_micros: 997_790_000,
    ceiling_micros: 750_000_000,
    ceiling_pct: 133,
    today_micros: 1,
    yesterday_micros: 1,
    last_month_micros: 1,
    balance_micros: null,
    ...over,
  };
}

function render1(v: SpendVendor) {
  const summary: SpendSummary = {
    currency: "USD",
    view: "amortized",
    from: "2026-10-01",
    to: "2026-10-03",
    generated_at: "2026-10-03T12:00:00Z",
    vendors: [v],
    series: [],
    totals: { net_micros: 0, partial: false, unknown_vendors: [] },
    alerts: [],
  };
  render(<SpendFigures summary={summary} />);
  return document.querySelector(
    '[data-ui-bridge-id="overview.costs.meter.gh"]'
  ) as HTMLElement;
}

describe("the ceiling meter", () => {
  it("shows the ceiling basis of the ceiling when the server sends one", () => {
    const meter = render1(vendor({ ceiling_basis_micros: 900_000_000 }));
    expect(meter.textContent).toContain(
      "GitHub: $900 counted against the $750 ceiling this month"
    );
    expect(meter.querySelector('[role="meter"]')).not.toBeNull();
  });

  it("falls back to the month to date when the field is absent", () => {
    const meter = render1(vendor({}));
    expect(meter.textContent).toContain("GitHub: $997.79 of $750 this month");
  });

  it("does not call a known amount 'not available' when the share is missing", () => {
    // The backend sends a null basis whenever the pct is null.
    const meter = render1(
      vendor({ ceiling_pct: null, ceiling_basis_micros: null })
    );
    expect(meter.textContent).toContain("GitHub: $997.79 of $750 this month");
    expect(meter.textContent).not.toContain("Not available");
    expect(meter.querySelector('[role="meter"]')).toBeNull();
  });

  it("says not available when the basis itself is unknown", () => {
    const meter = render1(
      vendor({
        ceiling_basis_micros: null,
        ceiling_pct: null,
        month_to_date_micros: null,
        status: "failed",
        status_reason: "the import failed",
      })
    );
    expect(meter.textContent).toContain("Not available");
  });
});

describe("the figures list", () => {
  it("holds only dt/dd inside each group", () => {
    render1(vendor({}));
    const groups = document.querySelectorAll("dl > div");
    expect(groups.length).toBe(4);
    for (const group of groups) {
      for (const child of group.children) {
        expect(["DT", "DD"]).toContain(child.tagName);
      }
    }
  });
});
