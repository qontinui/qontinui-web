import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ParsedRoleRow } from "@/app/(app)/overview/_lib/csv";
import { ROLE_SCHEMA } from "./__fixtures__/estimate-schema";
import { RecordTable } from "./RecordTable";
import { ESTIMATE_ROLES } from "./registry";

/**
 * The record table edits a working copy: every change is handed to the
 * caller, typed changes as `edit` and pastes as `import`, and nothing the API
 * would refuse gets into it. For a reader the controls are absent.
 */

const rows: ParsedRoleRow[] = [
  {
    code: "DL",
    name: "Delivery lead",
    responsibility: "",
    day_rate_micros: 900_000_000,
    currency: "EUR",
    client_side: false,
  },
  {
    code: "BE",
    name: "Backend",
    responsibility: "",
    day_rate_micros: null,
    currency: null,
    client_side: true,
  },
];

function show(canEdit = true) {
  const onChange = vi.fn();
  render(
    <RecordTable
      table={ESTIMATE_ROLES}
      rows={rows}
      onChange={onChange}
      canEdit={canEdit}
      rowSchema={ROLE_SCHEMA}
      uiBridgeId="t.roles"
    />
  );
  return onChange;
}

describe("RecordTable", () => {
  it("shows a reader the rows and no controls at all", () => {
    show(false);
    expect(screen.getByText("Delivery lead")).toBeTruthy();
    expect(screen.getByText("not priced")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Add|Edit|Remove|Paste/ })
    ).toBeNull();
  });

  it("adds a row once it is valid, and says what is wrong until then", () => {
    const onChange = show();
    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "QA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Role can't be empty.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Tester" },
    });
    fireEvent.change(screen.getByLabelText("Day rate, amount"), {
      target: { value: "620" },
    });
    fireEvent.change(screen.getByLabelText("Day rate, currency"), {
      target: { value: "eur" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith(
      [
        ...rows,
        {
          code: "QA",
          name: "Tester",
          responsibility: "",
          day_rate_micros: 620_000_000,
          currency: "EUR",
          client_side: false,
        },
      ],
      "edit"
    );
  });

  it("refuses a second row with the same code", () => {
    const onChange = show();
    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    fireEvent.change(screen.getByLabelText("Code"), {
      target: { value: "BE" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Dup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.getByText("There is already a role with this code.")
    ).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("edits a row in place", () => {
    const onChange = show();
    const row = screen.getByText("Backend").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Backend engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith(
      [rows[0], { ...rows[1], name: "Backend engineer" }],
      "edit"
    );
  });

  it("removes a row only once that is confirmed", () => {
    const onChange = show();
    const row = screen.getByText("Delivery lead").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "Keep" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith([rows[1]], "edit");
  });

  it("sorts what it shows without reordering the rows", () => {
    const onChange = show();
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    const codes = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0]?.textContent);
    expect(codes).toEqual(["BE", "DL"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hands a paste over as an import", () => {
    const onChange = show();
    fireEvent.click(
      screen.getByRole("button", { name: "Paste from a spreadsheet" })
    );
    fireEvent.change(screen.getByLabelText("The pasted table"), {
      target: { value: "code,name\nOP,Platform" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Replace the roles with this one" })
    );
    expect(onChange).toHaveBeenCalledWith(
      [
        {
          code: "OP",
          name: "Platform",
          responsibility: "",
          day_rate_micros: null,
          currency: null,
          client_side: false,
        },
      ],
      "import"
    );
  });

  it("drops an open edit when the rows are replaced underneath it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RecordTable
        table={ESTIMATE_ROLES}
        rows={rows}
        onChange={onChange}
        canEdit
        rowSchema={ROLE_SCHEMA}
        uiBridgeId="t.roles"
      />
    );
    const row = screen.getByText("Backend").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    rerender(
      <RecordTable
        table={ESTIMATE_ROLES}
        rows={[rows[0]!]}
        onChange={onChange}
        canEdit
        rowSchema={ROLE_SCHEMA}
        uiBridgeId="t.roles"
      />
    );
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
