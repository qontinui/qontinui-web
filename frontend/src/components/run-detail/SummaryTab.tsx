"use client";

import { lazy, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  XCircle,
  Clock,
  Loader2,
  ShieldCheck,
  BookOpen,
  Brain,
} from "lucide-react";
import { type TaskRun } from "@/lib/runner-api";
import type { TaskRunView } from "@/lib/task-run-mappers";
import type { SummaryTabProps } from "./_utils/summary-tab-utils";
import { AiSummarySection } from "./_components/AiSummarySection";
import { StatusBanner } from "./_components/StatusBanner";
import { FailureSection } from "./_components/FailureSection";
import { VerificationSubTab } from "./_components/VerificationSubTab";
import { KnowledgeSubTab } from "./_components/KnowledgeSubTab";

const TimelineTab = lazy(() =>
  import("@/components/run-detail/TimelineTab").then((m) => ({
    default: m.TimelineTab,
  }))
);
const ContextTab = lazy(() =>
  import("@/components/run-detail/ContextTab").then((m) => ({
    default: m.ContextTab,
  }))
);

// =============================================================================
// SummaryTab (thin orchestrator - no useState hooks)
// =============================================================================

export function SummaryTab({ run, onRefresh }: SummaryTabProps) {
  // Safely access runner-specific fields
  const runnerRun = run as Partial<TaskRun>;
  const isFailed = run.status === "failed";
  const failureInfo = runnerRun.failure_info || null;

  return (
    <div className="space-y-4">
      {/* 1. AI Summary Section */}
      <AiSummarySection run={run} onRefresh={onRefresh} />

      {/* 2. Status & Stats Banner */}
      <StatusBanner run={run} onRefresh={onRefresh} />

      {/* 3. Failure Section */}
      {isFailed && failureInfo && <FailureSection failure={failureInfo} />}
      {isFailed && !failureInfo && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <XCircle className="size-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-red-500">Run Failed</h3>
              <p className="text-sm text-red-400 mt-1">
                {run.summary ||
                  runnerRun.ai_summary ||
                  ("error_message" in run
                    ? (run as TaskRunView).error_message
                    : null) ||
                  "Run failed. Check the output log for details."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4. Nested Sub-tabs: Timeline, Verification, Knowledge, Context */}
      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline" className="gap-1.5">
            <Clock className="size-3.5" /> Timeline
          </TabsTrigger>
          <TabsTrigger value="verification" className="gap-1.5">
            <ShieldCheck className="size-3.5" /> Verification
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-1.5">
            <Brain className="size-3.5" /> Knowledge
          </TabsTrigger>
          <TabsTrigger value="context" className="gap-1.5">
            <BookOpen className="size-3.5" /> Context
          </TabsTrigger>
        </TabsList>
        <TabsContent value="timeline" className="mt-4">
          <Suspense
            fallback={
              <div className="text-center py-8 text-text-muted">
                <Loader2 className="size-4 animate-spin mx-auto mb-2" />
                Loading...
              </div>
            }
          >
            <TimelineTab runId={run.id} />
          </Suspense>
        </TabsContent>
        <TabsContent value="verification" className="mt-4">
          <VerificationSubTab runId={run.id} />
        </TabsContent>
        <TabsContent value="knowledge" className="mt-4">
          <KnowledgeSubTab runId={run.id} />
        </TabsContent>
        <TabsContent value="context" className="mt-4">
          <Suspense
            fallback={
              <div className="text-center py-8 text-text-muted">
                <Loader2 className="size-4 animate-spin mx-auto mb-2" />
                Loading...
              </div>
            }
          >
            <ContextTab runId={run.id} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
