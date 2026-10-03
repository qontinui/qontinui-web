"use client";

/**
 * Paste a table from a spreadsheet, see what was read, then decide — the CSV
 * paste every record table shares (plan `2026-09-20-overview-authoring-layer`
 * §3).
 *
 * Three steps, and nothing is applied by typing:
 *
 * 1. **Paste** the text.
 * 2. **Read it**: the table's own column mapping parses it, and every row it
 *    produced is then checked against the schema the server serves for the
 *    table. The preview shows the rows that will be used and, by line, every
 *    one that will not and why.
 * 3. **Commit**: the readable rows replace the table in the working copy. That
 *    is still not a save — the page's Save is what reaches the server, and it
 *    records the write as an import.
 */

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JsonSchema } from "./api";
import type { CsvIssue } from "./csv";
import { cellText, rowProblems } from "./fields";
import type { TableDeclaration } from "./registry";

/** Problems found in a paste or an import, each on its line when it has one. */
export function IssueList({
  issues,
  uiBridgeId,
}: {
  issues: CsvIssue[];
  uiBridgeId: string;
}) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5" data-ui-bridge-id={uiBridgeId}>
      {issues.map((issue, index) => (
        <li
          key={`${issue.line}-${index}`}
          className={`text-sm leading-relaxed ${
            issue.severity === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {issue.line > 0 && (
            <span className="font-mono text-xs">line {issue.line}: </span>
          )}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

export interface PastePreview<Row> {
  /** The rows that will be used. */
  rows: Row[];
  /** Everything that will not, and every warning, ordered by line. */
  issues: CsvIssue[];
}

/**
 * Parse `text` with the table's mapping, then refuse — as an issue on its
 * line — every row the served schema would refuse. Pure; the dialog shows it.
 */
export function previewPaste<Row extends object>(
  table: TableDeclaration<Row>,
  text: string,
  rowSchema: JsonSchema | undefined
): PastePreview<Row> {
  const parsed = table.csv.parse(text);
  const rows: Row[] = [];
  const issues: CsvIssue[] = [...parsed.issues];
  parsed.rows.forEach((row, index) => {
    const problems = rowProblems(table, row, rowSchema);
    if (problems.length === 0) {
      rows.push(row);
      return;
    }
    issues.push({
      line: parsed.lines[index] ?? 0,
      text: "",
      message: problems.join(" "),
      severity: "error",
    });
  });
  issues.sort((a, b) => a.line - b.line);
  return { rows, issues };
}

export function CsvPasteDialog<Row extends object>({
  table,
  rowSchema,
  onCommit,
  busy = false,
  uiBridgeId,
}: {
  table: TableDeclaration<Row>;
  /** The row shape the server validates, from the resource catalog. */
  rowSchema: JsonSchema | undefined;
  /** The rows to replace the table with. */
  onCommit: (rows: Row[]) => void;
  /**
   * A save is in flight. Committing during one changes the working copy the
   * open request is NOT carrying.
   */
  busy?: boolean;
  uiBridgeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PastePreview<Row> | null>(null);
  const inputId = useId();

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const close = () => {
    setOpen(false);
    setText("");
    setPreview(null);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => setOpen(true)}
        data-ui-bridge-id={`${uiBridgeId}.open`}
      >
        Paste from a spreadsheet
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent
          className="max-h-[90vh] max-w-3xl overflow-y-auto"
          data-ui-bridge-id={uiBridgeId}
        >
          <DialogHeader>
            <DialogTitle>{table.csv.label}</DialogTitle>
            <DialogDescription>{table.csv.help}</DialogDescription>
          </DialogHeader>
          <label htmlFor={inputId} className="sr-only">
            The pasted table
          </label>
          <textarea
            id={inputId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            rows={8}
            spellCheck={false}
            placeholder={table.csv.placeholder}
            className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-ui-bridge-id={`${uiBridgeId}.input`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={text.trim() === ""}
              onClick={() => setPreview(previewPaste(table, text, rowSchema))}
              data-ui-bridge-id={`${uiBridgeId}.read`}
            >
              Read it
            </Button>
            {preview && (
              <p
                role="status"
                className="text-sm text-muted-foreground"
                data-ui-bridge-id={`${uiBridgeId}.summary`}
              >
                {preview.rows.length === 0
                  ? "Nothing could be read from that."
                  : `Read ${preview.rows.length} ${
                      preview.rows.length === 1 ? table.singular : table.plural
                    }.`}
                {errors.length > 0 &&
                  ` ${errors.length} line${errors.length === 1 ? "" : "s"} could not be used and ${
                    errors.length === 1 ? "is" : "are"
                  } listed below; ${
                    errors.length === 1 ? "it is" : "they are"
                  } left out.`}
              </p>
            )}
          </div>
          {preview && (
            <IssueList
              issues={preview.issues}
              uiBridgeId={`${uiBridgeId}.issues`}
            />
          )}
          {preview && preview.rows.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table
                className="w-full border-collapse text-sm"
                data-ui-bridge-id={`${uiBridgeId}.preview`}
              >
                <thead>
                  <tr className="border-b border-border text-left">
                    {table.fields.map((field) => (
                      <th
                        key={field.field}
                        scope="col"
                        className="px-2 py-1.5 font-medium text-muted-foreground"
                      >
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={index} className="border-b border-border/60">
                      {table.fields.map((field) => (
                        <td
                          key={field.field}
                          className="px-2 py-1 text-foreground"
                        >
                          {cellText(field, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={close}
              data-ui-bridge-id={`${uiBridgeId}.cancel`}
            >
              Cancel
            </Button>
            {preview && (
              <Button
                type="button"
                disabled={preview.rows.length === 0 || busy}
                onClick={() => {
                  onCommit(preview.rows);
                  close();
                }}
                data-ui-bridge-id={`${uiBridgeId}.commit`}
              >
                Replace the {table.plural} with{" "}
                {preview.rows.length === 1
                  ? "this one"
                  : `these ${preview.rows.length}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
