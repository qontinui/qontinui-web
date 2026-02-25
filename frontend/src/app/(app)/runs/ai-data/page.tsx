"use client";

import { useState, Fragment } from "react";
import {
  useRunningTaskRuns,
  useTaskRunKnowledge,
  useTaskRunVerification,
  useTaskRunMcpCalls,
} from "@/lib/runner-api";
import type { Finding, VerificationResult, McpCall } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Database,
  Brain,
  ShieldCheck,
  Wrench,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSeverityBadge(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "high":
      return (
        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
          High
        </Badge>
      );
    case "medium":
      return <Badge variant="warning">Medium</Badge>;
    case "low":
      return <Badge variant="info">Low</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "completed":
    case "complete":
      return <Badge variant="success">Completed</Badge>;
    case "running":
    case "in_progress":
      return <Badge variant="info">Running</Badge>;
    case "failed":
    case "error":
      return <Badge variant="destructive">Failed</Badge>;
    case "stopped":
      return <Badge variant="warning">Stopped</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString();
}

function formatDuration(ms: number | undefined | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.round(secs % 60);
  return `${mins}m ${remainSecs}s`;
}

function tryFormatJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KnowledgeTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunKnowledge(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        Loading knowledge...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        Error loading knowledge: {error}
      </div>
    );
  }

  const findings = data?.findings ?? [];
  const observations = data?.observations ?? [];
  const hypotheses = data?.hypotheses ?? [];

  if (
    findings.length === 0 &&
    observations.length === 0 &&
    hypotheses.length === 0
  ) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Brain className="size-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No knowledge entries for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Findings Table */}
      {findings.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-3">
            Findings ({findings.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle/50">
                  <th className="text-left py-2 px-3 text-text-muted font-medium">
                    Severity
                  </th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">
                    Category
                  </th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">
                    Title
                  </th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">
                    File
                  </th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding: Finding) => (
                  <tr
                    key={finding.id}
                    className="border-b border-border-subtle/30 hover:bg-surface-raised/30"
                  >
                    <td className="py-2.5 px-3">
                      {getSeverityBadge(finding.severity)}
                    </td>
                    <td className="py-2.5 px-3 text-text-secondary">
                      <Badge variant="outline" className="text-xs">
                        {finding.category}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      <div
                        data-content-role="label"
                        data-content-label="finding title"
                        className="text-text-primary font-medium"
                      >
                        {finding.title}
                      </div>
                      <div
                        data-content-role="description"
                        data-content-label="finding description"
                        className="text-text-muted text-xs mt-0.5 line-clamp-2"
                      >
                        {finding.description}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-text-muted max-w-[200px] truncate">
                      {finding.file_path
                        ? `${finding.file_path}${finding.line_number ? `:${finding.line_number}` : ""}`
                        : "-"}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="secondary" className="text-xs">
                        {finding.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Observations */}
      {observations.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-3">
            Observations ({observations.length})
          </h3>
          <div className="space-y-2">
            {observations.map((obs, idx) => (
              <div
                key={idx}
                className="bg-surface-raised/30 border border-border-subtle/30 rounded-lg px-4 py-3 text-sm text-text-secondary"
              >
                {obs}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hypotheses */}
      {hypotheses.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-3">
            Hypotheses ({hypotheses.length})
          </h3>
          <div className="space-y-2">
            {hypotheses.map((hyp, idx) => (
              <div
                key={idx}
                className="bg-surface-raised/30 border border-border-subtle/30 rounded-lg px-4 py-3 text-sm text-text-secondary italic"
              >
                {hyp}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VerificationTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunVerification(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        Loading verification results...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        Error loading verification: {error}
      </div>
    );
  }

  const results = data?.results ?? [];

  if (results.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <ShieldCheck className="size-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No verification results for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((result: VerificationResult) => (
        <Card
          key={result.id}
          className="bg-surface-raised/30 border-border-subtle/50"
        >
          <CardContent className="py-3.5 px-4">
            <div className="flex items-start gap-3">
              <div className="pt-0.5">
                {result.passed ? (
                  <CheckCircle2 className="size-5 text-green-500" />
                ) : (
                  <XCircle className="size-5 text-red-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    data-content-role="label"
                    data-content-label="verification criterion"
                    className="text-sm font-medium text-text-primary"
                  >
                    {result.criterion}
                  </span>
                  <Badge
                    variant={result.passed ? "success" : "destructive"}
                    className="text-xs"
                  >
                    {result.passed ? "Passed" : "Failed"}
                  </Badge>
                  {result.confidence != null && (
                    <span
                      data-content-role="metric"
                      data-content-label="verification confidence"
                      className="text-xs text-text-muted"
                    >
                      {Math.round(result.confidence * 100)}% confidence
                    </span>
                  )}
                </div>
                {result.observation && (
                  <p className="text-sm text-text-muted mt-1.5">
                    {result.observation}
                  </p>
                )}
                <div
                  data-content-role="metric"
                  data-content-label="verification timestamp"
                  className="text-xs text-text-muted mt-1.5"
                >
                  Checked at {formatDate(result.verified_at)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function McpCallsTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunMcpCalls(runId);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        Loading MCP calls...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        Error loading MCP calls: {error}
      </div>
    );
  }

  const calls = data ?? [];

  if (calls.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Wrench className="size-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No MCP tool calls for this run.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle/50">
            <th className="w-8" />
            <th className="text-left py-2 px-3 text-text-muted font-medium">
              Tool Name
            </th>
            <th className="text-left py-2 px-3 text-text-muted font-medium">
              Status
            </th>
            <th className="text-right py-2 px-3 text-text-muted font-medium">
              Duration
            </th>
            <th className="text-left py-2 px-3 text-text-muted font-medium">
              Created At
            </th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call: McpCall) => {
            const isExpanded = expandedRow === call.id;
            return (
              <Fragment key={call.id}>
                <tr
                  className="border-b border-border-subtle/30 hover:bg-surface-raised/30 cursor-pointer"
                  onClick={() => setExpandedRow(isExpanded ? null : call.id)}
                >
                  <td className="py-2.5 px-2 text-text-muted">
                    {isExpanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-text-primary text-xs">
                    {call.tool_name}
                  </td>
                  <td className="py-2.5 px-3">
                    <Badge
                      variant={
                        call.status === "success"
                          ? "success"
                          : call.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-xs"
                    >
                      {call.status}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-3 text-right text-text-secondary">
                    {formatDuration(call.duration_ms)}
                  </td>
                  <td className="py-2.5 px-3 text-text-muted text-xs">
                    {formatDate(call.timestamp)}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-border-subtle/30">
                    <td colSpan={5} className="p-0">
                      <div className="bg-surface-canvas/60 px-6 py-4 space-y-3">
                        {call.input && Object.keys(call.input).length > 0 && (
                          <div>
                            <div
                              data-content-role="label"
                              data-content-label="mcp call arguments label"
                              className="text-xs font-medium text-text-muted mb-1"
                            >
                              Arguments
                            </div>
                            <pre className="text-xs font-mono text-text-secondary bg-surface-raised/30 rounded-md p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                              {tryFormatJson(call.input)}
                            </pre>
                          </div>
                        )}
                        {call.output != null && (
                          <div>
                            <div
                              data-content-role="label"
                              data-content-label="mcp call result label"
                              className="text-xs font-medium text-text-muted mb-1"
                            >
                              Result
                            </div>
                            <pre className="text-xs font-mono text-text-secondary bg-surface-raised/30 rounded-md p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                              {tryFormatJson(call.output)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AiDataPage() {
  const { data: runs, isLoading, isOffline } = useRunningTaskRuns();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // If runs loaded and nothing selected, auto-select the first one
  const effectiveRunId =
    selectedRunId ?? (runs && runs.length > 0 ? String(runs[0]!.id) : null);

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Database className="size-6 text-cyan-500" />
            <h1 className="text-2xl font-bold text-text-primary">
              AI Data View
            </h1>
          </div>
        </div>
      </header>

      {isOffline && (
        <RunnerPartialState message="Runner offline — live data unavailable" />
      )}

      {/* Body - two panel layout */}
      <div className="flex h-[calc(100vh-65px)]">
        {/* Left Panel - Run List */}
        <div className="w-[250px] min-w-[250px] border-r border-border-subtle/50 bg-surface-canvas/40">
          <div className="px-4 py-3 border-b border-border-subtle/30">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
              Recent Runs
            </h2>
          </div>
          <ScrollArea className="h-[calc(100vh-65px-45px)]">
            {isLoading ? (
              <div className="text-center py-8 text-text-muted text-sm">
                Loading runs...
              </div>
            ) : !runs || runs.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm px-4">
                No recent runs found. Start a task in the runner to see data
                here.
              </div>
            ) : (
              <div className="py-1">
                {runs.map((run) => {
                  const runId = String(run.id);
                  const isSelected = effectiveRunId === runId;
                  return (
                    <button
                      key={run.id}
                      onClick={() => setSelectedRunId(runId)}
                      className={`w-full text-left px-4 py-3 border-b border-border-subtle/20 transition-colors ${
                        isSelected
                          ? "bg-surface-raised/50 border-l-2 border-l-cyan-500"
                          : "hover:bg-surface-raised/20 border-l-2 border-l-transparent"
                      }`}
                    >
                      <div className="text-sm font-medium text-text-primary truncate">
                        {run.task_name || `Run #${run.id}`}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        {getStatusBadge(run.status)}
                        <span
                          data-content-role="label"
                          data-content-label="run id"
                          className="text-xs text-text-muted"
                        >
                          #{run.id}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right Panel - Tabbed Data View */}
        <div className="flex-1 min-w-0">
          {effectiveRunId == null ? (
            <div className="flex items-center justify-center h-full text-text-muted">
              <div className="text-center">
                <Database className="size-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm">
                  Select a run from the left panel to view its AI data.
                </p>
              </div>
            </div>
          ) : (
            <Tabs defaultValue="knowledge" className="h-full flex flex-col">
              <div className="border-b border-border-subtle/50 px-6">
                <TabsList className="bg-transparent h-12">
                  <TabsTrigger
                    value="knowledge"
                    className="data-[state=active]:bg-surface-raised/50 data-[state=active]:text-text-primary gap-1.5"
                  >
                    <Brain className="size-4" />
                    Knowledge
                  </TabsTrigger>
                  <TabsTrigger
                    value="verification"
                    className="data-[state=active]:bg-surface-raised/50 data-[state=active]:text-text-primary gap-1.5"
                  >
                    <ShieldCheck className="size-4" />
                    Verification
                  </TabsTrigger>
                  <TabsTrigger
                    value="mcp-calls"
                    className="data-[state=active]:bg-surface-raised/50 data-[state=active]:text-text-primary gap-1.5"
                  >
                    <Wrench className="size-4" />
                    MCP Calls
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="flex-1 overflow-auto">
                <TabsContent value="knowledge" className="mt-0 p-6">
                  <KnowledgeTab runId={effectiveRunId} />
                </TabsContent>

                <TabsContent value="verification" className="mt-0 p-6">
                  <VerificationTab runId={effectiveRunId} />
                </TabsContent>

                <TabsContent value="mcp-calls" className="mt-0 p-6">
                  <McpCallsTab runId={effectiveRunId} />
                </TabsContent>
              </div>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
