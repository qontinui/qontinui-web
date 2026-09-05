"use client";

import { AlertTriangle, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCaptureHealth } from "../_hooks/usePlanLibrary";
import {
  CAPTURE_DOOR_LABELS,
  type CaptureDoor,
  type CaptureDoorHealth,
} from "../types";

function doorLabel(door: CaptureDoorHealth): string {
  return (
    CAPTURE_DOOR_LABELS[door.captured_by as CaptureDoor] ?? door.captured_by
  );
}

function relativeDays(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

/**
 * Which door is actually feeding the corpus.
 *
 * The count alone cannot answer the question this panel exists for. The
 * deterministic scan is the backbone and will always have the biggest number;
 * what matters is whether the AGENT door — the only one that can capture
 * ad-hoc worktree prompts and the provenance edges — is being used, and
 * whether it was used *recently*. So every door renders its recency next to
 * its count, and a door with no rows renders an explicit zero rather than
 * vanishing from the list.
 *
 * The recency figure is "last TOUCHED", not "last write": the backend sources
 * it from `max(updated_at)`, which a kind correction bumps without any capture
 * having occurred. The label says what the column actually knows.
 */
export function CaptureHealthPanel() {
  const { data, loading, error } = useCaptureHealth();

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="capture-health"
    >
      <div className="flex items-start gap-3">
        <Activity className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Capture health</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Where the corpus is coming from. The scan is the backbone; the agent
            door is what captures prompts a scan cannot see and the provenance
            edges only the agent that ran the chain knows.
          </p>
        </div>
      </div>

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="capture-health-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Couldn&apos;t read capture health: {error}.{" "}
            {data
              ? "The counts below are the last ones read and may be stale."
              : "No counts could be read — which door is feeding the corpus is unknown, not zero."}
          </p>
        </div>
      )}

      {loading && !data ? (
        <Skeleton className="mt-4 h-20 w-full" />
      ) : data ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {data.doors.map((door) => {
            const recency = relativeDays(door.last_touched_at);
            return (
              <div
                key={door.captured_by}
                className="rounded-md border border-border bg-background px-3 py-2.5"
                data-testid={`capture-door-${door.captured_by}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium">
                    {doorLabel(door)}
                  </span>
                  <span
                    className="text-lg font-semibold tabular-nums"
                    data-testid={`capture-door-count-${door.captured_by}`}
                  >
                    {door.count}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {door.count === 0
                    ? "Never used."
                    : recency
                      ? `Last touched ${recency}.`
                      : "Last touched date unknown."}
                </p>
                {!door.known && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                    Unrecognised capture door — this console does not know what
                    writes it.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {data && data.total > 0 && (
        <p
          className="mt-3 text-[11px] text-muted-foreground"
          data-testid="capture-health-total"
        >
          {data.total} artifact{data.total === 1 ? "" : "s"} in the corpus.
          {/* Freshness beside the census: a corpus nothing has touched in
              weeks is the body-sync-off shape, and the counts alone cannot
              show it. */}{" "}
          {relativeDays(data.newest_updated_at)
            ? `Newest touched ${relativeDays(data.newest_updated_at)}.`
            : "Newest touched date unknown."}
        </p>
      )}
    </section>
  );
}
