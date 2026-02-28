"use client";

import { useMemo } from "react";
import { useExplorationHistory } from "@/lib/runner-api";
import type { ExplorationReport } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Compass, RefreshCw, Loader2 } from "lucide-react";

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString();
}

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "complete":
    case "completed":
      return <Badge variant="success">Complete</Badge>;
    case "running":
      return <Badge variant="info">Running</Badge>;
    case "error":
    case "failed":
      return <Badge variant="destructive">Error</Badge>;
    case "stopped":
      return <Badge variant="warning">Stopped</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getCoverageColor(pct: number | undefined): string {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 80) return "text-green-500";
  if (pct >= 50) return "text-yellow-500";
  return "text-red-500";
}

export default function DiscoveriesPage() {
  const {
    data: reports,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useExplorationHistory(50);

  const summary = useMemo(() => {
    if (!reports || reports.length === 0) return null;
    const totalStates = reports.reduce(
      (sum, r) => sum + (r.states_visited || 0),
      0
    );
    const totalTransitions = reports.reduce(
      (sum, r) => sum + (r.transitions_tested || 0),
      0
    );
    const withCoverage = reports.filter((r) => r.coverage_pct != null);
    const avgCoverage =
      withCoverage.length > 0
        ? withCoverage.reduce((sum, r) => sum + (r.coverage_pct || 0), 0) /
          withCoverage.length
        : 0;
    return {
      totalRuns: reports.length,
      totalStates,
      totalTransitions,
      avgCoverage,
    };
  }, [reports]);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Discoveries</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </header>

      {isOffline && (
        <RunnerPartialState message="Runner offline — live data unavailable" />
      )}

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <p className="text-muted-foreground text-sm">
          GUI state exploration results and discoveries.
        </p>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            <Loader2 className="size-6 animate-spin mx-auto mb-3" />
            Loading exploration history...
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-400">
            Error loading data: {error}
          </div>
        ) : !summary ? (
          <Card className="bg-muted border-border">
            <CardContent className="py-16">
              <div className="text-center text-muted-foreground">
                <Compass className="size-16 mx-auto mb-4" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-muted-foreground mb-2"
                >
                  No Explorations Yet
                </h3>
                <p className="text-sm">
                  Run a state exploration in the Runner to discover GUI states
                  and transitions.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-muted/50 border-border">
                <CardContent className="pt-6">
                  <div
                    data-content-role="label"
                    data-content-label="total runs label"
                    className="text-xs text-muted-foreground mb-2"
                  >
                    Total Runs
                  </div>
                  <div
                    data-content-role="metric"
                    data-content-label="total runs"
                    className="text-3xl font-bold text-foreground"
                  >
                    {summary.totalRuns}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-muted/50 border-border">
                <CardContent className="pt-6">
                  <div
                    data-content-role="label"
                    data-content-label="total states label"
                    className="text-xs text-muted-foreground mb-2"
                  >
                    Total States Discovered
                  </div>
                  <div
                    data-content-role="metric"
                    data-content-label="total states"
                    className="text-3xl font-bold text-foreground"
                  >
                    {summary.totalStates}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-muted/50 border-border">
                <CardContent className="pt-6">
                  <div
                    data-content-role="label"
                    data-content-label="total transitions label"
                    className="text-xs text-muted-foreground mb-2"
                  >
                    Total Transitions
                  </div>
                  <div
                    data-content-role="metric"
                    data-content-label="total transitions"
                    className="text-3xl font-bold text-foreground"
                  >
                    {summary.totalTransitions}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-muted/50 border-border">
                <CardContent className="pt-6">
                  <div
                    data-content-role="label"
                    data-content-label="average coverage label"
                    className="text-xs text-muted-foreground mb-2"
                  >
                    Average Coverage
                  </div>
                  <div
                    data-content-role="metric"
                    data-content-label="average coverage"
                    className={`text-3xl font-bold ${getCoverageColor(summary.avgCoverage)}`}
                  >
                    {summary.avgCoverage.toFixed(1)}%
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Exploration Runs Table */}
            <Card className="bg-muted/50 border-border">
              <CardContent className="pt-6">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead>Status</TableHead>
                        <TableHead>Strategy</TableHead>
                        <TableHead className="text-right">States</TableHead>
                        <TableHead className="text-right">
                          Transitions
                        </TableHead>
                        <TableHead className="text-right">Coverage</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead>Started</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(reports || []).map((report: ExplorationReport) => (
                        <TableRow
                          key={report.id}
                          className="border-border hover:bg-muted/50"
                        >
                          <TableCell>{getStatusBadge(report.status)}</TableCell>
                          <TableCell className="font-medium text-foreground">
                            {report.strategy || "-"}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {report.states_visited ?? "-"}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {report.transitions_tested ?? "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {report.coverage_pct != null ? (
                              <span
                                data-content-role="metric"
                                data-content-label="coverage percentage"
                                className={`font-medium ${getCoverageColor(report.coverage_pct)}`}
                              >
                                {report.coverage_pct.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatDuration(report.duration_seconds)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(report.started_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
