"use client";

/**
 * A table of records, editable in place — the kit's record editor (plan
 * `2026-09-20-overview-authoring-layer` §3), built entirely from a registry
 * declaration (`registry.ts`).
 *
 * - **Add, edit inline, remove with confirmation, sort** — every field through
 *   `FieldEditor`, every row checked against the schema the server serves
 *   before it is accepted, so the table never holds a row the API would
 *   refuse.
 * - **CSV paste** through `CsvPasteDialog`: preview, per-line problems, then
 *   commit.
 *
 * It edits a WORKING COPY: `onChange` hands the new rows to the caller, whose
 * own Save writes them through the contract (`If-Match`, a conflict dialog,
 * the change log). `how` says whether the change was typed or imported, so
 * that write can name its source. Without `canEdit` the controls are ABSENT,
 * never disabled-and-teasing.
 */

import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JsonSchema } from "./api";
import { CsvPasteDialog } from "./CsvPasteDialog";
import { FieldEditor } from "./FieldEditor";
import {
  cellText,
  identityKey,
  rowToText,
  sortValue,
  textToRow,
  type RowText,
} from "./fields";
import type { TableDeclaration } from "./registry";

export type ChangeHow = "edit" | "import";

type Editing = {
  /** The row's index in `rows`, or `"new"` for a row being added. */
  at: number | "new";
  text: RowText;
  errors: Record<string, string>;
};

const SMALL_BUTTON =
  "inline-flex min-h-9 items-center rounded-md px-2 text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function RecordTable<Row extends object>({
  table,
  rows,
  onChange,
  canEdit,
  busy = false,
  rowSchema,
  onEditingChange,
  onPasteTextChange,
  reopen = null,
  uiBridgeId,
}: {
  table: TableDeclaration<Row>;
  rows: Row[];
  onChange: (rows: Row[], how: ChangeHow) => void;
  canEdit: boolean;
  busy?: boolean;
  /** The row shape the server validates, from the resource catalog. */
  rowSchema: JsonSchema | undefined;
  /** Told whenever a row editor opens or closes, so the page can hold its
   *  Save while typed text is not yet in the working copy. */
  onEditingChange?: (open: boolean) => void;
  /** Told whether the paste dialog holds uncommitted text. */
  onPasteTextChange?: (hasText: boolean) => void;
  /**
   * Open the editor on row `at`, holding `row` instead of what the table
   * shows — a copy combined from mine and a peer's newer version after a
   * conflict, for the writer to finish and save. A new object reopens it.
   */
  reopen?: { at: number; row: Row } | null;
  uiBridgeId: string;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [sort, setSort] = useState<{ field: string; up: boolean } | null>(null);
  const baseId = useId();

  // An open edit or removal names a row by its INDEX. When the rows are
  // replaced from outside (a paste, a version taken from a peer) that index
  // can name a different row, and "Done" would overwrite it — so both are
  // dropped. The table's own commits replace `rows` too, with nothing open.
  useEffect(() => {
    setEditing(null);
    setRemoving(null);
  }, [rows]);
  // Declared after the effect above, so a reopen arriving with new rows is
  // not dropped by it.
  useEffect(() => {
    if (!reopen) return;
    setRemoving(null);
    setEditing({
      at: reopen.at,
      text: rowToText(table, reopen.row),
      errors: {},
    });
    // `table` is deliberately not a dependency: a re-declared table must not
    // re-open an editor the writer has since closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen]);

  const editorOpen = editing !== null;
  useEffect(() => {
    onEditingChange?.(editorOpen);
  }, [editorOpen, onEditingChange]);

  // Sorting orders what is SHOWN; the rows keep their own order, which is the
  // order they are saved in.
  const order = useMemo(() => {
    const indices = rows.map((_row, index) => index);
    const field = sort && table.fields.find((f) => f.field === sort.field);
    if (!sort || !field) return indices;
    return indices.sort((a, b) => {
      const x = sortValue(field, rows[a] as Row);
      const y = sortValue(field, rows[b] as Row);
      const cmp =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.up ? cmp : -cmp;
    });
  }, [rows, sort, table.fields]);

  const startEdit = (at: number | "new") => {
    setRemoving(null);
    const row = at === "new" ? table.blank() : (rows[at] as Row);
    setEditing({ at, text: rowToText(table, row), errors: {} });
  };

  const commit = () => {
    if (!editing) return;
    const base =
      editing.at === "new" ? table.blank() : (rows[editing.at] as Row);
    const read = textToRow(table, editing.text, rowSchema, base);
    if ("errors" in read) {
      setEditing({ ...editing, errors: read.errors });
      return;
    }
    const key = identityKey(table, read.row);
    const clash = rows.some(
      (other, index) =>
        index !== editing.at && identityKey(table, other) === key
    );
    if (clash) {
      const first = table.identity[0] as string;
      const label = table.fields.find((f) => f.field === first)?.label ?? first;
      setEditing({
        ...editing,
        errors: {
          [first]: `There is already a ${table.singular} with this ${
            table.identity.length > 1 ? "combination" : label.toLowerCase()
          }.`,
        },
      });
      return;
    }
    const next =
      editing.at === "new"
        ? [...rows, read.row]
        : rows.map((row, index) => (index === editing.at ? read.row : row));
    setEditing(null);
    onChange(next, "edit");
  };

  const editRow = (at: number | "new") =>
    editing && editing.at === at ? editing : null;

  const renderEditor = (state: Editing) => (
    <tr
      className="border-b border-border/60 bg-muted/20 align-top"
      data-ui-bridge-id={`${uiBridgeId}.editor`}
    >
      {table.fields.map((field) => {
        const errorId = `${baseId}-${field.field}-error`;
        const error = state.errors[field.field] ?? null;
        return (
          <td key={field.field} className="px-2 py-1.5">
            <FieldEditor
              field={field}
              text={state.text}
              onChange={(text) => setEditing({ ...state, text })}
              error={error}
              errorId={errorId}
              uiBridgeId={`${uiBridgeId}.editor.${field.field}`}
            />
            {error && (
              <p id={errorId} className="mt-1 text-xs text-destructive">
                {error}
              </p>
            )}
          </td>
        );
      })}
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        <button
          type="button"
          onClick={commit}
          disabled={busy}
          className={`${SMALL_BUTTON} text-primary`}
          data-ui-bridge-id={`${uiBridgeId}.editor.done`}
        >
          Done
        </button>
        <button
          type="button"
          onClick={() => setEditing(null)}
          className={`${SMALL_BUTTON} text-muted-foreground`}
          data-ui-bridge-id={`${uiBridgeId}.editor.cancel`}
        >
          Cancel
        </button>
      </td>
    </tr>
  );

  return (
    <div className="space-y-3" data-ui-bridge-id={uiBridgeId}>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || editing !== null}
            onClick={() => startEdit("new")}
            data-ui-bridge-id={`${uiBridgeId}.add`}
          >
            Add a {table.singular}
          </Button>
          <CsvPasteDialog
            table={table}
            rowSchema={rowSchema}
            busy={busy || editing !== null}
            onCommit={(pasted) => {
              setSort(null);
              onChange(pasted, "import");
            }}
            onTextChange={onPasteTextChange}
            uiBridgeId={`${uiBridgeId}.paste`}
          />
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[30rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {table.fields.map((field) => {
                const sorted = sort?.field === field.field ? sort : null;
                return (
                  <th
                    key={field.field}
                    scope="col"
                    aria-sort={
                      sorted ? (sorted.up ? "ascending" : "descending") : "none"
                    }
                    className="px-2 py-1.5 font-medium text-muted-foreground"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort({
                          field: field.field,
                          up: sorted ? !sorted.up : true,
                        })
                      }
                      className="inline-flex min-h-9 items-center gap-1 rounded-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-ui-bridge-id={`${uiBridgeId}.sort.${field.field}`}
                    >
                      {field.label}
                      <span aria-hidden className="text-xs">
                        {sorted ? (sorted.up ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
              {canEdit && (
                <th scope="col" className="px-2 py-1.5">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !editRow("new") && (
              <tr>
                <td
                  colSpan={table.fields.length + (canEdit ? 1 : 0)}
                  className="px-2 py-3 text-muted-foreground"
                  data-ui-bridge-id={`${uiBridgeId}.empty`}
                >
                  {table.emptyText}
                </td>
              </tr>
            )}
            {order.map((index) => {
              const row = rows[index] as Row;
              const state = editRow(index);
              if (state)
                return <Fragment key={index}>{renderEditor(state)}</Fragment>;
              return (
                <tr
                  key={index}
                  className="border-b border-border/60"
                  data-ui-bridge-id={`${uiBridgeId}.row.${index}`}
                >
                  {table.fields.map((field) => (
                    <td
                      key={field.field}
                      className={`px-2 py-1.5 ${
                        field.kind === "code"
                          ? "font-mono text-xs text-muted-foreground"
                          : "text-foreground"
                      } ${
                        field.kind === "money" || field.kind === "decimal"
                          ? "text-right tabular-nums"
                          : ""
                      }`}
                    >
                      {cellText(field, row)}
                    </td>
                  ))}
                  {canEdit && (
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {removing === index ? (
                        <span
                          role="group"
                          aria-label={`Remove this ${table.singular}?`}
                        >
                          <span className="mr-1 text-xs text-muted-foreground">
                            Remove it?
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setRemoving(null);
                              onChange(
                                rows.filter((_r, i) => i !== index),
                                "edit"
                              );
                            }}
                            className={`${SMALL_BUTTON} text-destructive`}
                            data-ui-bridge-id={`${uiBridgeId}.row.${index}.remove.confirm`}
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoving(null)}
                            className={`${SMALL_BUTTON} text-muted-foreground`}
                            data-ui-bridge-id={`${uiBridgeId}.row.${index}.remove.cancel`}
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy || editing !== null}
                            onClick={() => startEdit(index)}
                            className={`${SMALL_BUTTON} text-primary`}
                            data-ui-bridge-id={`${uiBridgeId}.row.${index}.edit`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy || editing !== null}
                            onClick={() => setRemoving(index)}
                            className={`${SMALL_BUTTON} text-muted-foreground`}
                            data-ui-bridge-id={`${uiBridgeId}.row.${index}.remove`}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {editing?.at === "new" && renderEditor(editing)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
