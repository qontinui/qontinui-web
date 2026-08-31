"use client";

/**
 * /admin/coord/federation -- memory federation dashboard.
 *
 * Plan `2026-05-22-memories-on-coord-cross-machine.md` Phase 2.
 *
 * Reads `GET /api/v1/operations/federation/reports` (proxies to coord's
 * `/coord/federation/reports`). Shows aggregate push/pull/fail counts
 * and a sortable, expandable table of per-session federation reports.
 *
 * Auto-refreshes every 30s.
 *
 * ## Console style (Phase 3 Wave 4) — D2, on a NATIVE `<table>`
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` files this
 * route as Family C and keeps the table: eight columns of per-session counts
 * are a legitimate dense form and the column comparison is the job the page
 * exists for. What it gains:
 *
 * - **R1** — the four `<Card>` stat tiles (~96px of chrome to carry four
 *   integers) become one `<StatCluster>` line of mono badges.
 * - **R5** — the expanding row already existed here; what it lacked was the
 *   shared host. Its ad-hoc `RowDetail` becomes the same `<RecordDetail>` the
 *   row lists use, with the fixed slot order. This is the route that proves
 *   the `colSpan` host works under a **native `<table>`** as well as under
 *   `/gate-clearance`'s shadcn `<Table>` — `<RecordDetail>` is a plain `<div>`
 *   inside a `<td colSpan>`, so neither table implementation constrains it.
 * - **R3** — the row's severity comes out of `federationStatus.ts`'s audited
 *   table instead of an inline `text-destructive` on the Fail cell.
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>` wrapper around the
 *   table is gone; the console shell already supplies the title bar.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowDownUp, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import {
  RecordDetail,
  StatCluster,
  StatusBadge,
  rowAccentProps,
  type Stat,
} from "@/components/console";
import {
  deriveFederationStatus,
  FEDERATION_STATUS_PALETTE,
} from "./federationStatus";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 30_000;

// ---- Types ----------------------------------------------------------------

interface FederationReport {
  id: string;
  device_id: string;
  session_id?: string;
  account?: string;
  pushed: number;
  pulled: number;
  failed: number;
  failed_names?: string[];
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface FederationReportsResponse {
  reports?: FederationReport[];
  items?: FederationReport[];
  count?: number;
}

type TimeRange = "1h" | "24h" | "7d" | "all";

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: "Last 1h", value: "1h" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7d", value: "7d" },
  { label: "All", value: "all" },
];

function sinceParam(range: TimeRange): string | undefined {
  if (range === "all") return undefined;
  const now = new Date();
  const ms: Record<TimeRange, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    all: 0, // unused — guarded above
  };
  return new Date(now.getTime() - ms[range]).toISOString();
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncateId(id: string, len = 12): string {
  if (id.length <= len) return id;
  return id.slice(0, len) + "...";
}

// ---- Summary tiles --------------------------------------------------------

interface SummaryProps {
  reports: FederationReport[];
}

function SummaryTiles({ reports }: SummaryProps) {
  const sessions = reports.length;
  const pushed = reports.reduce((s, r) => s + (r.pushed ?? 0), 0);
  const pulled = reports.reduce((s, r) => s + (r.pulled ?? 0), 0);
  const failed = reports.reduce((s, r) => s + (r.failed ?? 0), 0);

  // R1's count-cluster opening. `attention` is the only tone that borrows the
  // R3 red and it means what it means everywhere else: a human must act on
  // what this counts. A zero fail total is NOT attention-toned — a red 0 is
  // the same bug as a red badge nobody must act on.
  const stats: Stat[] = [
    {
      key: "sessions",
      label: "sessions ",
      value: sessions,
      "data-testid": "federation-tile-sessions",
    },
    {
      key: "pushed",
      label: "pushed ",
      value: pushed,
      "data-testid": "federation-tile-pushed",
    },
    {
      key: "pulled",
      label: "pulled ",
      value: pulled,
      "data-testid": "federation-tile-pulled",
    },
    {
      key: "failed",
      label: "failed ",
      value: failed,
      "data-testid": "federation-tile-failed",
      tone: failed > 0 ? "attention" : "muted",
      title:
        failed > 0
          ? "Memories that did not federate. The runs are over — nothing retries these."
          : "No memory failed to federate in this window.",
    },
  ];

  return (
    <StatCluster stats={stats} data-testid="federation-summary" />
  );
}

// ---- Expanded row detail --------------------------------------------------

/**
 * R5's detail, in the shared host and the fixed slot order. `raw` is last and
 * carries the ids (R8): a session id and a device id are support material, not
 * something a primary surface should spend a column on.
 */
function ReportDetail({ report }: { report: FederationReport }) {
  const status = deriveFederationStatus(report);
  const failedNames = report.failed_names ?? [];
  return (
    <RecordDetail
      className="rounded-none border-x-0 border-b-0"
      data-testid="federation-row-detail"
      why={
        <p className="text-xs text-muted-foreground">
          {status.reason ??
            `This run pushed ${report.pushed} and pulled ${report.pulled} memories with no failures.`}
        </p>
      }
      problems={
        failedNames.length > 0 ? (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Did not federate — still local to this machine:
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-xs text-red-200">
              {failedNames.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : undefined
      }
      history={
        report.metadata && Object.keys(report.metadata).length > 0 ? (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Run metadata:</p>
            <pre className="max-h-48 overflow-x-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(report.metadata, null, 2)}
            </pre>
          </div>
        ) : undefined
      }
      raw={
        <div className="break-all font-mono text-[10px] text-muted-foreground/60">
          session: {report.session_id ?? "n/a"} · device: {report.device_id} ·
          report: {report.id}
        </div>
      }
    />
  );
}

// ---- Main page component --------------------------------------------------

type SortDir = "asc" | "desc";

export default function CoordFederationPage() {
  const [reports, setReports] = useState<FederationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchData = useCallback(async () => {
    try {
      const since = sinceParam(timeRange);
      const qs = new URLSearchParams();
      if (since) qs.set("since", since);
      qs.set("limit", "200");
      const body = await httpClient.get<FederationReportsResponse>(
        `${API}/federation/reports?${qs.toString()}`
      );
      setReports(body.reports ?? body.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const sorted = useMemo(() => {
    const copy = [...reports];
    copy.sort((a, b) => {
      const at = a.created_at ?? "";
      const bt = b.created_at ?? "";
      return sortDir === "desc"
        ? bt.localeCompare(at)
        : at.localeCompare(bt);
    });
    return copy;
  }, [reports, sortDir]);

  const toggleSort = useCallback(() => {
    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-federation-page"
    >
      {/* Time-range selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {TIME_RANGES.map((tr) => (
          <Button
            key={tr.value}
            size="sm"
            variant={timeRange === tr.value ? "default" : "outline"}
            onClick={() => setTimeRange(tr.value)}
            data-testid={`federation-range-${tr.value}`}
          >
            {tr.label}
          </Button>
        ))}
        {/* The record count the retired CardTitle carried, kept on the one
            chrome line R9 allows rather than in a 72px header of its own. */}
        <Badge variant="outline" className="ml-auto font-mono text-[11px]">
          <span className="font-normal text-muted-foreground">reports&nbsp;</span>
          {reports.length}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchData}
          data-testid="federation-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {/* Summary tiles */}
      {loading && reports.length === 0 ? (
        <Skeleton className="h-7 w-full max-w-md" />
      ) : (
        <SummaryTiles reports={reports} />
      )}

      {/* Reports table — R9: no page-level Card/CardHeader/CardTitle. The
          console shell owns the title bar; the count that used to justify the
          header rides on the one remaining chrome line above. */}
      {loading && reports.length === 0 ? (
        <Skeleton className="h-32 w-full" />
      ) : reports.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm italic text-muted-foreground">
          No federation reports in the selected time range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm" data-testid="federation-table">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2">
                  <button
                    onClick={toggleSort}
                    className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                  >
                    Time
                    <ArrowDownUp className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-2">Machine</th>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Run</th>
                <th className="px-4 py-2 text-right">Push</th>
                <th className="px-4 py-2 text-right">Pull</th>
                <th className="px-4 py-2 text-right">Fail</th>
                <th className="px-4 py-2 text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isExpanded = expandedId === r.id;
                const status = deriveFederationStatus(r);
                const durationMs =
                  r.metadata && typeof r.metadata.duration_ms === "number"
                    ? r.metadata.duration_ms
                    : null;
                return (
                  <Fragment key={r.id}>
                    <tr
                      data-testid="federation-row"
                      data-expanded={isExpanded ? "true" : "false"}
                      // R4 — the accent is a left border on the row; the row
                      // body stays neutral so 40 rows read when 6 are red.
                      {...rowAccentProps(
                        status,
                        "cursor-pointer border-b border-border transition-colors hover:bg-muted/30"
                      )}
                      onClick={() => toggleExpand(r.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          {formatTime(r.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {truncateId(r.device_id)}
                      </td>
                      <td className="px-4 py-2">
                        {r.account ?? (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge
                          status={status}
                          palette={FEDERATION_STATUS_PALETTE}
                        />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {r.pushed}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {r.pulled}
                      </td>
                      {/* No inline `text-destructive` here any more: R3's rule
                          is that one audited table decides the hue, and the
                          badge + accent beside this number already carry it. */}
                      <td className="px-4 py-2 text-right tabular-nums">
                        {r.failed}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {durationMs != null
                          ? `${(durationMs / 1000).toFixed(1)}s`
                          : "--"}
                      </td>
                    </tr>
                    {isExpanded && (
                      // D2 — a full-width cell beneath the row it belongs to.
                      // `<RecordDetail>` is a plain `<div>` in a `<td
                      // colSpan>`, which is why the same host works here on a
                      // NATIVE `<table>` and on `/gate-clearance`'s shadcn one.
                      <tr className="border-b border-border last:border-b-0">
                        <td colSpan={8} className="p-0">
                          <ReportDetail report={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
