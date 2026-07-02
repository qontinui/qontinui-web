"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { Condition, ConditionRun, ConditionRunResult } from "../types";

interface RunHistoryProps {
  groupId: string;
  /** Conditions of the group, used to label per-condition results by text. */
  conditions: Condition[];
  listRuns: (groupId: string) => Promise<ConditionRun[]>;
  getRun: (runId: string) => Promise<ConditionRun | null>;
  /** Bumping this value forces a reload (e.g. after a run-now dispatch). */
  refreshKey: number;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtDuration(
  start: string,
  end: string | null | undefined
): string | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

/**
 * Recent runs for the selected group. Each row shows status, trigger, and
 * timestamps; expanding a row reveals per-condition pass/fail + evidence and
 * the run summary (fetched lazily via `getRun` when the list row omits
 * `results`).
 */
export function RunHistory({
  groupId,
  conditions,
  listRuns,
  getRun,
  refreshKey,
}: RunHistoryProps) {
  const [runs, setRuns] = useState<ConditionRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listRuns(groupId);
    setRuns(data);
    setLoading(false);
  }, [groupId, listRuns]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const conditionText = (conditionId: string): string =>
    conditions.find((c) => c.condition_id === conditionId)?.text ?? conditionId;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Run history</h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : runs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          No runs yet. Use “Run now” to execute this group and record its first
          result.
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <RunRow
              key={run.run_id}
              run={run}
              getRun={getRun}
              conditionText={conditionText}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface RunRowProps {
  run: ConditionRun;
  getRun: (runId: string) => Promise<ConditionRun | null>;
  conditionText: (conditionId: string) => string;
}

function RunRow({ run, getRun, conditionText }: RunRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ConditionRun | null>(
    run.results != null ? run : null
  );
  const [loadingDetail, setLoadingDetail] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && detail === null && !loadingDetail) {
      setLoadingDetail(true);
      const full = await getRun(run.run_id);
      setDetail(full);
      setLoadingDetail(false);
    }
  };

  const results: ConditionRunResult[] = detail?.results ?? [];
  const summary = detail?.summary ?? run.summary ?? null;
  const duration = fmtDuration(run.started_at, run.finished_at);

  return (
    <li className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <StatusBadge status={run.status} />
        <span className="text-xs capitalize text-muted-foreground">
          {run.trigger}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtTime(run.started_at)}
          {duration ? ` · ${duration}` : ""}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {summary && (
            <p className="text-sm text-muted-foreground">{summary}</p>
          )}

          {loadingDetail ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          ) : results.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No per-condition results recorded for this run.
            </p>
          ) : (
            <ul className="space-y-2">
              {results.map((res, i) => {
                const pass = res.verdict === "pass";
                return (
                  <li
                    key={`${res.condition_id}-${i}`}
                    className="flex items-start gap-2"
                  >
                    {pass ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        {conditionText(res.condition_id)}
                      </p>
                      {res.evidence && (
                        <p className="text-xs text-muted-foreground">
                          {res.evidence}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Started: {fmtTime(run.started_at)}</span>
            <span>Finished: {fmtTime(run.finished_at)}</span>
            {run.device_id && <span>Device: {run.device_id}</span>}
          </div>
        </div>
      )}
    </li>
  );
}
