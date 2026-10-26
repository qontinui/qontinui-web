"use client";

/**
 * /admin/coord/session-load — how long each work type holds a session slot,
 * how many sessions each machine carries against its configured session
 * budget, and how demanded slot-hours grow against what the fleet has.
 *
 * Plan `2026-10-23-session-duration-by-work-type-and-per-device-session-load`
 * Phase 5 (D4 defines the durations, D5 the concurrency and the budget
 * states). Reads coord's run record (`GET /coord/session-runs`, `/stats`,
 * `/concurrency`, `/growth`, the plan's Phase 3) through the web backend's
 * passthrough proxies (`useSessionLoad`, `useSessionRunList`).
 *
 * ## What this page will not say
 *
 * - **"No sessions" when the run record is not deployed.** coord answers
 *   `503 schema_missing` while `coord.session_runs` is absent; every section
 *   then says the record is not deployed and reads UNKNOWN.
 * - **0 for a number coord could not state** — a percentile over no observed
 *   end, a held share nobody's finish declared, a silent machine's open runs,
 *   a budget nobody published: `unknown`, every time.
 * - **"Capacity".** The per-machine ceiling is the configured session budget,
 *   by name, in its three states.
 * - **A forecast.** The crossing date is a linear extrapolation of seven
 *   complete days, labelled as one, and withheld when history is too short.
 *
 * Console style (`frontend/docs/console-ui-style-guide.md`, §3.9 for this
 * page): no page title (R9), strip first (R1), one line per work type /
 * machine / run (R2) whose detail expands in place (R5), filter tabs with
 * live counts (R6), and the growth chart collapsible (R7).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Gauge, ListTree, Server, Timer, TrendingUp } from "lucide-react";
import {
  FilterTabs,
  HealthStrip,
  RecordList,
  RefreshButton,
  absoluteTime,
} from "@/components/console";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GrowthChart } from "./_components/GrowthChart";
import { MachineRow, RunRow, WorkTypeRow } from "./_components/rows";
import { seriesColorMap } from "./_components/charts";
import {
  RUN_FILTERS,
  SESSION_LOAD_WINDOWS,
  backfilledOnlyBuckets,
  completeGrowthDays,
  deriveSessionLoadHealth,
  fleetAvailable,
  fleetAvailableText,
  growthTrend,
  machineLines,
  matchesRunFilter,
  runFilterCounts,
  sessionLoadIssueText,
  sessionLoadWindowSpec,
  trendText,
  workTypeLabel,
  workTypeLines,
  workTypeSpark,
  type RunFilter,
  type SessionLoadIssue,
  type SessionLoadWindow,
} from "./_lib/sessionLoadStatus";
import {
  SESSION_LOAD_POLL_MS,
  useSessionLoad,
  useSessionRunList,
} from "./_lib/useSessionLoad";

const SPAWNS_HREF = "/admin/coord/spawns";
const ALL = "__all__";

function AsOf({
  at,
  testId,
}: {
  at: string | null | undefined;
  testId: string;
}) {
  return (
    <span className="text-[11px] text-muted-foreground" data-testid={testId}>
      {at ? `as of ${absoluteTime(at)}` : "not read yet"}
    </span>
  );
}

function IssueLine({
  issue,
  subject,
  stale,
  testId,
}: {
  issue: SessionLoadIssue;
  subject: string;
  stale: boolean;
  testId: string;
}) {
  return (
    <p
      className="text-sm text-amber-200 m-0"
      role="status"
      data-testid={testId}
      data-issue={issue.kind}
    >
      {stale
        ? "Last refresh failed — the figures below are from the last good read. "
        : ""}
      {sessionLoadIssueText(issue, subject)}
    </p>
  );
}

export default function CoordSessionLoadPage() {
  const [windowId, setWindowId] = useState<SessionLoadWindow>("7d");
  const [workTypeFilter, setWorkTypeFilter] = useState<string | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [expandedMachine, setExpandedMachine] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const spec = sessionLoadWindowSpec(windowId);
  const load = useSessionLoad(windowId);
  const runList = useSessionRunList({
    windowId,
    workType: workTypeFilter,
    device: deviceFilter,
  });

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const stats = load.byType.data;
  const lines = useMemo(() => (stats ? workTypeLines(stats) : null), [stats]);
  const growth = load.growth.data;
  const days = useMemo(
    () => (growth ? completeGrowthDays(growth) : null),
    [growth]
  );
  const available = useMemo(
    () => (growth ? fleetAvailable(growth) : null),
    [growth]
  );
  const trend = useMemo(
    () => (growth && available ? growthTrend(growth, available) : null),
    [growth, available]
  );
  const machines = useMemo(
    () =>
      load.concurrency.data
        ? machineLines(load.concurrency.data, load.byDeviceType.data)
        : null,
    [load.concurrency.data, load.byDeviceType.data]
  );

  // One colour per work type across the page, ranked by slot-hours: the
  // window's stats when they answered, else the growth series' totals.
  const ranked = useMemo(() => {
    if (lines) return lines.map((l) => l.workType);
    const totals = new Map<string, number>();
    for (const d of days ?? []) {
      for (const [wt, v] of Object.entries(d.byType))
        totals.set(wt, (totals.get(wt) ?? 0) + v);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([wt]) => wt);
  }, [lines, days]);
  const colorOf = useMemo(() => seriesColorMap(ranked), [ranked]);

  const health = useMemo(
    () =>
      deriveSessionLoadHealth({
        stats,
        statsIssue: load.byType.issue,
        machines,
        concurrencyIssue: load.concurrency.issue,
        trend,
        windowLabel: spec.label,
      }),
    [
      stats,
      load.byType.issue,
      machines,
      load.concurrency.issue,
      trend,
      spec.label,
    ]
  );

  const deviceNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const line of machines ?? []) m.set(line.deviceId, line.name);
    return m;
  }, [machines]);

  const runRead = runList.read;
  const runs = runRead.kind === "ok" ? runRead.runs : null;
  const runCounts = useMemo(() => runFilterCounts(runs), [runs]);
  const visibleRuns = useMemo(
    () => (runs ?? []).filter((r) => matchesRunFilter(r, runFilter)),
    [runs, runFilter]
  );

  const showRuns = (filter: {
    workType?: string | null;
    device?: string | null;
  }) => {
    if (filter.workType !== undefined) setWorkTypeFilter(filter.workType);
    if (filter.device !== undefined) setDeviceFilter(filter.device);
    setRunFilter("all");
    setExpandedRun(null);
    if (typeof document !== "undefined") {
      document
        .querySelector('[data-testid="coord-session-load-runs-section"]')
        ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  };

  const workTypeOptions = useMemo(() => {
    const set = new Set<string>(ranked);
    if (workTypeFilter) set.add(workTypeFilter);
    return [...set];
  }, [ranked, workTypeFilter]);

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-session-load-page"
      data-ui-bridge-id="coord-session-load-page"
    >
      <HealthStrip
        data-testid="coord-session-load-health"
        level={health.level}
        headline={health.headline}
        detail={health.detail ?? undefined}
        badges={health.badges}
      />

      <div className="flex flex-wrap items-center gap-2">
        <RefreshButton
          onRefresh={async () => {
            runList.reload();
            await load.refresh();
          }}
          label="Refresh session load"
          title={`Re-reads session load from coord now; the page also refreshes itself every ${SESSION_LOAD_POLL_MS / 1000} s`}
          data-testid="coord-session-load-refresh"
        />
        <Select
          value={windowId}
          onValueChange={(v) => {
            setWindowId(v as SessionLoadWindow);
            setExpandedType(null);
            setExpandedMachine(null);
            setExpandedRun(null);
          }}
        >
          <SelectTrigger
            className="h-8 w-[160px] text-xs"
            aria-label="Window"
            data-testid="coord-session-load-window"
            title="The window the work-type, machine and run figures cover: runs started in it. The growth section always covers 90 days."
          >
            <SelectValue placeholder="window" />
          </SelectTrigger>
          <SelectContent>
            {SESSION_LOAD_WINDOWS.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground m-0">
          Slot-hours are hours a session slot was held, open and inferred runs
          included.
        </p>
        <Link
          href={SPAWNS_HREF}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
          data-testid="coord-session-load-spawns-link"
        >
          <Timer className="h-3 w-3" aria-hidden /> Spawns
        </Link>
      </div>

      {/* ---------------------------------------------------------------- */}
      <section
        className="space-y-2"
        data-testid="coord-session-load-types-section"
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-medium flex items-center gap-1.5 m-0">
            <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
            By work type — runs started in {spec.label}
          </h2>
          <AsOf at={stats?.as_of} testId="coord-session-load-types-as-of" />
        </div>
        <p className="text-xs text-muted-foreground m-0">
          Each line: runs, slot-hours, median and p90 wall time over observed
          ends (inferred ends and open runs are counted beside them, not in
          them), and slot-hours per day over the last 90 days.
        </p>
        {load.byType.issue && (
          <IssueLine
            issue={load.byType.issue}
            subject="how long each work type holds a slot"
            stale={stats !== null}
            testId="coord-session-load-types-issue"
          />
        )}
        <RecordList
          items={lines ?? []}
          itemKey={(l) => l.workType}
          loaded={lines !== null || load.byType.issue !== null}
          expandedKey={expandedType}
          onExpandedKeyChange={setExpandedType}
          empty={
            lines === null ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-session-load-types-unknown"
              >
                No work-type figures from coord — unknown, not none.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-session-load-types-empty"
              >
                Coord recorded no session run started in {spec.label}.
              </p>
            )
          }
          renderRow={(line, ctx) => (
            <WorkTypeRow
              line={line}
              spark={days ? workTypeSpark(days, line.workType) : null}
              windowLabel={spec.label}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              onShowRuns={() =>
                showRuns({ workType: line.workType, device: null })
              }
            />
          )}
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section
        className="space-y-2"
        data-testid="coord-session-load-machines-section"
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-medium flex items-center gap-1.5 m-0">
            <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
            By machine — open runs against the configured session budget
          </h2>
          <AsOf
            at={load.concurrency.data?.as_of}
            testId="coord-session-load-machines-as-of"
          />
        </div>
        <p className="text-xs text-muted-foreground m-0">
          Each machine that ran a session in {spec.label}: open runs now against
          its configured session budget (published, zero published, or none
          published), and peak and p95 open runs over the window, from{" "}
          {spec.bucketLabel} buckets. A machine with no heartbeat for 15 min
          reads UNKNOWN: coord may not have heard its sessions end.
          {load.concurrency.data?.truncated
            ? " Coord capped the read at its interval limit, so these counts are lower bounds."
            : ""}
        </p>
        {load.concurrency.issue && (
          <IssueLine
            issue={load.concurrency.issue}
            subject="how many sessions each machine carries"
            stale={machines !== null}
            testId="coord-session-load-machines-issue"
          />
        )}
        <RecordList
          items={machines ?? []}
          itemKey={(m) => m.deviceId}
          loaded={machines !== null || load.concurrency.issue !== null}
          expandedKey={expandedMachine}
          onExpandedKeyChange={setExpandedMachine}
          empty={
            machines === null ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-session-load-machines-unknown"
              >
                No per-machine figures from coord — unknown, not idle.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-session-load-machines-empty"
              >
                No machine recorded a session run in {spec.label}.
              </p>
            )
          }
          renderRow={(line, ctx) => (
            <MachineRow
              line={line}
              windowLabel={spec.label}
              bucketLabel={spec.bucketLabel}
              colorOf={colorOf}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
              onShowRuns={() =>
                showRuns({ device: line.deviceId, workType: null })
              }
            />
          )}
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section
        className="space-y-2"
        data-testid="coord-session-load-growth-section"
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-medium flex items-center gap-1.5 m-0">
            <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
            Growth — slot-hours per day demanded against available, last 90 days
          </h2>
          <AsOf at={growth?.as_of} testId="coord-session-load-growth-as-of" />
        </div>
        {load.growth.issue && (
          <IssueLine
            issue={load.growth.issue}
            subject="how session demand is growing"
            stale={growth !== null}
            testId="coord-session-load-growth-issue"
          />
        )}
        {growth && available && trend ? (
          <div className="space-y-1">
            <p
              className="text-sm m-0"
              data-testid="coord-session-load-trend"
              data-trend={trend.kind}
            >
              {trendText(trend)}
            </p>
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="coord-session-load-available"
            >
              {fleetAvailableText(available)}
            </p>
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="coord-session-load-coverage"
            >
              {growth.recording_since
                ? `Runners have recorded session runs since ${absoluteTime(growth.recording_since)} (${growth.devices_recording?.length ?? "an unknown number of"} machine${growth.devices_recording?.length === 1 ? "" : "s"} recording).`
                : "No runner has recorded a session run yet — demand before recording began is unknown, not zero."}
              {growth.truncated
                ? " Coord capped the read at its interval limit, so recent days are lower bounds."
                : ""}
            </p>
          </div>
        ) : (
          !load.growth.issue && (
            <p
              className="text-sm text-muted-foreground italic m-0"
              data-testid="coord-session-load-growth-unknown"
            >
              Reading the growth series from coord…
            </p>
          )
        )}
        <GrowthChart
          days={days}
          rankedWorkTypes={ranked}
          colorOf={colorOf}
          available={available}
          backfilledDays={growth ? backfilledOnlyBuckets(growth) : 0}
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section
        className="space-y-2"
        data-testid="coord-session-load-runs-section"
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-medium flex items-center gap-1.5 m-0">
            <ListTree className="h-4 w-4 text-muted-foreground" aria-hidden />
            Runs started in {spec.label}
          </h2>
          <AsOf
            at={runRead.kind === "ok" ? runRead.asOf : null}
            testId="coord-session-load-runs-as-of"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={workTypeFilter ?? ALL}
            onValueChange={(v) => {
              setWorkTypeFilter(v === ALL ? null : v);
              setExpandedRun(null);
            }}
          >
            <SelectTrigger
              className="h-8 w-[220px] text-xs"
              aria-label="Work type"
              data-testid="coord-session-load-runs-type"
            >
              <SelectValue placeholder="work type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>every work type</SelectItem>
              {workTypeOptions.map((wt) => (
                <SelectItem key={wt} value={wt}>
                  {workTypeLabel(wt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={deviceFilter ?? ALL}
            onValueChange={(v) => {
              setDeviceFilter(v === ALL ? null : v);
              setExpandedRun(null);
            }}
          >
            <SelectTrigger
              className="h-8 w-[200px] text-xs"
              aria-label="Machine"
              data-testid="coord-session-load-runs-device"
            >
              <SelectValue placeholder="machine" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>every machine</SelectItem>
              {(machines ?? []).map((m) => (
                <SelectItem key={m.deviceId} value={m.deviceId}>
                  {m.name}
                </SelectItem>
              ))}
              {deviceFilter && !deviceNames.has(deviceFilter) && (
                <SelectItem value={deviceFilter}>
                  {deviceFilter.slice(0, 8)}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <FilterTabs
          tabs={RUN_FILTERS.map((f) => ({
            id: f.id,
            label: <span title={f.title}>{f.label}</span>,
            count: runCounts[f.id],
          }))}
          active={runFilter}
          onChange={(id) => {
            setRunFilter(id);
            setExpandedRun(null);
          }}
          testIdPrefix="coord-session-load-runs-filter"
        />
        {runRead.kind === "issue" && (
          <IssueLine
            issue={runRead.issue}
            subject="which runs were started"
            stale={false}
            testId="coord-session-load-runs-issue"
          />
        )}
        {runRead.kind === "ok" && (
          <p
            className="text-xs text-muted-foreground m-0"
            data-testid="coord-session-load-runs-coverage"
          >
            {runRead.truncated
              ? `Showing the ${runRead.runs.length} most recent of ${runRead.total ?? "an unknown number of"} runs; tab counts cover these rows only.`
              : `Every matching run (${runRead.runs.length}).`}
            {runRead.unreadable > 0
              ? ` ${runRead.unreadable} row${runRead.unreadable === 1 ? "" : "s"} coord sent could not be read and ${runRead.unreadable === 1 ? "is" : "are"} not listed.`
              : ""}
          </p>
        )}
        <RecordList
          items={visibleRuns}
          itemKey={(r) => r.id}
          loaded={runRead.kind !== "loading"}
          expandedKey={expandedRun}
          onExpandedKeyChange={setExpandedRun}
          empty={
            runRead.kind !== "ok" ? (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-session-load-runs-unknown"
              >
                No run list from coord — which runs were started is unknown, not
                none.
              </p>
            ) : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-session-load-runs-empty"
              >
                No{" "}
                {runFilter === "all"
                  ? ""
                  : `${RUN_FILTERS.find((f) => f.id === runFilter)?.label.toLowerCase()} `}
                run matches in{" "}
                {runRead.truncated ? "the rows loaded" : spec.label}.
              </p>
            )
          }
          renderRow={(run, ctx) => (
            <RunRow
              run={run}
              deviceName={
                deviceNames.get(run.device_id) ??
                `device ${run.device_id.slice(0, 8)}`
              }
              nowMs={nowMs}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
        />
        {runRead.kind === "ok" && runRead.nextCursor !== null && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runList.loadMore}
              aria-busy={runRead.loadingMore}
              className="text-xs font-medium underline underline-offset-2 hover:no-underline"
              data-testid="coord-session-load-runs-more"
            >
              {runRead.loadingMore ? "Loading older runs…" : "Load older runs"}
            </button>
            {runRead.moreIssue && (
              <span
                className="text-xs text-amber-200"
                data-testid="coord-session-load-runs-more-issue"
              >
                {sessionLoadIssueText(runRead.moreIssue, "the older runs")}
              </span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
