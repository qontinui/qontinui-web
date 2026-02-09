"use client";

import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  useTaskRun,
  useTaskRunOutput,
  useTaskRunKnowledge,
  useTaskRunVerification,
  useTaskRunPlaywright,
  useTaskRunMcpCalls,
  useTaskRunScreenshots,
} from "@/lib/runner-api";
import type {
  Finding,
  VerificationResult,
  PlaywrightResult,
  McpCall,
  Screenshot,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { OverviewTab } from "@/components/run-detail/OverviewTab";
import { TimelineTab } from "@/components/run-detail/TimelineTab";
import { ContextTab } from "@/components/run-detail/ContextTab";
import { ActionsTab } from "@/components/run-detail/ActionsTab";
import { ImageRecognitionTab } from "@/components/run-detail/ImageRecognitionTab";
import { AiSessionTab } from "@/components/run-detail/AiSessionTab";
import { EventsTab } from "@/components/run-detail/EventsTab";
import { ApiRequestsTab } from "@/components/run-detail/ApiRequestsTab";
import { McpCallsTab } from "@/components/run-detail/McpCallsTab";
import { DomSnapshotsTab } from "@/components/run-detail/DomSnapshotsTab";
import { ConfigurationTab } from "@/components/run-detail/ConfigurationTab";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  FileText,
  ShieldCheck,
  Brain,
  TestTube2,
  Terminal,
  Zap,
  MessageSquare,
  Info,
  Image,
  Clock,
  BookOpen,
  Eye,
  Activity,
  Globe,
  Wrench,
  FileCode,
  Settings,
} from "lucide-react";

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="success">Completed</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "running":
      return <Badge variant="info">Running</Badge>;
    case "stopped":
      return <Badge variant="secondary">Stopped</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

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
      return <Badge variant="secondary">Low</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}

// =============================================================================
// Tab Content Components
// =============================================================================

function VerificationTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunVerification(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading verification results...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <ShieldCheck className="size-12 mx-auto mb-4" />
        <p>No verification results for this run.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border-subtle/50">
            <TableHead>Result</TableHead>
            <TableHead>Criterion</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Observation</TableHead>
            <TableHead>Verified At</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data as VerificationResult[]).map((result) => (
            <TableRow key={result.id} className="border-border-subtle/50">
              <TableCell>
                {result.passed ? (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-green-500" />
                    <span className="text-green-400 text-sm">Pass</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <XCircle className="size-4 text-red-500" />
                    <span className="text-red-400 text-sm">Fail</span>
                  </div>
                )}
              </TableCell>
              <TableCell className="font-medium text-text-primary max-w-xs">
                {result.criterion}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    result.confidence >= 0.8
                      ? "success"
                      : result.confidence >= 0.5
                        ? "warning"
                        : "destructive"
                  }
                >
                  {Math.round(result.confidence * 100)}%
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-text-secondary max-w-sm truncate">
                {result.observation}
              </TableCell>
              <TableCell className="text-sm text-text-muted">
                {formatDateTime(result.verified_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function KnowledgeTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunKnowledge(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading knowledge...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (
    !data ||
    (data.findings.length === 0 &&
      data.observations.length === 0 &&
      data.hypotheses.length === 0)
  ) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Brain className="size-12 mx-auto mb-4" />
        <p>No knowledge captured for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.findings.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-base">
              Findings ({data.findings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.findings.map((finding: Finding) => (
                <div
                  key={finding.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-surface-canvas/50 border border-border-subtle/30"
                >
                  <div className="pt-0.5">
                    {getSeverityBadge(finding.severity)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text-primary text-sm">
                      {finding.title}
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      {finding.description}
                    </p>
                    {finding.file_path && (
                      <div className="text-xs text-text-muted mt-1 font-mono">
                        {finding.file_path}
                        {finding.line_number ? `:${finding.line_number}` : ""}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">
                        {finding.category}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {finding.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.observations.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-base">
              Observations ({data.observations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.observations.map((obs: string, i: number) => (
                <li
                  key={i}
                  className="text-sm text-text-secondary pl-4 border-l-2 border-border-subtle"
                >
                  {obs}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data.hypotheses.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-base">
              Hypotheses ({data.hypotheses.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.hypotheses.map((hyp: string, i: number) => (
                <li
                  key={i}
                  className="text-sm text-text-secondary pl-4 border-l-2 border-brand-primary/30"
                >
                  {hyp}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TestsTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunPlaywright(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading test results...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <TestTube2 className="size-12 mx-auto mb-4" />
        <p>No test results for this run.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border-subtle/50">
            <TableHead>Status</TableHead>
            <TableHead>Test Name</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data as PlaywrightResult[]).map((test) => (
            <TableRow key={test.id} className="border-border-subtle/50">
              <TableCell>
                {test.status === "passed" ? (
                  <Badge variant="success">Passed</Badge>
                ) : test.status === "failed" ? (
                  <Badge variant="destructive">Failed</Badge>
                ) : (
                  <Badge variant="secondary">{test.status}</Badge>
                )}
              </TableCell>
              <TableCell className="font-medium text-text-primary">
                {test.test_name}
              </TableCell>
              <TableCell className="text-sm text-text-muted">
                {test.duration_ms}ms
              </TableCell>
              <TableCell className="text-sm text-red-400 max-w-sm truncate">
                {test.error_message || "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OutputTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunOutput(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading output...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (!data || !data.output_log) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Terminal className="size-12 mx-auto mb-4" />
        <p>No output log available for this run.</p>
      </div>
    );
  }

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50">
      <CardContent className="pt-6">
        <ScrollArea className="h-[600px]">
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed p-4 bg-surface-canvas/50 rounded-lg">
            {data.output_log}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function AiDataTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunMcpCalls(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading AI data...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <MessageSquare className="size-12 mx-auto mb-4" />
        <p>No MCP tool calls recorded for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(data as McpCall[]).map((call) => (
        <Card
          key={call.id}
          className="bg-surface-raised/30 border-border-subtle/50"
        >
          <CardContent className="py-4 px-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge variant="info" className="text-xs font-mono">
                  {call.tool_name}
                </Badge>
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
              </div>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                {call.duration_ms != null && <span>{call.duration_ms}ms</span>}
                <span>{formatDateTime(call.timestamp)}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div>
                <div className="text-xs font-medium text-text-muted mb-1">
                  Input
                </div>
                <pre className="text-xs font-mono text-text-secondary bg-surface-canvas/50 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                  {JSON.stringify(call.input, null, 2)}
                </pre>
              </div>
              {call.output && (
                <div>
                  <div className="text-xs font-medium text-text-muted mb-1">
                    Output
                  </div>
                  <pre className="text-xs font-mono text-text-secondary bg-surface-canvas/50 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                    {JSON.stringify(call.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ScreenshotsTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunScreenshots(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading screenshots...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  const screenshots = (data as { screenshots?: Screenshot[] })?.screenshots;

  if (!screenshots || screenshots.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Image className="size-12 mx-auto mb-4" />
        <p>No screenshots captured for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {screenshots.map((shot) => (
        <Card
          key={shot.id}
          className="bg-surface-raised/30 border-border-subtle/50"
        >
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Image className="size-4 text-text-muted" />
                <span className="text-sm font-medium text-text-primary">
                  {shot.filename}
                </span>
              </div>
              <span className="text-xs text-text-muted">
                {formatDateTime(shot.timestamp)}
              </span>
            </div>
            {shot.description && (
              <p className="text-xs text-text-secondary mt-1.5 ml-7">
                {shot.description}
              </p>
            )}
            <div className="text-xs font-mono text-text-muted mt-1.5 ml-7 truncate">
              {shot.path}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id ? String(params.id) : null;

  const { data: run, isLoading, error, isOffline, refetch } = useTaskRun(runId);

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <div className="text-center text-text-muted">
          <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
          Loading run details...
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas">
        <div className="p-6 max-w-7xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => router.push("/runs")}
            className="mb-4"
          >
            <ArrowLeft className="size-4 mr-2" />
            Back to Runs
          </Button>
          <div className="text-center py-20 text-red-400">
            <Info className="size-12 mx-auto mb-4" />
            <p className="font-medium">Run not found</p>
            <p className="text-sm text-text-muted mt-1">
              {error || "The run you are looking for does not exist."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/runs")}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="size-4 mr-1" />
              Back
            </Button>
            <div className="h-5 w-px bg-border-subtle" />
            <h1 className="text-lg font-semibold text-text-primary truncate max-w-md">
              {run.task_name}
            </h1>
            {getStatusBadge(run.status)}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-border-default"
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <Tabs defaultValue="overview">
          <TabsList className="mb-6 flex-wrap">
            <TabsTrigger value="overview" className="gap-1.5">
              <FileText className="size-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="verification" className="gap-1.5">
              <ShieldCheck className="size-3.5" />
              Verification
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-1.5">
              <Brain className="size-3.5" />
              Knowledge
            </TabsTrigger>
            <TabsTrigger value="tests" className="gap-1.5">
              <TestTube2 className="size-3.5" />
              Tests
            </TabsTrigger>
            <TabsTrigger value="output" className="gap-1.5">
              <Terminal className="size-3.5" />
              Output
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-1.5">
              <Zap className="size-3.5" />
              Actions
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-1.5">
              <Clock className="size-3.5" />
              Timeline
            </TabsTrigger>
            <TabsTrigger value="context" className="gap-1.5">
              <BookOpen className="size-3.5" />
              Context
            </TabsTrigger>
            <TabsTrigger value="image-recognition" className="gap-1.5">
              <Eye className="size-3.5" />
              Recognition
            </TabsTrigger>
            <TabsTrigger value="ai-data" className="gap-1.5">
              <MessageSquare className="size-3.5" />
              AI Data
            </TabsTrigger>
            <TabsTrigger value="screenshots" className="gap-1.5">
              <Image className="size-3.5" />
              Screenshots
            </TabsTrigger>
            <TabsTrigger value="ai-session" className="gap-1.5">
              <MessageSquare className="size-3.5" />
              AI Session
            </TabsTrigger>
            <TabsTrigger value="events" className="gap-1.5">
              <Activity className="size-3.5" />
              Events
            </TabsTrigger>
            <TabsTrigger value="api-requests" className="gap-1.5">
              <Globe className="size-3.5" />
              API Requests
            </TabsTrigger>
            <TabsTrigger value="mcp-calls" className="gap-1.5">
              <Wrench className="size-3.5" />
              MCP Calls
            </TabsTrigger>
            <TabsTrigger value="dom-snapshots" className="gap-1.5">
              <FileCode className="size-3.5" />
              Snapshots
            </TabsTrigger>
            <TabsTrigger value="configuration" className="gap-1.5">
              <Settings className="size-3.5" />
              Config
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab run={run} onRefresh={() => refetch()} />
          </TabsContent>
          <TabsContent value="verification">
            <VerificationTab runId={run.id} />
          </TabsContent>
          <TabsContent value="knowledge">
            <KnowledgeTab runId={run.id} />
          </TabsContent>
          <TabsContent value="tests">
            <TestsTab runId={run.id} />
          </TabsContent>
          <TabsContent value="output">
            <OutputTab runId={run.id} />
          </TabsContent>
          <TabsContent value="actions">
            <ActionsTab runId={run.id} />
          </TabsContent>
          <TabsContent value="timeline">
            <TimelineTab runId={run.id} />
          </TabsContent>
          <TabsContent value="context">
            <ContextTab runId={run.id} />
          </TabsContent>
          <TabsContent value="image-recognition">
            <ImageRecognitionTab runId={run.id} />
          </TabsContent>
          <TabsContent value="ai-data">
            <AiDataTab runId={run.id} />
          </TabsContent>
          <TabsContent value="screenshots">
            <ScreenshotsTab runId={run.id} />
          </TabsContent>
          <TabsContent value="ai-session">
            <AiSessionTab runId={run.id} />
          </TabsContent>
          <TabsContent value="events">
            <EventsTab runId={run.id} />
          </TabsContent>
          <TabsContent value="api-requests">
            <ApiRequestsTab runId={run.id} />
          </TabsContent>
          <TabsContent value="mcp-calls">
            <McpCallsTab runId={run.id} />
          </TabsContent>
          <TabsContent value="dom-snapshots">
            <DomSnapshotsTab runId={run.id} />
          </TabsContent>
          <TabsContent value="configuration">
            <ConfigurationTab runId={run.id} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
