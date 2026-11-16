import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ENTRY_WRITABLE,
  arrangeEntries,
  entryTable,
  entryToRow,
  type EntryRow,
} from "../../_lib/costs";
import type { CostEntry } from "../../_lib/costs-api";
import { RecordSection } from "./RecordSection";

vi.mock("@/components/overview/editing/permissions", () => ({
  useResourceDescriptor: () => null,
}));
vi.mock("@/components/overview/editing/ChangeLogPanel", () => ({
  ChangeLogPanel: () => null,
}));

const entry = (id: string, incurred_on: string, description: string) =>
  ({
    id,
    version: 1,
    incurred_on,
    description,
    vendor: "",
    category_id: null,
    amount_micros: 1_000_000,
    currency: "EUR",
    quantity: 1,
    expects_delivery: false,
    received_on: null,
    order_ref: "",
    notes: "",
    recurring_cost_id: null,
    period_start: null,
    created_at: `${incurred_on}T00:00:00Z`,
    updated_at: `${incurred_on}T00:00:00Z`,
    created_by: null,
    updated_by: null,
  }) as CostEntry;

const table = entryTable([]);

function Harness({ initial }: { initial: CostEntry[] }) {
  const [records, setRecords] = useState(initial);
  return (
    <RecordSection<CostEntry, EntryRow>
      resource="cost_entries"
      table={table}
      records={records}
      toRow={entryToRow}
      writable={ENTRY_WRITABLE}
      toBody={(fields) => ({ ...fields })}
      label={(row) => row.description}
      describe={(row) => row.description}
      canEdit
      create={async (body) => {
        const item = entry(
          "new-1",
          String(body.incurred_on),
          String(body.description)
        );
        setRecords((all) => [...all, item]);
        return { ok: true, item };
      }}
      update={vi.fn()}
      remove={vi.fn()}
      drop={vi.fn()}
      replace={vi.fn()}
      onWritten={vi.fn()}
      uiBridgeId="t.entries"
      arrange={arrangeEntries}
      newRowFirst
    />
  );
}

const descriptions = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.textContent ?? "");

describe("RecordSection with newest-first entries", () => {
  const initial = [
    entry("a", "2026-01-10", "January"),
    entry("c", "2026-03-10", "March"),
    entry("b", "2026-02-10", "February"),
  ];

  it("lists the latest entry first by default", () => {
    render(<Harness initial={initial} />);
    const rows = descriptions();
    expect(rows[0]).toContain("March");
    expect(rows[2]).toContain("January");
  });

  it("lets a column sort override the default, and sorting back clears it", () => {
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: /^Date/ }));
    expect(descriptions()[0]).toContain("January");
    fireEvent.click(screen.getByRole("button", { name: /^Date/ }));
    expect(descriptions()[0]).toContain("March");
  });

  it("opens the add row under the buttons and pins the new entry at the top", async () => {
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a cost" }));
    expect(
      screen.getAllByRole("row")[1]?.querySelector("input, select")
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2020-05-05" },
    });
    fireEvent.change(screen.getByLabelText("What"), {
      target: { value: "Ancient purchase" },
    });
    fireEvent.change(screen.getByLabelText("Amount, amount"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Amount, currency"), {
      target: { value: "EUR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(descriptions()[0]).toContain("Ancient"));
    expect(descriptions()[1]).toContain("March");
  });
});
