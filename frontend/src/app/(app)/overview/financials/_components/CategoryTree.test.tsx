import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldEditor } from "@/components/overview/editing/FieldEditor";
import { RecordTable } from "@/components/overview/editing/RecordTable";
import {
  categoryTable,
  categoryTree,
  type CategoryRow,
} from "../../_lib/costs";
import type { CategoryTotal, CurrencyTotals } from "../../_lib/costs-api";
import { CategoryTree } from "./CategoryTree";

const categories = [
  { id: "pc", name: "Computers", parent_id: null },
  { id: "ship", name: "spaceship", parent_id: "pc" },
  { id: "nawa", name: "nawa", parent_id: "pc" },
];

function total(
  id: string | null,
  parent: string | null,
  own: number,
  rolled: number,
  extra: Partial<CategoryTotal> = {}
): CategoryTotal {
  return {
    category_id: id,
    parent_id: parent,
    currency: "EUR",
    own_recorded_micros: own,
    own_scheduled_micros: 0,
    own_awaiting_amount_count: 0,
    rolled_recorded_micros: rolled,
    rolled_scheduled_micros: 0,
    rolled_awaiting_amount_count: 0,
    ...extra,
  };
}

const grand: CurrencyTotals = {
  currency: "EUR",
  spent_to_date_micros: 111_000_000,
  scheduled_micros: 0,
  this_month_micros: 0,
  awaiting_delivery_micros: 0,
};

describe("CategoryTree", () => {
  it("shows each parent's own costs and its rollup, children indented", () => {
    render(
      <CategoryTree
        categories={categories}
        totals={[
          total("pc", null, 10_000_000, 111_000_000),
          total("ship", "pc", 100_000_000, 100_000_000),
          total("nawa", "pc", 1_000_000, 1_000_000),
        ]}
        currencies={[grand]}
      />
    );
    const parentRow = screen
      .getByText("Computers")
      .closest("tr") as HTMLElement;
    // Own, then the rollup; the leaf shows no rollup column.
    expect(within(parentRow).getAllByRole("cell")).toHaveLength(2);
    expect(parentRow.textContent).toContain("10");
    expect(parentRow.textContent).toContain("111");
    const leaf = screen.getByText("spaceship");
    expect(leaf.getAttribute("data-depth")).toBe("1");
    expect(screen.getByText("Computers").getAttribute("data-depth")).toBe("0");
    // The grand total is the server's, not a sum down the page.
    const totalCell = document.querySelector(
      '[data-ui-bridge-id="overview.costs.tree.EUR.total"]'
    );
    expect(totalCell?.textContent).toContain("111");
  });

  it("counts a bill awaiting its amount, up the tree", () => {
    render(
      <CategoryTree
        categories={categories}
        totals={[
          total("pc", null, 0, 0, { rolled_awaiting_amount_count: 1 }),
          total("ship", "pc", 0, 0, {
            own_awaiting_amount_count: 1,
            rolled_awaiting_amount_count: 1,
          }),
        ]}
        currencies={[]}
      />
    );
    expect(screen.getAllByText(/1 amount to enter/)).toHaveLength(2);
  });

  it("says so when nothing has been spent", () => {
    render(
      <CategoryTree categories={categories} totals={[]} currencies={[]} />
    );
    expect(screen.getByText("Nothing has been spent yet.")).toBeTruthy();
  });
});

describe("the categories table", () => {
  it("shows subcategories indented under their parent, with the parent named", () => {
    const rows: CategoryRow[] = categoryTree(categories).map((n) => ({
      id: n.category.id,
      version: 1,
      name: n.category.name,
      parent_id: n.category.parent_id ?? null,
      description: "",
    }));
    render(
      <RecordTable
        table={categoryTable(categories)}
        rows={rows}
        canEdit={false}
        onChange={() => {}}
        uiBridgeId="t.categories"
      />
    );
    const child = screen.getByText("spaceship");
    expect(child.closest("span[data-depth]")?.getAttribute("data-depth")).toBe(
      "1"
    );
    const row = child.closest("tr") as HTMLElement;
    expect(row.textContent).toContain("Computers");
  });
});

describe("a money field's layout", () => {
  it("gives the amount the room and the currency a compact fixed width", () => {
    render(
      <FieldEditor
        field={{
          field: "amount",
          currencyField: "currency",
          label: "Amount",
          kind: "money",
          emptyLabel: "—",
        }}
        text={{ amount: "12,345.67", currency: "EUR" }}
        onChange={() => {}}
        error={null}
        errorId="e"
        uiBridgeId="t.money"
      />
    );
    const amount = screen.getByLabelText("Amount, amount");
    const currency = screen.getByLabelText("Amount, currency");
    expect(amount.className).toContain("flex-1");
    expect(amount.className).toContain("min-w-[8rem]");
    expect(amount.className).not.toContain("w-full");
    expect(currency.className).toContain("w-24");
    // No second width to fight it: the currency box must not be `w-full`.
    expect(currency.className).not.toContain("w-full");
    expect(currency.className).toContain("shrink-0");
  });
});
