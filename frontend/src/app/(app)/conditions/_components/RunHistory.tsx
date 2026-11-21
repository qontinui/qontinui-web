"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type {
  Condition,
  ConditionRun,
  ConditionRunCoverage,
  ConditionRunResult,
} from "../types";

interface RunHistoryProps {
  groupId: string;
  /** Conditions of the group, used to label per-condition results by text. */
  conditions: Condition[];
  /** Resolves `null` when the read failed — rendered as a failure, not as no runs. */
  listRuns: (groupId: string) => Promise<ConditionRun[] | null>;
  /** Resolves `null` when the read failed — rendered as a failure, not as no results. */
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

/** "4 of 5 conditions reported · 1 unknown". */
function coverageLine(coverage: ConditionRunCoverage): string {
  const noun = coverage.expected === 1 ? "condition" : "conditions";
  const reported = `${coverage.reported} of ${coverage.expected} ${noun} reported`;
  return coverage.unknown > 0
    ? `${reported} · ${coverage.unknown} unknown`
    : reported;
}

/**
 * The mark beside a verdict. Only `pass` and `fail` get the check and the
 * cross: an `unknown`, or any word this page does not know, gets a neutral
 * mark, so it never reads as a fail.
 */
function VerdictMark({ verdict }: { verdict: string }) {
  if (verdict === "pass") {
    return (
      <>
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        <span className="sr-only">Pass</span>
      </>
    );
  }
  if (verdict === "fail") {
    return (
      <>
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span className="sr-only">Fail</span>
      </>
    );
  }
  return (
    <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  );
}

/** How a non-pass, non-fail verdict is named in text; `null` for those two. */
function verdictLabel(verdict: string): string | null {
  if (verdict === "pass" || verdict === "fail") return null;
  return verdict === "unknown" ? "Unknown" : verdict;
}

/** A verdict's evidence: a plain string, or what was observed plus a note. */
function Evidence({ evidence }: { evidence: ConditionRunResult["evidence"] }) {
  if (!evidence) return null;
  if (typeof evidence === "string") {
    return <p className="text-xs text-muted-foreground">{evidence}</p>;
  }
  // Read defensively: the proxy passes coord's JSON through unchecked.
  const observed =
    typeof evidence.observed === "string" ? evidence.observed : "";
  const note = typeof evidence.note === "string" ? evidence.note : "";
  if (!observed && !note) return null;
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      {observed && <p>Observed: {observed}</p>}
      {note && <p>Note: {note}</p>}
    </div>
  );
}

interface VerdictRowProps {
  /** The condition's text; `null` when the report did not name it. */
  condition: string | null;
  verdict: string;
  /** Text naming a non-pass, non-fail verdict. */
  label: string | null;
  evidence?: ConditionRunResult["evidence"];
}

function VerdictRow({ condition, verdict, label, evidence }: VerdictRowProps) {
  return (
    <li className="flex items-start gap-2">
      <VerdictMark verdict={verdict} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {condition ?? (
            <span className="text-muted-foreground">
              Condition not named in the report
            </span>
          )}
          {label && (
            <span className="ml-2 text-xs text-muted-foreground">{label}</span>
          )}
        </p>
        <Evidence evidence={evidence} />
      </div>
    </li>
  );
}

/**
 * Recent runs for the selected group. Each row shows status (with the reason
 * a run reads unknown), trigger, and timestamps; expanding a row reveals how
 * many conditions got a verdict, each verdict with its evidence (any condition
 * that got none is listed too), and the run summary — fetched lazily via
 * `getRun` when the list row omits `results`.
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
  const [loadFailed, setLoadFailed] = useState(false);
  // Only the newest read may settle the list: a slow failed read must not
  // overwrite a later one that succeeded (refreshKey bumps are not debounced).
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestLoad.current;
    setLoading(true);
    const data = await listRuns(groupId);
    if (request !== latestLoad.current) return;
    // A failed read is not an empty history: say it failed, keep no stale rows.
    setLoadFailed(data === null);
    setRuns(data ?? []);
    setLoading(false);
  }, [groupId, listRuns]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const conditionText = (conditionId: string | null): string | null =>
    typeof conditionId === "string"
      ? (conditions.find((c) => c.condition_id === conditionId)?.text ??
        conditionId)
      : null;

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
      ) : loadFailed ? (
        <p
          role="alert"
          className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground"
        >
          Couldn’t load the run history, so whether this group has runs is
          unknown. Use “Refresh” to try again.
        </p>
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
  conditionText: (conditionId: string | null) => string | null;
}

function RunRow({ run, getRun, conditionText }: RunRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ConditionRun | null>(
    run.results != null ? run : null
  );
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  const fetchDetail = async () => {
    setLoadingDetail(true);
    const full = await getRun(run.run_id);
    // `null` is a failed read, so its results are unknown — not absent.
    setDetail(full);
    setDetailFailed(full === null);
    setLoadingDetail(false);
  };

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && detail === null && !loadingDetail) await fetchDetail();
  };

  // The row shows ONE snapshot: the fetched run once there is one, else the
  // list row. Only the fetch itself is keyed by the list row's id.
  const shown = detail ?? run;
  const results: ConditionRunResult[] = detail?.results ?? [];
  const summary = detail?.summary ?? run.summary ?? null;
  const duration = fmtDuration(shown.started_at, shown.finished_at);
  const coverage = shown.coverage ?? null;
  // Conditions that got no verdict: read defensively (the proxy passes coord's
  // JSON through unchecked), each id once so row keys stay unique, and none
  // that coord also served as a result.
  const reportedMissing = coverage?.missing;
  const missing = (
    Array.isArray(reportedMissing) ? [...new Set(reportedMissing)] : []
  ).filter((id) => !results.some((res) => res.condition_id === id));
  // The agent's own word is shown only where coord's verdict disagrees with it.
  const claimed =
    shown.claimed_status && shown.claimed_status !== shown.status
      ? shown.claimed_status
      : null;

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
        <StatusBadge
          status={shown.status}
          reason={shown.unknown_reason}
          detail={shown.unknown_detail}
        />
        <span className="text-xs capitalize text-muted-foreground">
          {shown.trigger}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtTime(shown.started_at)}
          {duration ? ` · ${duration}` : ""}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {coverage && (
            <p className="text-xs text-muted-foreground">
              {coverageLine(coverage)}
            </p>
          )}

          {summary && (
            <p className="text-sm text-muted-foreground">{summary}</p>
          )}

          {loadingDetail ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-3/4" />
            </div>
          ) : detailFailed ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span role="alert">
                Couldn’t load this run’s per-condition results, so they are
                unknown.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void fetchDetail()}
              >
                <RefreshCw className="size-3" />
                Retry
              </Button>
            </div>
          ) : results.length === 0 && missing.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No per-condition results recorded for this run.
            </p>
          ) : (
            <ul className="space-y-2">
              {results.map((res, i) => (
                <VerdictRow
                  key={`${res.condition_id}-${i}`}
                  condition={conditionText(res.condition_id)}
                  verdict={res.verdict}
                  label={verdictLabel(res.verdict)}
                  evidence={res.evidence}
                />
              ))}
              {missing.map((id) => (
                <VerdictRow
                  key={`missing-${id}`}
                  condition={conditionText(id)}
                  verdict="unknown"
                  label="No verdict reported"
                />
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Started: {fmtTime(shown.started_at)}</span>
            <span>Finished: {fmtTime(shown.finished_at)}</span>
            {shown.device_id && <span>Device: {shown.device_id}</span>}
            {claimed && <span>Agent claimed: {claimed}</span>}
          </div>
        </div>
      )}
    </li>
  );
}
