import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ALLOCATION_SCHEMA, ROLE_SCHEMA } from "./__fixtures__/estimate-schema";
import type { ParsedRoleRow } from "@/app/(app)/overview/_lib/csv";
import {
  CsvPasteDialog,
  alreadyRecordedText,
  commitLabel,
  previewPaste,
  replacesWorkingCopy,
  type PasteOutcome,
} from "./CsvPasteDialog";
import { ESTIMATE_ALLOCATIONS, ESTIMATE_ROLES } from "./registry";
import type { ImportFate } from "./writes";

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
      pasteOutcome={replacesWorkingCopy}
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
        pasteOutcome={replacesWorkingCopy}
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

/** A cost-like row for the label tests: only its fates matter. */
type Row = { id: string; what: string };
const TABLE = { singular: "category", plural: "categories" };
const row = (what: string): Row => ({ id: "", what });
const add = (): ImportFate<Row> => ({ kind: "add", row: row("new") });
const upd = (): ImportFate<Row> => ({
  kind: "update",
  row: row("x"),
  match: { id: "1", what: "y" },
  patch: { what: "x" },
});
const same = (): ImportFate<Row> => ({
  kind: "unchanged",
  row: row("y"),
  match: { id: "1", what: "y" },
});
const merge = (...fates: ImportFate<Row>[]): PasteOutcome<Row> => ({
  kind: "merge",
  fates,
});

describe("commitLabel", () => {
  it("says a replace replaces, and offers nothing for no rows", () => {
    expect(commitLabel(TABLE, 1, replacesWorkingCopy())).toEqual({
      text: "Replace the categories with this one",
      enabled: true,
    });
    expect(commitLabel(TABLE, 4, replacesWorkingCopy())).toEqual({
      text: "Replace the categories with these 4",
      enabled: true,
    });
    expect(commitLabel(TABLE, 0, replacesWorkingCopy())).toEqual({
      text: "Nothing to change",
      enabled: false,
    });
  });

  it("says a merge that only adds adds", () => {
    expect(commitLabel(TABLE, 1, merge(add()))).toEqual({
      text: "Add this category",
      enabled: true,
    });
    expect(commitLabel(TABLE, 3, merge(add(), add(), add()))).toEqual({
      text: "Add these 3 categories",
      enabled: true,
    });
  });

  it("says a merge that only updates updates", () => {
    expect(commitLabel(TABLE, 1, merge(upd()))).toEqual({
      text: "Update this category",
      enabled: true,
    });
    expect(commitLabel(TABLE, 3, merge(upd(), upd(), same()))).toEqual({
      text: "Update these 2 categories",
      enabled: true,
    });
  });

  it("names both counts when a merge adds and updates", () => {
    expect(commitLabel(TABLE, 3, merge(add(), upd(), upd()))).toEqual({
      text: "Add 1 category and update 2",
      enabled: true,
    });
    expect(commitLabel(TABLE, 4, merge(add(), add(), upd(), same()))).toEqual({
      text: "Add 2 categories and update 1",
      enabled: true,
    });
  });

  it("offers nothing when every row is already recorded", () => {
    expect(commitLabel(TABLE, 2, merge(same(), same()))).toEqual({
      text: "Nothing to change",
      enabled: false,
    });
    expect(commitLabel(TABLE, 0, merge())).toEqual({
      text: "Nothing to change",
      enabled: false,
    });
  });
});

describe("alreadyRecordedText", () => {
  it("counts the rows left alone, in agreement with their number", () => {
    expect(alreadyRecordedText(0)).toBe("");
    expect(alreadyRecordedText(1)).toBe(
      "1 of them is already recorded exactly like that and will be left alone."
    );
    expect(alreadyRecordedText(2)).toBe(
      "2 of them are already recorded exactly like that and will be left alone."
    );
  });
});

describe("CsvPasteDialog with a merge outcome", () => {
  // DL updates, BE is already recorded as pasted, OP and QA are new.
  const byCode = (pasted: ParsedRoleRow[]): PasteOutcome<ParsedRoleRow> => ({
    kind: "merge",
    fates: pasted.map((r): ImportFate<ParsedRoleRow> => {
      if (r.code === "DL")
        return { kind: "update", row: r, match: r, patch: { name: r.name } };
      if (r.code === "BE") return { kind: "unchanged", row: r, match: r };
      return { kind: "add", row: r };
    }),
  });

  function openMerge(text: string, onCommit = vi.fn()) {
    render(
      <CsvPasteDialog
        table={ESTIMATE_ROLES}
        rowSchema={ROLE_SCHEMA}
        onCommit={onCommit}
        pasteOutcome={byCode}
        uiBridgeId="t.paste"
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Paste from a spreadsheet" })
    );
    fireEvent.change(screen.getByLabelText("The pasted table"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    return onCommit;
  }

  it("says line by line what each row does, and what the commit does", () => {
    const onCommit = openMerge(
      "code,name\nDL,Lead\nBE,Backend\nOP,Platform\nQA,Quality"
    );
    expect(
      screen.getByRole("columnheader", { name: "This line" })
    ).toBeTruthy();
    const fates = [0, 1, 2, 3].map(
      (i) =>
        document.querySelector(
          `[data-ui-bridge-id="t.paste.preview.row.${i}.fate"]`
        )?.textContent
    );
    expect(fates).toEqual(["Updates", "No change", "Adds", "Adds"]);
    expect(screen.getByRole("status").textContent).toBe(
      "Read 4 roles. 1 of them is already recorded exactly like that and will be left alone."
    );
    const commit = screen.getByRole("button", {
      name: "Add 2 roles and update 1",
    });
    expect(commit.textContent).not.toMatch(/Replace/);
    fireEvent.click(commit);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('offers a disabled "Nothing to change" that never commits', () => {
    const onCommit = openMerge("code,name\nBE,Backend");
    const commit = screen.getByRole("button", {
      name: "Nothing to change",
    }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    fireEvent.click(commit);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('shows no "This line" column for a replace', () => {
    open();
    fireEvent.change(screen.getByLabelText("The pasted table"), {
      target: { value: "role,A0\nDL,1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect(
      screen.queryByRole("columnheader", { name: "This line" })
    ).toBeNull();
    expect(
      document.querySelector('[data-ui-bridge-id="t.paste.preview.row.0.fate"]')
    ).toBeNull();
  });
});
