import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Renewal,
  SpendSummary,
  SpendVendor,
  SummaryQuery,
} from "./_lib/spend-api";

/**
 * The Costs page against a mocked spend contract: an UNKNOWN provider reads
 * "Not available since <date> — <reason>" and a total over it is a floor;
 * the monthly figures default to amortized and the switch re-reads them as
 * charged; a day nobody reported is a gap, not $0; and "Add a recurring
 * cost" writes through the authoring kit's create.
 */

const mocks = vi.hoisted(() => ({
  canEdit: true,
  fetchSpendSummary: vi.fn(),
  fetchRenewals: vi.fn(),
  createResource: vi.fn(),
}));

vi.mock("../_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({
    projectId: "p1",
    hold: false,
    tenantsError: null,
    viewerId: "u1",
  }),
}));
vi.mock("./_lib/spend-api", () => ({
  fetchSpendSummary: mocks.fetchSpendSummary,
  fetchRenewals: mocks.fetchRenewals,
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useResourceDescriptor: () => ({
    name: "recurring_costs",
    can_edit: mocks.canEdit,
    schemas: {},
  }),
  EditGate: ({ children }: { children: React.ReactNode }) =>
    mocks.canEdit ? <>{children}</> : null,
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createResource: mocks.createResource,
}));
// jsdom has no layout, so give the chart a fixed size instead of measuring.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => (
      <div>
        {React.cloneElement(
          children as React.ReactElement<{ width: number; height: number }>,
          { width: 600, height: 300 }
        )}
      </div>
    ),
  };
});

import CostsPage from "./page";

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
    today_micros: 249_124_000,
    yesterday_micros: 359_446_000,
    last_month_micros: 3_867_340_000,
    balance_micros: null,
    ...over,
  };
}

const AWS = vendor({
  id: "aws",
  name: "AWS",
  connector: "aws_cost_explorer",
  status: "failed",
  status_reason: "Cost Explorer refused the request",
  newest_complete_day: "2026-10-01",
  provenance: "as reported by AWS Cost Explorer",
  month_to_date_micros: null,
  ceiling_micros: null,
  ceiling_pct: null,
  today_micros: null,
  yesterday_micros: null,
  last_month_micros: null,
});

const WORKSPACE = vendor({
  id: "gw",
  name: "Google Workspace",
  category: "saas",
  connector: null,
  status: "manual",
  provenance: null,
  last_ok_at: null,
  newest_complete_day: null,
  month_to_date_micros: 36_000_000,
  ceiling_micros: null,
  ceiling_pct: null,
  today_micros: 1_200_000,
  yesterday_micros: 1_200_000,
  last_month_micros: 36_000_000,
});

function summary(query: SummaryQuery): SpendSummary {
  const charged = query.view === "charged";
  return {
    currency: "USD",
    view: query.view,
    from: "2026-10-01",
    to: "2026-10-03",
    generated_at: "2026-10-03T12:00:00Z",
    vendors: [vendor({}), AWS, WORKSPACE],
    series:
      query.groupBy === "day"
        ? [
            {
              key: "2026-10-01",
              vendor_id: "gh",
              net_micros: 389_220_000,
              gross_micros: 400_000_000,
              discount_micros: 10_780_000,
              source: "connector",
            },
            // 2026-10-02: nothing reported by anyone — a gap.
            {
              key: "2026-10-03",
              vendor_id: "gh",
              net_micros: 249_124_000,
              gross_micros: null,
              discount_micros: null,
              source: "connector",
            },
          ]
        : [
            {
              key: query.groupBy === "sku" ? "Actions Linux" : "qontinui-web",
              vendor_id: "gh",
              net_micros: 600_000_000,
              gross_micros: 650_000_000,
              discount_micros: 50_000_000,
              source: "connector",
            },
          ],
    totals: {
      net_micros: charged ? 1 : 2,
      partial: true,
      unknown_vendors: ["AWS"],
    },
    alerts: [
      {
        id: "al1",
        rule: "mtd_threshold",
        scope_key: "org",
        period_key: "2026-10",
        observed_micros: 997_790_000,
        threshold_micros: 750_000_000,
        fired_at: "2026-10-03T06:15:00Z",
        push_status: "accepted",
        resolved_at: null,
        vendor_id: "gh",
        coord_status: "sent",
        detail: {},
      },
    ],
  };
}

const RENEWALS: Renewal[] = [
  {
    id: "r1",
    vendor_id: "nc",
    vendor_name: "Namecheap",
    description: "qontinui.io",
    external_ref: "qontinui.io",
    renews_on: "2026-11-02",
    amount_micros: 15_000_000,
    currency: "USD",
    auto_renew: null,
  },
];

beforeEach(() => {
  mocks.canEdit = true;
  mocks.fetchSpendSummary.mockReset();
  mocks.fetchSpendSummary.mockImplementation((q: SummaryQuery) =>
    Promise.resolve(summary(q))
  );
  mocks.fetchRenewals.mockReset();
  mocks.fetchRenewals.mockResolvedValue(RENEWALS);
  mocks.createResource.mockReset();
});

afterEach(cleanup);

/** Render the page and wait for the figures; answers the MTD value. */
async function ready(): Promise<HTMLElement> {
  render(<CostsPage />);
  await screen.findByText("This month so far");
  return byId("overview.costs.figure.mtd.value");
}

function radio(id: string): HTMLInputElement {
  return byId(id) as HTMLInputElement;
}

function byId(id: string): HTMLElement {
  const node = document.querySelector(`[data-ui-bridge-id="${id}"]`);
  if (!node) throw new Error(`no element ${id}`);
  return node as HTMLElement;
}

describe("an UNKNOWN provider", () => {
  it("reads 'Not available since <date> — <reason>' on its card", async () => {
    await ready();
    expect(byId("overview.costs.source.aws.unavailable").textContent).toBe(
      "Not available since Oct 1, 2026 — Cost Explorer refused the request"
    );
  });

  it("makes a total over it a floor that names it, never a bare total", async () => {
    const mtd = await ready();
    expect(mtd.textContent).toBe("at least $1,033.79 (AWS not available)");
    expect(byId("overview.costs.figure.yesterday.value").textContent).toBe(
      "at least $360.65 (AWS not available)"
    );
  });

  it("names where each figure came from", async () => {
    await ready();
    const provenance = byId("overview.costs.figure.mtd.provenance").textContent;
    expect(provenance).toContain(
      "GitHub: as reported by GitHub billing usage API"
    );
    expect(provenance).toContain(
      "Google Workspace: entered manually — from the provider's invoice"
    );
  });

  it("shows the alert's delivery as observed — accepted, not delivered", async () => {
    await ready();
    expect(byId("overview.costs.alerts.al1.coord").textContent).toBe(
      "Agents: handed to agents"
    );
    expect(byId("overview.costs.alerts.al1.push").textContent).toBe(
      "Accepted by the push service"
    );
  });
});

describe("the monthly-figures view", () => {
  it("defaults to amortized and switches to as charged", async () => {
    await ready();
    expect(mocks.fetchSpendSummary).toHaveBeenCalledWith(
      expect.objectContaining({ view: "amortized", groupBy: "day" })
    );
    expect(mocks.fetchSpendSummary).not.toHaveBeenCalledWith(
      expect.objectContaining({ view: "charged" })
    );
    expect(radio("overview.costs.view.amortized").checked).toBe(true);
    expect(radio("overview.costs.view.amortized").type).toBe("radio");
    expect(byId("overview.costs.figure.mtd").textContent).toContain(
      "Yearly costs amortized monthly"
    );

    fireEvent.click(byId("overview.costs.view.charged"));

    await waitFor(() =>
      expect(byId("overview.costs.figure.mtd").textContent).toContain(
        "Yearly costs charged on renewal"
      )
    );
    expect(mocks.fetchSpendSummary).toHaveBeenCalledWith(
      expect.objectContaining({ view: "charged", groupBy: "day" })
    );
    expect(mocks.fetchSpendSummary).toHaveBeenCalledWith(
      expect.objectContaining({ view: "charged", groupBy: "scope" })
    );
    expect(radio("overview.costs.view.charged").checked).toBe(true);
  });

  it("keeps the previous figures on screen while the new view loads", async () => {
    await ready();
    let release: (value: SpendSummary) => void = () => undefined;
    mocks.fetchSpendSummary.mockImplementation(
      (q: SummaryQuery) =>
        new Promise<SpendSummary>((resolve) => {
          release = (v) => resolve(v);
          void q;
        })
    );
    fireEvent.click(byId("overview.costs.view.charged"));
    await waitFor(() =>
      expect(byId("overview.costs.refreshing").textContent).toBe("Updating…")
    );
    // Still the amortized answer, not a skeleton.
    expect(byId("overview.costs.figure.mtd").textContent).toContain(
      "Yearly costs amortized monthly"
    );
    const calls = mocks.fetchSpendSummary.mock.calls as [SummaryQuery][];
    release(summary(calls[calls.length - 1]![0]));
  });

  it("labels each renewal as charged on renewal", async () => {
    await ready();
    await waitFor(() =>
      expect(byId("overview.costs.renewals.r1").textContent).toContain(
        "charged on renewal"
      )
    );
  });
});

describe("the daily chart", () => {
  it("leaves a day nobody reported as a gap, never $0", async () => {
    await ready();
    expect(byId("overview.costs.daily.gaps").textContent).toContain(
      "One day has no reported figures"
    );
    const table = byId("overview.costs.daily.table");
    const oct2 = within(table)
      .getByText("Oct 2, 2026")
      .closest("tr") as HTMLElement;
    expect(oct2.textContent).not.toContain("$0");
    expect(
      within(oct2).getAllByText("no data reported").length
    ).toBeGreaterThan(0);
  });
});

describe("the breakdown", () => {
  it("shows gross, discount and net, and drills down by SKU", async () => {
    await ready();
    await waitFor(() =>
      expect(
        byId("overview.costs.breakdown.row.gh.qontinui-web").textContent
      ).toContain("$650")
    );
    fireEvent.click(byId("overview.costs.breakdown.by.sku"));
    await waitFor(() =>
      expect(
        byId("overview.costs.breakdown.row.gh.Actions Linux").textContent
      ).toContain("$50")
    );
  });
});

describe("adding a recurring cost", () => {
  it("writes through the kit's create for recurring_costs", async () => {
    mocks.createResource.mockResolvedValue({ id: "rc1", version: 1 });
    await ready();
    fireEvent.click(byId("overview.costs.source.gw.add-recurring"));
    const form = byId("overview.costs.add-recurring");
    fireEvent.change(within(form).getByLabelText("What it is"), {
      target: { value: "Business Starter" },
    });
    // The currency is the summary's, shown and not editable.
    expect(
      byId("overview.costs.add-recurring.unit_amount_micros.currency")
        .textContent
    ).toContain("USD");
    expect(
      form.querySelector('input[aria-label="Amount per charge, currency"]')
    ).toBeNull();
    fireEvent.change(within(form).getByLabelText("Amount per charge"), {
      target: { value: "36" },
    });
    fireEvent.change(within(form).getByLabelText("Charged"), {
      target: { value: "monthly" },
    });
    fireEvent.change(within(form).getByLabelText("First charged on"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(byId("overview.costs.add-recurring.save"));

    await waitFor(() => expect(mocks.createResource).toHaveBeenCalled());
    const [path, body] = mocks.createResource.mock.calls[0]!;
    expect(path).toBe("spend/recurring-costs");
    expect(body).not.toHaveProperty("quantity");
    expect(body).toMatchObject({
      vendor_id: "gw",
      description: "Business Starter",
      unit_amount_micros: 36_000_000,
      currency: "USD",
      cadence: "monthly",
      start_date: "2026-09-01",
      renews_on: null,
    });
  });

  it("refuses an incomplete entry without writing", async () => {
    await ready();
    fireEvent.click(byId("overview.costs.source.gw.add-recurring"));
    fireEvent.click(byId("overview.costs.add-recurring.save"));
    expect(
      byId("overview.costs.add-recurring.description.error").textContent
    ).toBe("What it is can't be empty.");
    expect(mocks.createResource).not.toHaveBeenCalled();
  });

  it("announces the problems and focuses the first invalid field", async () => {
    await ready();
    fireEvent.click(byId("overview.costs.source.gw.add-recurring"));
    fireEvent.click(byId("overview.costs.add-recurring.save"));
    const summary = byId("overview.costs.add-recurring.summary");
    expect(summary.getAttribute("aria-live")).toBe("assertive");
    expect(summary.textContent).toMatch(/fields? needs? attention/);
    const description = screen.getByLabelText("What it is");
    await waitFor(() => expect(document.activeElement).toBe(description));
    expect(description.getAttribute("aria-invalid")).toBe("true");
    const error = byId("overview.costs.add-recurring.description.error");
    expect(description.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("links each help line to its field", async () => {
    await ready();
    fireEvent.click(byId("overview.costs.source.gw.add-recurring"));
    const amount = screen.getByLabelText("Amount per charge");
    const help = screen.getByText(/the amount on the provider's invoice/i);
    expect(amount.getAttribute("aria-describedby")).toContain(help.id);
  });

  it("refuses an end date before the first charge", async () => {
    await ready();
    fireEvent.click(byId("overview.costs.source.gw.add-recurring"));
    const form = byId("overview.costs.add-recurring");
    fireEvent.change(within(form).getByLabelText("What it is"), {
      target: { value: "Business Starter" },
    });
    fireEvent.change(within(form).getByLabelText("Amount per charge"), {
      target: { value: "36" },
    });
    fireEvent.change(within(form).getByLabelText("Charged"), {
      target: { value: "annual" },
    });
    fireEvent.change(within(form).getByLabelText("First charged on"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(within(form).getByLabelText("Ends on (optional)"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(within(form).getByLabelText("Next renewal (optional)"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(byId("overview.costs.add-recurring.save"));
    expect(
      byId("overview.costs.add-recurring.end_date.error").textContent
    ).toBe("Ends on can't be before the first charge.");
    expect(
      byId("overview.costs.add-recurring.renews_on.error").textContent
    ).toBe("Next renewal can't be before the first charge.");
    expect(mocks.createResource).not.toHaveBeenCalled();
  });

  it("offers no add action to a viewer who may not write", async () => {
    mocks.canEdit = false;
    await ready();
    expect(
      document.querySelector(
        '[data-ui-bridge-id="overview.costs.source.gw.add-recurring"]'
      )
    ).toBeNull();
  });
});
