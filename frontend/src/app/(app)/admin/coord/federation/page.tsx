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
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  GitMerge,
  RefreshCw,
} from "lucide-react";
import { httpClient } from "@/services/service-factory";

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

  const tiles = [
    { label: "Sessions", value: sessions, destructive: false },
    { label: "Pushed", value: pushed, destructive: false },
    { label: "Pulled", value: pulled, destructive: false },
    { label: "Failed", value: failed, destructive: failed > 0 },
  ];

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      data-testid="federation-summary"
    >
      {tiles.map((t) => (
        <Card key={t.label} data-testid={`federation-tile-${t.label.toLowerCase()}`}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p
              className={`text-2xl font-bold tabular-nums ${
                t.destructive ? "text-destructive" : ""
              }`}
            >
              {t.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---- Expanded row detail --------------------------------------------------

function RowDetail({ report }: { report: FederationReport }) {
  return (
    <div className="px-4 py-3 bg-muted/50 border-t border-border text-sm space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>
          <span className="text-muted-foreground">Session:</span>{" "}
          <span className="font-mono text-xs">
            {report.session_id ?? "n/a"}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Device:</span>{" "}
          <span className="font-mono text-xs">{report.device_id}</span>
        </span>
      </div>

      {report.failed_names && report.failed_names.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1">Failed memories:</p>
          <ul className="list-disc list-inside text-destructive text-xs space-y-0.5">
            {report.failed_names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {report.metadata && Object.keys(report.metadata).length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1">Metadata:</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-48">
            {JSON.stringify(report.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
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
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchData}
          className="ml-auto"
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <SummaryTiles reports={reports} />
      )}

      {/* Reports table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitMerge className="h-4 w-4" />
            Federation reports
            <Badge variant="outline" className="ml-2">
              {reports.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && reports.length === 0 ? (
            <div className="p-4">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : reports.length === 0 ? (
            <p className="text-sm text-muted-foreground italic p-4">
              No federation reports in the selected time range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="federation-table">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-2 w-8" />
                    <th className="px-4 py-2">
                      <button
                        onClick={toggleSort}
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Time
                        <ArrowDownUp className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-4 py-2">Machine</th>
                    <th className="px-4 py-2">Account</th>
                    <th className="px-4 py-2 text-right">Push</th>
                    <th className="px-4 py-2 text-right">Pull</th>
                    <th className="px-4 py-2 text-right">Fail</th>
                    <th className="px-4 py-2 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const isExpanded = expandedId === r.id;
                    const durationMs =
                      r.metadata &&
                      typeof r.metadata.duration_ms === "number"
                        ? r.metadata.duration_ms
                        : null;
                    return (
                      <Fragment key={r.id}>
                        <tr
                          data-testid="federation-row"
                          className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => toggleExpand(r.id)}
                        >
                          <td className="px-4 py-2 text-muted-foreground">
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {formatTime(r.created_at)}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs">
                            {truncateId(r.device_id)}
                          </td>
                          <td className="px-4 py-2">
                            {r.account ?? <span className="text-muted-foreground">--</span>}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.pushed}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.pulled}
                          </td>
                          <td
                            className={`px-4 py-2 text-right tabular-nums ${
                              r.failed > 0 ? "text-destructive font-medium" : ""
                            }`}
                          >
                            {r.failed}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                            {durationMs != null
                              ? `${(durationMs / 1000).toFixed(1)}s`
                              : "--"}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-border last:border-b-0">
                            <td colSpan={8} className="p-0">
                              <RowDetail report={r} />
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
        </CardContent>
      </Card>
    </div>
  );
}
