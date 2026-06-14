"use client";

import { cn } from "@/lib/utils";
import {
  STATUS_STYLES,
  formatRatio,
  formatStaleness,
} from "../_lib/status-presentation";
import type { ResolvedSubspace } from "../_lib/types";

interface SubspaceCellProps {
  row: ResolvedSubspace;
  onSelect: (row: ResolvedSubspace) => void;
}

/**
 * One sub-space tile in the completeness matrix. Shows the symbol, name, and
 * status; for live snapshot observers it also surfaces the credibility envelope
 * (coverage / credibility / staleness) — the goal-#3/#4 usefulness+accuracy
 * signal — verbatim from coord.
 */
export function SubspaceCell({ row, onSelect }: SubspaceCellProps) {
  const style = STATUS_STYLES[row.cellStatus];
  const metrics = row.query_kind === "snapshot" ? row.metrics : undefined;

  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      title={style.meaning}
      className={cn(
        "group flex flex-col items-start gap-1.5 rounded-md border border-l-4 bg-card p-3 text-left transition-colors hover:bg-accent/50",
        style.border,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {row.symbol}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", style.dot)} />
          <span className="text-[11px] font-medium text-muted-foreground">
            {style.label}
          </span>
        </span>
      </div>

      <span className="text-sm font-semibold capitalize">
        {row.id.replace(/_/g, " ")}
      </span>

      <span className="line-clamp-2 text-xs text-muted-foreground">
        {row.description}
      </span>

      {metrics && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span title="coverage">cov {formatRatio(metrics.coverage)}</span>
          <span title="credibility">cred {formatRatio(metrics.credibility)}</span>
          <span title="staleness">{formatStaleness(metrics.staleness_seconds)}</span>
        </div>
      )}
    </button>
  );
}
