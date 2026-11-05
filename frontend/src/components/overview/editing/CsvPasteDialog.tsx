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
 * 3. **Commit**: the readable rows go to the caller, and what that does is
 *    the caller's to say, from its own write plan (`pasteOutcome`):
 *    - in the estimate editor they REPLACE the table in a working copy, and
 *      only that page's Save reaches the server;
 *    - in a per-record table (costs, milestones) each row is ADDED, or
 *      UPDATES the one existing record it matches, and every write happens at
 *      once; nothing is removed.
 *
 *    The commit button says exactly which (`commitLabel`), and for a merge
 *    the preview says it line by line.
 */

import { useEffect, useId, useState } from "react";
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
import type { ImportFate } from "./writes";

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

/**
 * What committing a paste does, as the caller's own write plan says.
 *
 * - `replace` — the rows read replace the table (the estimate editor's
 *   working copy).
 * - `merge` — each row read is written as its fate says; `fates` runs
 *   parallel to the rows read.
 */
export type PasteOutcome<Row> =
  | { kind: "replace" }
  | { kind: "merge"; fates: ImportFate<Row>[] };

/** The outcome of a table whose paste replaces a working copy. */
export function replacesWorkingCopy(): { kind: "replace" } {
  return { kind: "replace" };
}

/** How many of a merge's rows each fate takes. */
function fateCounts<Row>(fates: readonly ImportFate<Row>[]) {
  const counts = { add: 0, update: 0, unchanged: 0 };
  for (const fate of fates) {
    switch (fate.kind) {
      case "add":
        counts.add += 1;
        break;
      case "update":
        counts.update += 1;
        break;
      case "unchanged":
        counts.unchanged += 1;
        break;
      default: {
        const unhandled: never = fate;
        throw new Error(`Unhandled import fate: ${String(unhandled)}`);
      }
    }
  }
  return counts;
}

/** What one previewed line will do, in the preview's "This line" column. */
function fateText<Row>(fate: ImportFate<Row>): string {
  switch (fate.kind) {
    case "add":
      return "Adds";
    case "update":
      return "Updates";
    case "unchanged":
      return "No change";
    default: {
      const unhandled: never = fate;
      throw new Error(`Unhandled import fate: ${String(unhandled)}`);
    }
  }
}

/**
 * The commit button's text, and whether it may be pressed — derived from the
 * outcome, so the button cannot say anything the commit does not do.
 */
export function commitLabel<Row extends object>(
  table: Pick<TableDeclaration<Row>, "singular" | "plural">,
  rowCount: number,
  outcome: PasteOutcome<Row>
): { text: string; enabled: boolean } {
  const nothing = { text: "Nothing to change", enabled: false };
  if (outcome.kind === "replace") {
    if (rowCount === 0) return nothing;
    return {
      text: `Replace the ${table.plural} with ${
        rowCount === 1 ? "this one" : `these ${rowCount}`
      }`,
      enabled: true,
    };
  }
  const { add: a, update: u } = fateCounts(outcome.fates);
  if (a === 0 && u === 0) return nothing;
  if (u === 0)
    return {
      text:
        a === 1
          ? `Add this ${table.singular}`
          : `Add these ${a} ${table.plural}`,
      enabled: true,
    };
  if (a === 0)
    return {
      text:
        u === 1
          ? `Update this ${table.singular}`
          : `Update these ${u} ${table.plural}`,
      enabled: true,
    };
  return {
    text: `Add ${a} ${a === 1 ? table.singular : table.plural} and update ${u}`,
    enabled: true,
  };
}

/** The status line's sentence for rows already recorded as pasted, or "". */
export function alreadyRecordedText(unchanged: number): string {
  if (unchanged === 0) return "";
  return `${unchanged} of them ${
    unchanged === 1 ? "is" : "are"
  } already recorded exactly like that and will be left alone.`;
}

export function CsvPasteDialog<Row extends object>({
  table,
  rowSchema,
  onCommit,
  pasteOutcome,
  busy = false,
  onTextChange,
  uiBridgeId,
}: {
  table: TableDeclaration<Row>;
  /** The row shape the server validates, from the resource catalog. */
  rowSchema: JsonSchema | undefined;
  /** The rows read, handed to the caller; what it does with them is what
   *  `pasteOutcome` says. */
  onCommit: (rows: Row[]) => void;
  /**
   * What committing these rows does, from the caller's own write plan — the
   * button's text and the preview's "This line" column are read from it.
   * Required: every caller states it, none inherits a default.
   */
  pasteOutcome: (rows: Row[]) => PasteOutcome<Row>;
  /**
   * A save is in flight. Committing during one changes the working copy the
   * open request is NOT carrying.
   */
  busy?: boolean;
  /** Told whether pasted text is sitting in the box uncommitted — text that
   *  is in no working copy and on no device. */
  onTextChange?: (hasText: boolean) => void;
  uiBridgeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const hasText = text.trim() !== "";
  useEffect(() => {
    onTextChange?.(hasText);
  }, [hasText, onTextChange]);
  const [preview, setPreview] = useState<PastePreview<Row> | null>(null);
  const inputId = useId();

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const outcome = preview ? pasteOutcome(preview.rows) : null;
  const fates = outcome?.kind === "merge" ? outcome.fates : null;
  const label =
    preview && outcome
      ? commitLabel(table, preview.rows.length, outcome)
      : null;
  const unchanged = fates ? fateCounts(fates).unchanged : 0;
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
                {unchanged > 0 && ` ${alreadyRecordedText(unchanged)}`}
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
                    {fates && (
                      <th
                        scope="col"
                        className="px-2 py-1.5 font-medium text-muted-foreground"
                      >
                        This line
                      </th>
                    )}
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
                      {fates && (
                        <td
                          className="whitespace-nowrap px-2 py-1 text-muted-foreground"
                          data-ui-bridge-id={`${uiBridgeId}.preview.row.${index}.fate`}
                        >
                          {fates[index] ? fateText(fates[index]) : ""}
                        </td>
                      )}
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
            {preview && label && (
              <Button
                type="button"
                disabled={!label.enabled || busy}
                onClick={() => {
                  if (!label.enabled) return;
                  onCommit(preview.rows);
                  close();
                }}
                data-ui-bridge-id={`${uiBridgeId}.commit`}
              >
                {label.text}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
