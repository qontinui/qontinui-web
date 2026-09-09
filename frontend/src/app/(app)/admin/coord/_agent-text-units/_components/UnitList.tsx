"use client";

/**
 * The unit inventory — one record per line.
 *
 * Rule references — `frontend/docs/console-ui-style-guide.md`:
 * **R2** (one record = one line: identity → label → status → reason → time →
 * chevron, truncation with a `title`, never wrapping), **R4** (a left-edge
 * accent carries attention; the row body stays neutral) and **R8** (every
 * derived value comes from `_lib/unitRows.ts`, nothing is decided in this
 * JSX).
 *
 * **R5 is met by a workspace, not by an in-place panel.** The guide's carve-out
 * — "detail routes survive only where the detail is a *workspace*: its own
 * actions, sub-navigation or version history" — is exactly this case: opening a
 * unit gives a Monaco editor, a file tab strip, a layer switch and an
 * append-only version chain. Expanding that under a 34px row would be worse,
 * so the page swaps the list for the editor and the editor carries an explicit
 * way back.
 */

import { ChevronRight, Files } from "lucide-react";
import { CopySourceBadge, ProvenanceBadge } from "./ProvenanceBadge";
import { rowAccentClass, statusOf } from "../_lib/unitRows";
import type { UnitKindConfig, UnitRow } from "../types";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

interface UnitListProps {
  config: UnitKindConfig;
  rows: UnitRow[];
  onSelect: (name: string) => void;
  /** Message for an empty list — the caller knows whether it is empty because
   *  nothing is stored or because a filter excluded everything. */
  emptyMessage: string;
}

export function UnitList({
  config,
  rows,
  onSelect,
  emptyMessage,
}: UnitListProps) {
  if (rows.length === 0) {
    return (
      <p
        className="rounded-md border border-border bg-card/30 px-3 py-6 text-center text-sm text-muted-foreground"
        data-testid="unit-list-empty"
      >
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-1" data-testid="unit-list">
      {rows.map((row) => {
        const status = statusOf(row);
        const fileCount = Object.keys(row.resolved?.files ?? {}).length;
        const identity = config.invokePrefix
          ? `${config.invokePrefix}${row.name}`
          : `${row.name}/`;
        return (
          <button
            key={row.name}
            type="button"
            onClick={() => onSelect(row.name)}
            title={status.reason}
            data-testid={`unit-row-${row.name}`}
            className={`flex w-full items-center gap-3 rounded-md border border-border bg-card/30 px-3 py-2 text-left transition-colors hover:bg-accent/60 ${rowAccentClass(status)}`}
          >
            <span className="shrink-0 font-mono text-xs text-foreground/90">
              {identity}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {row.resolved
                ? Object.keys(row.resolved.files).sort().join(" · ")
                : "no stored text at either layer"}
            </span>
            <ProvenanceBadge status={status} className="shrink-0" />
            {!row.isInvocable && <CopySourceBadge />}
            {row.resolved && (
              <>
                <span
                  className="hidden shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground sm:inline-flex"
                  title={`${fileCount} file${fileCount === 1 ? "" : "s"} in this unit`}
                >
                  <Files className="size-3" aria-hidden />
                  {fileCount}
                </span>
                <span
                  className="hidden shrink-0 font-mono text-[11px] text-muted-foreground md:inline"
                  title={`Head version ${row.resolved.current_version}`}
                >
                  v{row.resolved.current_version}
                </span>
                <span
                  className="hidden shrink-0 text-xs text-muted-foreground lg:inline"
                  title={`Last written ${new Date(row.resolved.updated_at).toLocaleString()}`}
                >
                  {formatDate(row.resolved.updated_at)}
                </span>
              </>
            )}
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}
