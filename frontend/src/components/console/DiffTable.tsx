"use client";

/**
 * DiffTable — the console's rendering of a [`diffLines`] result.
 *
 * Extracted from `prompt-documents/_components/PromptDocumentHistoryDialog`
 * by plan `2026-08-27-tenant-level-agent-authorable-stores.md` Phase 4, when
 * the landed-write feed became a second consumer of the same shape. The markup
 * is carried over unchanged so the version-history dialog looks exactly as it
 * did; the only difference is that there is now one copy of it.
 *
 * Presentation only, per the `console/` contract: it fetches nothing, knows no
 * route, and its sole import is the `Line` type it renders.
 *
 * Both line numbers are shown because a reviewer's question is "where in the
 * OLD document and where in the NEW", and an added line has no old number to
 * give — a single-column gutter would have to invent one. The marker column
 * uses U+2212 MINUS, not a hyphen, so a removed line reads as a minus at the
 * same width as the `+`.
 */

import { cn } from "@/lib/utils";
import type { DiffLine } from "./diff";

export interface DiffTableProps {
  lines: ReadonlyArray<DiffLine>;
  className?: string;
  "data-testid"?: string;
}

export function DiffTable({
  lines,
  className,
  "data-testid": testId,
}: DiffTableProps) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-auto bg-background", className)}
      data-testid={testId}
    >
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {lines.map((line, idx) => (
            <tr
              key={idx}
              className={cn(
                line.type === "added" &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                line.type === "removed" &&
                  "bg-red-500/10 text-red-700 dark:text-red-300"
              )}
            >
              <td className="w-10 select-none border-r border-border px-1.5 text-right align-top text-muted-foreground">
                {line.oldNumber ?? ""}
              </td>
              <td className="w-10 select-none border-r border-border px-1.5 text-right align-top text-muted-foreground">
                {line.newNumber ?? ""}
              </td>
              <td className="w-5 select-none px-1 align-top text-muted-foreground">
                {line.type === "added"
                  ? "+"
                  : line.type === "removed"
                    ? "−"
                    : ""}
              </td>
              <td className="whitespace-pre-wrap break-words px-1 align-top">
                {/* An empty line still needs a box to occupy, or the row
                    collapses to zero height and the gutter numbers skip. */}
                {line.text === "" ? " " : line.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
