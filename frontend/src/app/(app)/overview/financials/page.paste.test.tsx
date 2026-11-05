import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CostCategory, CostEntry, RecurringCost } from "../_lib/costs-api";

/**
 * The Costs page's CSV paste, through the real `CostsPage` → `RecordSection`
 * → `RecordTable` → `CsvPasteDialog`: the commit button says what the
 * commit will write — an add, an update, or nothing — and the commit writes
 * exactly that. Each of these tables writes one record per row and never
 * removes on a paste, so no button here may say "Replace".
 */

const audited = {
  version: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  created_by: null,
  updated_by: null,
};

const CATEGORIES: CostCategory[] = [
  {
    ...audited,
    id: "c1",
    name: "Hardware",
    description: "Servers and parts",
    sort_order: 0,
  },
  {
    ...audited,
    id: "c2",
    name: "Legal & registration",
    description: "Incorporation and trademarks",
    sort_order: 1,
  },
];

const ENTRIES: CostEntry[] = [
  {
    ...audited,
    id: "e1",
    incurred_on: "2026-10-20",
    description: "AMD Ryzen 9 9950X",
    vendor: "Mindfactory",
    category_id: "c1",
    amount_micros: 649_000_000,
    currency: "EUR",
    quantity: 1,
    expects_delivery: false,
    received_on: null,
    order_ref: "",
    notes: "",
    recurring_cost_id: null,
    period_start: null,
  },
  {
    ...audited,
    id: "e2",
    incurred_on: "2026-10-02",
    description: "Trademark filing (EUIPO)",
    vendor: "EUIPO",
    category_id: "c2",
    amount_micros: 850_000_000,
    currency: "EUR",
    quantity: 1,
    expects_delivery: false,
    received_on: null,
    order_ref: "",
    notes: "",
    recurring_cost_id: null,
    period_start: null,
  },
];

/** The recorded Hardware cost, as a pasted line. */
const RYZEN_LINE = "2026-10-20,AMD Ryzen 9 9950X,Mindfactory,Hardware,649,EUR";

const RECURRING: RecurringCost[] = [];

const mocks = vi.hoisted(() => {
  const resource = () => ({
    create: vi.fn(),
    update: vi.fn(),
    drop: vi.fn(),
    replace: vi.fn(),
  });
  return {
    lists: {} as Record<string, { state: "ready"; items: unknown[] }>,
    resources: {
      "cost-categories": resource(),
      "recurring-costs": resource(),
      "cost-entries": resource(),
    } as Record<string, ReturnType<typeof resource>>,
    fetchCostSummary: vi.fn(),
    deleteCostEntry: vi.fn(),
    deleteCostCategory: vi.fn(),
    deleteRecurringCost: vi.fn(),
    fetchChangeLog: vi.fn(),
  };
});

vi.mock("../_hooks/useOverviewProject", () => ({
  useOverviewProject: () => ({
    projectId: "t1",
    hold: false,
    tenantsError: null,
  }),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useCanEdit: () => true,
  useResourceDescriptor: (name: string) => ({
    name,
    can_edit: true,
    schemas: {
      create: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", maxLength: 2000 },
          incurred_on: { type: "string", format: "date" },
          currency: { type: "string", minLength: 3, maxLength: 3 },
        },
      },
    },
  }),
}));
vi.mock("@/components/overview/editing/useResource", () => ({
  // Keyed by path; the list object is stable across renders, as the real
  // hook's state is.
  useResourceList: (path: string) => ({
    list: mocks.lists[path],
    ...mocks.resources[path],
  }),
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteCostEntry: mocks.deleteCostEntry,
  deleteCostCategory: mocks.deleteCostCategory,
  deleteRecurringCost: mocks.deleteRecurringCost,
  fetchChangeLog: mocks.fetchChangeLog,
}));
vi.mock("../_lib/costs-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCostSummary: mocks.fetchCostSummary,
}));
vi.mock("./_components/BillsToEnter", () => ({ BillsToEnter: () => null }));
vi.mock("./_components/CostHeadline", () => ({ CostHeadline: () => null }));
vi.mock("./_components/MonthTable", () => ({ MonthTable: () => null }));
vi.mock("./_components/StillToArrive", () => ({ StillToArrive: () => null }));
vi.mock("./_components/BaseCurrency", () => ({ BaseCurrency: () => null }));

import CostsPage from "./page";

const byId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-ui-bridge-id="${id}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lists["cost-categories"] = { state: "ready", items: CATEGORIES };
  mocks.lists["recurring-costs"] = { state: "ready", items: RECURRING };
  mocks.lists["cost-entries"] = { state: "ready", items: ENTRIES };
  for (const r of Object.values(mocks.resources)) {
    r.create.mockImplementation(async (body: Record<string, unknown>) => ({
      ok: true,
      item: { ...audited, id: "new", ...body },
    }));
    r.update.mockImplementation(
      async (current: object, patch: Record<string, unknown>) => ({
        ok: true,
        item: { ...current, ...patch, version: 2 },
      })
    );
  }
  mocks.fetchCostSummary.mockResolvedValue({
    base_currency: "EUR",
    periods: [],
    today: "2026-11-05",
    currencies: [],
    months: [],
  });
  mocks.fetchChangeLog.mockResolvedValue({ entries: [], truncated: false });
});

afterEach(cleanup);

/** Render the page; with `filter`, the entries show that category alone. */
async function shown(filter?: string) {
  const view = render(<CostsPage />);
  await screen.findAllByRole("button", { name: "Paste from a spreadsheet" });
  if (filter)
    fireEvent.change(byId("overview.costs.entries.filter")!, {
      target: { value: filter },
    });
  return view;
}

/** Paste `text` into a table's dialog and read it; the commit button. */
async function pasteInto(table: string, text: string, filter?: string) {
  await shown(filter);
  const paste = `${table}.table.paste`;
  fireEvent.click(byId(`${paste}.open`)!);
  fireEvent.change(byId(`${paste}.input`)!, { target: { value: text } });
  fireEvent.click(byId(`${paste}.read`)!);
  return byId(`${paste}.commit`) as HTMLButtonElement;
}

describe("pasting costs", () => {
  it("says one pasted cost is added, and adds exactly it", async () => {
    const commit = await pasteInto(
      "overview.costs.entries",
      "2026-11-05,ZZ label check,,,1,EUR"
    );
    expect(commit.textContent).toBe("Add this cost");
    expect(commit.textContent).not.toMatch(/Replace/);
    expect(
      byId("overview.costs.entries.table.paste.preview.row.0.fate")?.textContent
    ).toBe("Adds");
    await act(async () => {
      fireEvent.click(commit);
    });
    const entries = mocks.resources["cost-entries"]!;
    expect(entries.create).toHaveBeenCalledTimes(1);
    expect(entries.create).toHaveBeenCalledWith(
      expect.objectContaining({
        incurred_on: "2026-11-05",
        description: "ZZ label check",
        amount_micros: 1_000_000,
        currency: "EUR",
      }),
      { source: "import" }
    );
    expect(entries.update).not.toHaveBeenCalled();
    expect(mocks.deleteCostEntry).not.toHaveBeenCalled();
  });
});

describe("pasting categories", () => {
  it("says a line naming a category with a new description updates it", async () => {
    const commit = await pasteInto(
      "overview.costs.categories",
      "Hardware,Servers and racks"
    );
    expect(commit.textContent).toBe("Update this category");
    expect(
      byId("overview.costs.categories.table.paste.preview.row.0.fate")
        ?.textContent
    ).toBe("Updates");
    await act(async () => {
      fireEvent.click(commit);
    });
    const categories = mocks.resources["cost-categories"]!;
    expect(categories.update).toHaveBeenCalledTimes(1);
    expect(categories.update).toHaveBeenCalledWith(
      CATEGORIES[0],
      { description: "Servers and racks" },
      { source: "import" }
    );
    expect(categories.create).not.toHaveBeenCalled();
    expect(mocks.deleteCostCategory).not.toHaveBeenCalled();
  });

  it("offers nothing for a line repeating a category exactly", async () => {
    const commit = await pasteInto(
      "overview.costs.categories",
      "Hardware,Servers and parts"
    );
    expect(commit.textContent).toBe("Nothing to change");
    expect(commit.disabled).toBe(true);
    expect(
      byId("overview.costs.categories.table.paste.summary")?.textContent
    ).toBe(
      "Read 1 category. 1 of them is already recorded exactly like that and will be left alone."
    );
    fireEvent.click(commit);
    const categories = mocks.resources["cost-categories"]!;
    expect(categories.update).not.toHaveBeenCalled();
    expect(categories.create).not.toHaveBeenCalled();
  });
});

describe("the entries table's own rules", () => {
  const entries = () => mocks.resources["cost-entries"]!;
  const paste = "overview.costs.entries.table.paste";
  const editor = "overview.costs.entries.table.editor";

  it("refuses a pasted line repeating a recorded cost, at its line", async () => {
    const commit = await pasteInto("overview.costs.entries", RYZEN_LINE);
    expect(byId(`${paste}.issues`)?.textContent).toBe(
      "line 1: There is already a cost with this combination."
    );
    expect(commit.textContent).toBe("Nothing to change");
    expect(commit.disabled).toBe(true);
    fireEvent.click(commit);
    expect(entries().create).not.toHaveBeenCalled();
  });

  it("refuses it while the category filter hides the recorded cost", async () => {
    const commit = await pasteInto(
      "overview.costs.entries",
      `${RYZEN_LINE}\n2026-11-05,ZZ new cost,,,1,EUR`,
      "c2"
    );
    // The recorded Ryzen is not in the table the reader sees.
    expect(byId("overview.costs.entries.table.row.1")).toBeNull();
    expect(byId(`${paste}.issues`)?.textContent).toBe(
      "line 1: There is already a cost with this combination."
    );
    expect(commit.textContent).toBe("Add this cost");
    await act(async () => {
      fireEvent.click(commit);
    });
    expect(entries().create).toHaveBeenCalledTimes(1);
    expect(entries().create).toHaveBeenCalledWith(
      expect.objectContaining({ description: "ZZ new cost" }),
      { source: "import" }
    );
  });

  it("refuses a typed add that repeats a hidden cost", async () => {
    await shown("c2");
    fireEvent.click(byId("overview.costs.entries.table.add")!);
    const type = (id: string, value: string) =>
      fireEvent.change(byId(`${editor}.${id}`)!, { target: { value } });
    type("incurred_on", "2026-10-20");
    type("description", "AMD Ryzen 9 9950X");
    type("vendor", "Mindfactory");
    type("amount_micros.amount", "649");
    type("amount_micros.currency", "EUR");
    await act(async () => {
      fireEvent.click(byId(`${editor}.done`)!);
    });
    expect(byId(editor)?.textContent).toMatch(
      "There is already a cost with this combination."
    );
    expect(entries().create).not.toHaveBeenCalled();
  });

  it("deletes no hidden cost when an entry is edited with the filter on", async () => {
    await shown("c2");
    fireEvent.click(byId("overview.costs.entries.table.row.0.edit")!);
    fireEvent.change(byId(`${editor}.notes`)!, {
      target: { value: "Class 9 and 42" },
    });
    await act(async () => {
      fireEvent.click(byId(`${editor}.done`)!);
    });
    expect(entries().update).toHaveBeenCalledTimes(1);
    expect(entries().update).toHaveBeenCalledWith(
      ENTRIES[1],
      { notes: "Class 9 and 42" },
      { source: "ui" }
    );
    expect(entries().create).not.toHaveBeenCalled();
    expect(mocks.deleteCostEntry).not.toHaveBeenCalled();
  });

  it("keeps an open entries edit through a page re-render with the filter on", async () => {
    const view = await shown("c2");
    fireEvent.click(byId("overview.costs.entries.table.row.0.edit")!);
    expect(byId(editor)).not.toBeNull();
    view.rerender(<CostsPage />);
    expect(byId(editor)).not.toBeNull();
  });
});
