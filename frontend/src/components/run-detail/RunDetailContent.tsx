"use client";

import React, { useState, useEffect, lazy, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTaskRunDetail } from "@/hooks/useTaskRunData";
import { useTaskRun, runnerApi } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  RefreshCw,
  FileText,
  ShieldAlert,
  TestTube2,
  MessageSquare,
  Database,
  Info,
  Pencil,
  Loader2,
  AlertTriangle,
} from "lucide-react";

// Lazy-load tab components to prevent main thread blocking during initial load
const SummaryTab = lazy(() =>
  import("@/components/run-detail/SummaryTab").then((m) => ({
    default: m.SummaryTab,
  }))
);
const FindingsTab = lazy(() =>
  import("@/components/run-detail/FindingsTab").then((m) => ({
    default: m.FindingsTab,
  }))
);
const TestResultsTab = lazy(() =>
  import("@/components/run-detail/TestResultsTab").then((m) => ({
    default: m.TestResultsTab,
  }))
);
const AiConversationTab = lazy(() =>
  import("@/components/run-detail/AiConversationTab").then((m) => ({
    default: m.AiConversationTab,
  }))
);
const DataLogsTab = lazy(() =>
  import("@/components/run-detail/DataLogsTab").then((m) => ({
    default: m.DataLogsTab,
  }))
);
const ErrorMonitorTab = lazy(() =>
  import("@/components/run-detail/ErrorMonitorTab").then((m) => ({
    default: m.ErrorMonitorTab,
  }))
);

function TabFallback() {
  return (
    <div className="text-center py-12 text-text-muted">
      <Loader2 className="size-5 animate-spin mx-auto mb-2" />
      Loading...
    </div>
  );
}

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

const VALID_TABS = [
  "summary",
  "findings",
  "tests",
  "ai-conversation",
  "data-logs",
  "errors",
];

function RunDetailContentInner({ runId }: { runId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "summary";

  const {
    data: run,
    isLoading,
    error,
    isRunnerOffline,
    refetch,
  } = useTaskRunDetail(runId);

  // Keep runner-specific hook for SummaryTab which needs full TaskRun data
  // (loop_result, failure_info, output_log, summary_generated_at, etc.)
  const { data: runnerRun } = useTaskRun(runId);

  const [generatedWorkflowId, setGeneratedWorkflowId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (run?.status === "completed" && run.id) {
      runnerApi
        .getTaskRunResultData(run.id)
        .then((data) => {
          const wfId =
            (data.generated_workflow_id as string) ||
            (data.workflow_id as string) ||
            null;
          setGeneratedWorkflowId(wfId);
        })
        .catch(() => {});
    }
  }, [run?.status, run?.id]);

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <div className="text-center text-text-muted">
          <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
          <span data-content-role="status" data-content-label="loading state">
            Loading run details...
          </span>
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas">
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
              {error?.message ?? "The run you are looking for does not exist."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
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
          <div className="flex items-center gap-2">
            {generatedWorkflowId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  router.push(`/build/workflows?select=${generatedWorkflowId}`)
                }
                className="border-border-default gap-2"
              >
                <Pencil className="size-4" />
                Edit in Builder
              </Button>
            )}
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
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        {isRunnerOffline && (
          <div className="mb-4">
            <RunnerPartialState message="Runner offline — showing historical data. Live features (AI conversation, screenshots, logs) are unavailable." />
          </div>
        )}
        <Tabs defaultValue={initialTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="summary" className="gap-1.5">
              <FileText className="size-3.5" />
              Summary
            </TabsTrigger>
            <TabsTrigger value="findings" className="gap-1.5">
              <ShieldAlert className="size-3.5" />
              Findings
            </TabsTrigger>
            <TabsTrigger value="tests" className="gap-1.5">
              <TestTube2 className="size-3.5" />
              Test Results
            </TabsTrigger>
            <TabsTrigger value="ai-conversation" className="gap-1.5">
              <MessageSquare className="size-3.5" />
              AI Conversation
            </TabsTrigger>
            <TabsTrigger value="data-logs" className="gap-1.5">
              <Database className="size-3.5" />
              Data & Logs
            </TabsTrigger>
            <TabsTrigger value="errors" className="gap-1.5">
              <AlertTriangle className="size-3.5" />
              Errors
            </TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <Suspense fallback={<TabFallback />}>
              <SummaryTab run={runnerRun ?? run} onRefresh={() => refetch()} />
            </Suspense>
          </TabsContent>
          <TabsContent value="findings">
            <Suspense fallback={<TabFallback />}>
              <FindingsTab runId={run.id} />
            </Suspense>
          </TabsContent>
          <TabsContent value="tests">
            <Suspense fallback={<TabFallback />}>
              <TestResultsTab
                runId={run.id}
                loopResult={runnerRun?.loop_result ?? null}
              />
            </Suspense>
          </TabsContent>
          <TabsContent value="ai-conversation">
            <Suspense fallback={<TabFallback />}>
              <AiConversationTab runId={run.id} />
            </Suspense>
          </TabsContent>
          <TabsContent value="data-logs">
            <Suspense fallback={<TabFallback />}>
              <DataLogsTab runId={run.id} />
            </Suspense>
          </TabsContent>
          <TabsContent value="errors">
            <Suspense fallback={<TabFallback />}>
              <ErrorMonitorTab taskRunId={run.id} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export function RunDetailContent({ runId }: { runId: string }) {
  return (
    <Suspense fallback={null}>
      <RunDetailContentInner runId={runId} />
    </Suspense>
  );
}
