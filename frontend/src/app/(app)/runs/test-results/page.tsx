"use client";

import { useState } from "react";
import { useRunningTaskRuns, useTaskRunPlaywright } from "@/lib/runner-api";
import type { PlaywrightResult } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TestTube2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  ChevronRight,
  Inbox,
  ChevronDown,
  RefreshCw,
  Layers,
} from "lucide-react";

function getRunStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "running":
      return <RefreshCw className="size-4 text-blue-500 animate-spin" />;
    default:
      return <Clock className="size-4 text-muted-foreground" />;
  }
}

function getSpecStatusIcon(status: string) {
  switch (status) {
    case "passed":
      return <CheckCircle2 className="size-5 text-green-500" />;
    case "failed":
      return <XCircle className="size-5 text-red-500" />;
    case "skipped":
      return <MinusCircle className="size-5 text-gray-400" />;
    default:
      return <Clock className="size-5 text-muted-foreground" />;
  }
}

function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

function SummaryBar({ results }: { results: PlaywrightResult[] }) {
  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const totalDuration = results.reduce(
    (sum, r) => sum + (r.duration_ms || 0),
    0
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
      <Card className="bg-muted border-border">
        <CardContent className="pt-4 pb-3 text-center">
          <div
            data-content-role="metric"
            data-content-label="total specs"
            className="text-2xl font-bold text-foreground"
          >
            {total}
          </div>
          <div
            data-content-role="label"
            data-content-label="total specs label"
            className="text-xs text-muted-foreground mt-0.5"
          >
            Total Specs
          </div>
        </CardContent>
      </Card>
      <Card className="bg-muted border-border">
        <CardContent className="pt-4 pb-3 text-center">
          <div
            data-content-role="metric"
            data-content-label="passed count"
            className="text-2xl font-bold text-green-500"
          >
            {passed}
          </div>
          <div
            data-content-role="label"
            data-content-label="passed label"
            className="text-xs text-muted-foreground mt-0.5"
          >
            Passed
          </div>
        </CardContent>
      </Card>
      <Card className="bg-muted border-border">
        <CardContent className="pt-4 pb-3 text-center">
          <div
            data-content-role="metric"
            data-content-label="failed count"
            className="text-2xl font-bold text-red-500"
          >
            {failed}
          </div>
          <div
            data-content-role="label"
            data-content-label="failed label"
            className="text-xs text-muted-foreground mt-0.5"
          >
            Failed
          </div>
        </CardContent>
      </Card>
      <Card className="bg-muted border-border">
        <CardContent className="pt-4 pb-3 text-center">
          <div
            data-content-role="metric"
            data-content-label="skipped count"
            className="text-2xl font-bold text-gray-400"
          >
            {skipped}
          </div>
          <div
            data-content-role="label"
            data-content-label="skipped label"
            className="text-xs text-muted-foreground mt-0.5"
          >
            Skipped
          </div>
        </CardContent>
      </Card>
      <Card className="bg-muted border-border">
        <CardContent className="pt-4 pb-3 text-center">
          <div
            data-content-role="metric"
            data-content-label="total duration"
            className="text-2xl font-bold text-foreground"
          >
            {formatDuration(totalDuration)}
          </div>
          <div
            data-content-role="label"
            data-content-label="total time label"
            className="text-xs text-muted-foreground mt-0.5"
          >
            Total Time
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SpecResultCard({ result }: { result: PlaywrightResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = result.status === "failed" && result.error_message;
  const hasOutput = !!result.console_output;
  const isExpandable = hasError || hasOutput;

  return (
    <Card
      className={`bg-muted/50 border-border transition-all ${
        isExpandable ? "cursor-pointer hover:bg-muted" : ""
      }`}
      onClick={() => {
        if (isExpandable) setExpanded(!expanded);
      }}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="shrink-0">{getSpecStatusIcon(result.status)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isExpandable &&
                (expanded ? (
                  <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                ))}
              <span
                data-content-role="label"
                data-content-label="test name"
                className="text-sm font-medium text-foreground truncate"
              >
                {result.test_name}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {result.duration_ms != null && (
              <span
                data-content-role="metric"
                data-content-label="test duration"
                className="text-xs text-muted-foreground flex items-center gap-1"
              >
                <Clock className="size-3" />
                {formatDuration(result.duration_ms)}
              </span>
            )}
            <Badge
              variant={
                result.status === "passed"
                  ? "default"
                  : result.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
              className={
                result.status === "passed"
                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : ""
              }
            >
              {result.status}
            </Badge>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {hasError && (
              <div>
                <div
                  data-content-role="label"
                  data-content-label="error message heading"
                  className="text-xs font-medium text-red-400 mb-1"
                >
                  Error Message
                </div>
                <pre className="text-xs font-mono text-red-300 bg-red-950/30 border border-red-500/20 rounded-md p-3 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
                  {result.error_message}
                </pre>
              </div>
            )}
            {hasOutput && (
              <div>
                <div
                  data-content-role="label"
                  data-content-label="console output heading"
                  className="text-xs font-medium text-muted-foreground mb-1"
                >
                  Console Output
                </div>
                <pre className="text-xs font-mono text-muted-foreground bg-background border border-border rounded-md p-3 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
                  {result.console_output}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TestResultsPage() {
  const {
    data: runsData,
    isLoading: runsLoading,
    error: runsError,
    isOffline,
    refetch,
  } = useRunningTaskRuns();

  const runs = (runsData || []).slice(0, 20);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const {
    data: playwrightResults,
    isLoading: resultsLoading,
    error: resultsError,
  } = useTaskRunPlaywright(selectedRunId);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Test Results</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </header>

      {isOffline && (
        <RunnerPartialState message="Runner offline — live data unavailable" />
      )}

      <main className="flex-1 overflow-y-auto p-6">
        <p className="text-muted-foreground text-sm mb-6">
          Browse Playwright test results from task runs. Select a run to view
          its test specs and outcomes.
        </p>

        {runsLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
            Loading runs...
          </div>
        ) : runsError ? (
          <div className="text-center py-16 text-red-400">
            Error loading runs: {runsError}
          </div>
        ) : runs.length === 0 ? (
          <Card className="bg-muted border-border">
            <CardContent className="py-16">
              <div className="text-center text-muted-foreground">
                <Inbox className="size-16 mx-auto mb-4" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-muted-foreground mb-2"
                >
                  No Runs Available
                </h3>
                <p className="text-sm">
                  Execute tasks with Playwright tests in the Runner to see
                  results here.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex gap-6">
            {/* Left Panel - Run List */}
            <div className="w-[250px] shrink-0">
              <Card className="bg-muted border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Layers className="size-4" />
                    Runs ({runs.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[calc(100vh-280px)]">
                    <div className="divide-y divide-border-subtle/30">
                      {runs.map((run) => (
                        <button
                          key={run.id}
                          onClick={() => setSelectedRunId(run.id)}
                          className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3 ${
                            selectedRunId === run.id
                              ? "bg-muted border-l-2 border-primary"
                              : "border-l-2 border-transparent"
                          }`}
                        >
                          {getRunStatusIcon(run.status)}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">
                              {run.task_name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {formatDateTime(run.created_at)}
                            </div>
                          </div>
                          <ChevronRight
                            className={`size-4 shrink-0 transition-colors ${
                              selectedRunId === run.id
                                ? "text-primary"
                                : "text-muted-foreground"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Right Panel - Playwright Results */}
            <div className="flex-1 min-w-0">
              {selectedRunId == null ? (
                <Card className="bg-muted border-border">
                  <CardContent className="py-20">
                    <div className="text-center text-muted-foreground">
                      <TestTube2 className="size-12 mx-auto mb-4" />
                      <h3
                        data-content-role="heading"
                        data-content-label="empty state title"
                        className="text-lg font-medium text-muted-foreground mb-2"
                      >
                        Select a Run
                      </h3>
                      <p className="text-sm">
                        Choose a run from the list to view its Playwright test
                        results.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : resultsLoading ? (
                <Card className="bg-muted border-border">
                  <CardContent className="py-20">
                    <div className="text-center text-muted-foreground">
                      <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
                      Loading test results...
                    </div>
                  </CardContent>
                </Card>
              ) : resultsError ? (
                <Card className="bg-muted border-border">
                  <CardContent className="py-20">
                    <div className="text-center text-red-400">
                      Error loading results: {resultsError}
                    </div>
                  </CardContent>
                </Card>
              ) : !playwrightResults || playwrightResults.length === 0 ? (
                <Card className="bg-muted border-border">
                  <CardContent className="py-20">
                    <div className="text-center text-muted-foreground">
                      <TestTube2 className="size-12 mx-auto mb-4" />
                      <h3
                        data-content-role="heading"
                        data-content-label="empty state title"
                        className="text-lg font-medium text-muted-foreground mb-2"
                      >
                        No Test Results
                      </h3>
                      <p className="text-sm">
                        This run does not have any Playwright test results.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div>
                  <SummaryBar results={playwrightResults} />

                  <Card className="bg-muted border-border">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <TestTube2 className="size-4 text-purple-400" />
                        Spec Results
                        <Badge variant="secondary" className="ml-1">
                          {playwrightResults.length}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {playwrightResults.map((result: PlaywrightResult) => (
                          <SpecResultCard key={result.id} result={result} />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
