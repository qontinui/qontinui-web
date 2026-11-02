"use client";

import { useUIElement } from "@qontinui/ui-bridge/react";
import { NAVIGATION_ONLY_PROPS } from "@/components/presentation";
import { cn } from "@/lib/utils";
import {
  UNSERVED_AGE,
  WORST_BUCKET,
  datesWorstBucket,
  formatAgeWhenRead,
  formatRatio,
  presentStatus,
  readingAge,
  upperFirst,
} from "../_lib/status-presentation";
import type { ResolvedSubspace } from "../_lib/types";
import { UnknownBadge } from "./FidelityFigures";

interface SubspaceCellProps {
  row: ResolvedSubspace;
  onSelect: (row: ResolvedSubspace) => void;
  /**
   * UI Bridge id. Defaults to `digital-twin-cell-<id>` (the matrix, where each
   * row renders once). A view that renders the same row more than once — the
   * lifecycle view shows a row under every stage it observes — passes a
   * scoped id, because a UI Bridge id must be unique among mounted elements.
   */
  uiId?: string;
  /**
   * UI Bridge label. Defaults to `Digital Twin sub-space cell: <id>`. A view
   * that passes a scoped `uiId` passes a matching qualified label too, so
   * label-based targeting is as unambiguous as the id.
   */
  uiLabel?: string;
}

/**
 * One sub-space tile. Shows the symbol, name, twin and status; for live-probed
 * observers it also surfaces the credibility envelope (coverage /
 * credibility / staleness) — the goal-#3/#4 usefulness+accuracy signal —
 * verbatim from coord. The staleness is the reading's age when it was read
 * ("45s stale when read"), never an age now: the cell shows the probe's answer
 * some time after it was read. The envelope door's age is its worst bucket's
 * — the bucket its drift class comes from — and says so ("worst bucket 12s
 * stale when read"); with no age served it is "age UNKNOWN", never "live"
 * (`readingAge`). A press only opens
 * the read-only detail drawer, so the tile is navigation-only and stays live
 * in presentation mode.
 */
export function SubspaceCell({
  row,
  onSelect,
  uiId,
  uiLabel,
}: SubspaceCellProps) {
  const style = presentStatus(row);
  const metrics = row.liveProbed ? row.metrics : undefined;
  const age = metrics
    ? readingAge(metrics.staleness_seconds, row.doorShape)
    : null;
  const id = uiId ?? `digital-twin-cell-${row.id}`;

  // Register with the UI Bridge so the cell is discoverable + clickable by a
  // stable id (e.g. `digital-twin-cell-schema`) for automation + spec-checks.
  const { ref } = useUIElement({
    id,
    label: uiLabel ?? `Digital Twin sub-space cell: ${row.id}`,
    type: "button",
  });

  return (
    <button
      ref={ref}
      type="button"
      {...NAVIGATION_ONLY_PROPS}
      data-testid={id}
      onClick={() => onSelect(row)}
      title={style.meaning}
      className={cn(
        "group flex flex-col items-start gap-1.5 rounded-md border border-l-4 bg-card p-3 text-left transition-colors hover:bg-accent/50",
        style.border
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {row.symbol}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn("size-2 rounded-full", style.dot)} />
          <span className="text-[11px] font-medium text-muted-foreground">
            {style.label}
          </span>
        </span>
      </div>

      <div className="flex flex-col">
        <span className="text-sm font-semibold capitalize">
          {row.id.replace(/_/g, " ")}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {row.twin} twin
        </span>
      </div>

      <span className="line-clamp-2 text-xs text-muted-foreground">
        {row.description}
      </span>

      {metrics && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span title="coverage">cov {formatRatio(metrics.coverage)}</span>
          <span title="credibility">
            cred {formatRatio(metrics.credibility)}
          </span>
          {age === null ? (
            <span
              title="staleness when read"
              data-testid={`${id}-age`}
              className="flex items-center gap-1"
            >
              age <UnknownBadge title={`${upperFirst(UNSERVED_AGE)}.`} />
            </span>
          ) : datesWorstBucket(age, row.doorShape) ? (
            <span
              title="staleness when read of the worst bucket, the one its drift class comes from"
              data-testid={`${id}-age`}
            >
              {WORST_BUCKET} {formatAgeWhenRead(age)}
            </span>
          ) : (
            <span title="staleness when read" data-testid={`${id}-age`}>
              {formatAgeWhenRead(age)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
