"use client";

/**
 * Paste a table, see what was read, then decide.
 *
 * The same three steps for every import on this page: paste, read, confirm.
 * Nothing is applied by typing — an explicit "Use this" is what changes the
 * working copy, and an explicit "Save" is what reaches the server. That is
 * the plan's "show the result for confirmation before anything is saved",
 * and it is deliberately the whole of the interaction model: the shared
 * overview authoring layer (plan `2026-09-20-overview-authoring-layer`) owns
 * anything richer.
 */

import { useState } from "react";
import type { CsvIssue } from "../../../_lib/csv";

export interface PasteOutcome<T> {
  rows: T[];
  issues: CsvIssue[];
}

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
            issue.severity === "error" ? "text-destructive" : "text-muted-foreground"
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

export function PasteBox<T>({
  id,
  label,
  help,
  placeholder,
  parse,
  describe,
  onApply,
}: {
  id: string;
  label: string;
  help: string;
  placeholder: string;
  parse: (text: string) => PasteOutcome<T>;
  /** One line saying what was read, e.g. "12 roles". */
  describe: (rows: T[]) => string;
  onApply: (rows: T[]) => void;
}) {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<PasteOutcome<T> | null>(null);

  const errors = outcome?.issues.filter((i) => i.severity === "error") ?? [];

  return (
    <div className="rounded-md border border-border p-4" data-ui-bridge-id={id}>
      <label
        htmlFor={`${id}-input`}
        className="block text-sm font-medium text-foreground"
      >
        {label}
      </label>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{help}</p>
      <textarea
        id={`${id}-input`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOutcome(null);
        }}
        rows={6}
        spellCheck={false}
        placeholder={placeholder}
        className="mt-3 w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id={`${id}.input`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOutcome(parse(text))}
          disabled={text.trim() === ""}
          className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id={`${id}.read`}
        >
          Read it
        </button>
        {outcome && (
          <button
            type="button"
            onClick={() => {
              onApply(outcome.rows);
              setText("");
              setOutcome(null);
            }}
            disabled={outcome.rows.length === 0}
            className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-ui-bridge-id={`${id}.apply`}
          >
            Use this
          </button>
        )}
        {outcome && (
          <p
            className="text-sm text-muted-foreground"
            role="status"
            data-ui-bridge-id={`${id}.summary`}
          >
            {outcome.rows.length === 0
              ? "Nothing could be read from that."
              : `Read ${describe(outcome.rows)}.`}
            {errors.length > 0 &&
              ` ${errors.length} row${errors.length === 1 ? "" : "s"} could not be read and ${errors.length === 1 ? "is" : "are"} listed below.`}
          </p>
        )}
      </div>
      {outcome && <IssueList issues={outcome.issues} uiBridgeId={`${id}.issues`} />}
    </div>
  );
}
