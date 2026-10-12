import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ALLOCATION_SCHEMA, ROLE_SCHEMA } from "./__fixtures__/estimate-schema";
import { CsvPasteDialog, previewPaste } from "./CsvPasteDialog";
import { ESTIMATE_ALLOCATIONS, ESTIMATE_ROLES } from "./registry";

/**
 * The paste contract — paste, read, see every line that will not be used and
 * why, then commit only what was read — against a PARTIALLY invalid file:
 * some lines the column mapping cannot read, one the served schema refuses.
 */

const PARTLY_BAD = [
  "role,A0,A1",
  "DL,0.5,1",
  "BE,two,2", // "two" cannot be read
  ",1,1", // no role
  "QA,100000,", // more than the column holds — the schema refuses it
].join("\n");

describe("previewPaste", () => {
  it("keeps the readable rows and names every refused line", () => {
    const preview = previewPaste(
      ESTIMATE_ALLOCATIONS,
      PARTLY_BAD,
      ALLOCATION_SCHEMA
    );
    expect(preview.rows).toEqual([
      { phase_code: "A0", role_code: "DL", fte: "0.5" },
      { phase_code: "A1", role_code: "DL", fte: "1" },
      { phase_code: "A1", role_code: "BE", fte: "2" },
    ]);
    expect(preview.issues.map((i) => [i.line, i.severity, i.message])).toEqual([
      [3, "error", '"two" under A0 was not read as a number of people'],
      [4, "error", "this row has no role code in its first column"],
      [5, "error", "People (FTE) must be less than 100,000."],
    ]);
  });
});

function open(onCommit = vi.fn(), busy = false) {
  render(
    <CsvPasteDialog
      table={ESTIMATE_ALLOCATIONS}
      rowSchema={ALLOCATION_SCHEMA}
      onCommit={onCommit}
      busy={busy}
      uiBridgeId="t.paste"
    />
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Paste from a spreadsheet" })
  );
  return onCommit;
}

describe("CsvPasteDialog", () => {
  it("previews, lists the refused lines, and commits only the readable rows", () => {
    const onCommit = open();
    // Nothing to commit until the text has been read.
    expect(screen.queryByRole("button", { name: /Replace the/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("The pasted table"), {
      target: { value: PARTLY_BAD },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));

    expect(screen.getByRole("status").textContent).toBe(
      "Read 3 allocations. 3 lines could not be used and are listed below; they are left out."
    );
    expect(screen.getByText(/People \(FTE\) must be less than/)).toBeTruthy();
    expect(screen.getByText("line 5:")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Replace the allocations with these 3",
      })
    );
    expect(onCommit).toHaveBeenCalledWith([
      { phase_code: "A0", role_code: "DL", fte: "0.5" },
      { phase_code: "A1", role_code: "DL", fte: "1" },
      { phase_code: "A1", role_code: "BE", fte: "2" },
    ]);
  });

  it("forgets a reading once the text changes", () => {
    open();
    const input = screen.getByLabelText("The pasted table");
    fireEvent.change(input, { target: { value: "role,A0\nDL,1" } });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect(screen.getByRole("button", { name: /Replace the/ })).toBeTruthy();
    fireEvent.change(input, { target: { value: "role,A0\nDL,2" } });
    expect(screen.queryByRole("button", { name: /Replace the/ })).toBeNull();
  });

  it("cannot be opened while a save is in flight", () => {
    render(
      <CsvPasteDialog
        table={ESTIMATE_ROLES}
        rowSchema={ROLE_SCHEMA}
        onCommit={vi.fn()}
        busy
        uiBridgeId="t.paste"
      />
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Paste from a spreadsheet",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
