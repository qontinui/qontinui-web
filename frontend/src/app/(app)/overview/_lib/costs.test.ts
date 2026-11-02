import { describe, expect, it } from "vitest";
import {
  ENTRY_WRITABLE,
  RECURRING_WRITABLE,
  CATEGORY_WRITABLE,
  categoryKey,
  entryRowProblem,
  parseCategoriesCsv,
  parseEntriesCsv,
  parseRecurringCsv,
  planWrites,
  recurringBody,
  recurringRowProblem,
  type CategoryRow,
} from "./costs";

const categories = [
  { id: "c-hw", name: "Hardware" },
  { id: "c-legal", name: "Legal & registration" },
];

function category(id: string, name: string, description = ""): CategoryRow {
  return { id, version: 1, name, description };
}

describe("parseEntriesCsv", () => {
  it("reads a parts list with categories by name, delivery and refunds", () => {
    const { rows, issues } = parseEntriesCsv(
      [
        "date,what,paid to,category,amount,currency,delivered,received,order,notes",
        "2026-10-20,Ryzen 9 9950X,Mindfactory,hardware,649,eur,yes,,MF-1,CI box 1",
        '2026-10-21,64GB DDR5,Mindfactory,Hardware,"1,200.50",EUR,no,2026-10-24,,',
        "2026-10-02,EUIPO filing,EUIPO,Legal & registration,850,EUR,,,,",
        "2026-10-25,Returned PSU,Mindfactory,Hardware,-89,EUR,no,,,",
      ].join("\n"),
      categories
    );
    expect(issues).toEqual([]);
    expect(rows.map((r) => r.category_id)).toEqual([
      "c-hw",
      "c-hw",
      "c-legal",
      "c-hw",
    ]);
    expect(rows[0]).toMatchObject({
      amount_micros: 649_000_000,
      currency: "EUR",
      expects_delivery: true,
      received_on: null,
      order_ref: "MF-1",
    });
    // A received date implies a delivered item, even with "no".
    expect(rows[1]).toMatchObject({
      amount_micros: 1_200_500_000,
      expects_delivery: true,
      received_on: "2026-10-24",
    });
    expect(rows[2]!.expects_delivery).toBe(false);
    expect(rows[3]!.amount_micros).toBe(-89_000_000);
  });

  it("names the line and the problem rather than guessing", () => {
    const { rows, issues } = parseEntriesCsv(
      [
        "20/10/2026,x,,,1,EUR",
        "2026-10-20,,,,1,EUR",
        "2026-10-20,x,,,abc,EUR",
        "2026-10-20,x,,,1,euro",
        "2026-10-20,x,,Food,1,EUR",
        "2026-10-20,x,,,1,EUR,maybe",
      ].join("\n"),
      categories
    );
    expect(rows).toEqual([]);
    expect(issues.map((i) => i.line)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(issues[4]!.message).toContain("Hardware, Legal & registration");
  });
});

describe("parseRecurringCsv", () => {
  it("infers a varying cost when no amount is given", () => {
    const { rows, issues } = parseRecurringCsv(
      [
        "name,paid to,category,how often,kind,amount,currency,first due,last due,notes",
        "Claude Code Max,Anthropic,,monthly,,200,USD,2026-01-15,,",
        "AWS,Amazon,,monthly,,,USD,2026-01-01,,",
        "Domain,Namecheap,,yearly,same each time,12,USD,2026-03-01,,",
      ].join("\n"),
      []
    );
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.name, r.amount_kind, r.cadence])).toEqual([
      ["Claude Code Max", "fixed", "monthly"],
      ["AWS", "variable", "monthly"],
      ["Domain", "fixed", "annual"],
    ]);
  });

  it("refuses a fixed cost with no amount", () => {
    const { issues } = parseRecurringCsv(
      "Plan,,,monthly,same each time,,USD,2026-01-01",
      []
    );
    expect(issues[0]!.message).toContain("needs its amount");
  });
});

describe("planWrites", () => {
  const previous = [category("1", "Hardware"), category("2", "AI tools")];

  it("turns an edited table into one write per changed row", () => {
    const next = [
      category("1", "Hardware", "Servers"),
      category("", "Legal & registration"),
    ];
    const plan = planWrites(previous, next, "edit", CATEGORY_WRITABLE);
    expect(plan.creates.map((r) => r.name)).toEqual(["Legal & registration"]);
    expect(plan.updates).toEqual([
      { row: previous[0], patch: { description: "Servers" } },
    ]);
    expect(plan.deletes.map((r) => r.id)).toEqual(["2"]);
  });

  it("a paste updates a match only in the columns it gave, and never deletes", () => {
    const { rows } = parseCategoriesCsv("hardware,Servers and parts\nOther");
    const plan = planWrites(
      previous,
      rows,
      "import",
      CATEGORY_WRITABLE,
      categoryKey
    );
    expect(plan.updates).toEqual([
      { row: previous[0], patch: { description: "Servers and parts" } },
    ]);
    expect(plan.creates.map((r) => r.name)).toEqual(["Other"]);
    expect(plan.deletes).toEqual([]);
  });

  it("without a match key a paste only adds", () => {
    const { rows } = parseEntriesCsv("2026-10-20,x,,,1,EUR", []);
    const plan = planWrites([], rows, "import", ENTRY_WRITABLE);
    expect(plan.creates).toHaveLength(1);
  });
});

describe("rules mirrored from the server", () => {
  it("a received date needs a delivered item", () => {
    expect(
      entryRowProblem({ expects_delivery: false, received_on: "2026-10-01" })
    ).not.toBeNull();
    expect(
      entryRowProblem({ expects_delivery: true, received_on: "2026-10-01" })
    ).toBeNull();
  });

  it("a fixed recurring cost needs its amount", () => {
    expect(
      recurringRowProblem({ amount_kind: "fixed", amount_micros: null })
    ).not.toBeNull();
    expect(
      recurringRowProblem({ amount_kind: "variable", amount_micros: null })
    ).toBeNull();
  });

  it("a recurring cost's currency is never guessed", () => {
    expect(
      recurringBody({ name: "AWS", currency: null }, "EUR", "create")
    ).toEqual({ name: "AWS", currency: "EUR" });
    expect(
      typeof recurringBody({ name: "AWS", currency: null }, null, "create")
    ).toBe("string");
    // Clearing a typical amount keeps the stored currency.
    expect(
      recurringBody({ amount_micros: null, currency: null }, "EUR", "update")
    ).toEqual({ amount_micros: null });
    expect(RECURRING_WRITABLE).toContain("currency");
  });

  it("a pasted recurring cost changes only the columns it fills", () => {
    const { rows } = parseRecurringCsv("Domain,,,,,,,2025-01-01", []);
    expect(rows[0]!.supplied).toEqual(["start_date"]);
  });
});
