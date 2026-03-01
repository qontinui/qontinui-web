"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Target,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileText,
  User,
} from "lucide-react";
import { runnerApi, type TaskRun } from "@/lib/runner-api";
import type { TaskRunView } from "@/lib/task-run-mappers";
import { toast } from "sonner";
import {
  formatDateTime,
  parseSummarySegments,
  SUMMARY_COLLAPSE_THRESHOLD,
  type SummaryTabRun,
} from "../_utils/summary-tab-utils";

// =============================================================================
// Helper Components
// =============================================================================

function UserMessageBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg p-3 border bg-blue-500/10 border-blue-500/30">
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-blue-500/20 text-blue-400">
        <User className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-blue-400">You</span>
        <p className="text-sm text-text-primary/90 leading-relaxed whitespace-pre-wrap mt-0.5">
          {content}
        </p>
      </div>
    </div>
  );
}

function SummaryContent({ text }: { text: string }) {
  const segments = useMemo(() => parseSummarySegments(text), [text]);

  if (segments.length === 1 && segments[0]!.type === "text") {
    return (
      <p className="text-sm text-text-primary/90 leading-relaxed whitespace-pre-wrap">
        {segments[0]!.content}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {segments.map((segment, index) =>
        segment.type === "user_message" ? (
          <UserMessageBubble key={index} content={segment.content} />
        ) : (
          <p
            key={index}
            className="text-sm text-text-primary/90 leading-relaxed whitespace-pre-wrap"
          >
            {segment.content}
          </p>
        )
      )}
    </div>
  );
}

// =============================================================================
// AiSummarySection
// =============================================================================

interface AiSummarySectionProps {
  run: SummaryTabRun;
  onRefresh?: () => void;
}

export function AiSummarySection({ run, onRefresh }: AiSummarySectionProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  // Safely access runner-specific fields that don't exist on TaskRunView
  const runnerRun = run as Partial<TaskRun>;
  const aiSummary =
    run.summary ||
    runnerRun.ai_summary ||
    ("output_summary" in run ? (run as TaskRunView).output_summary : null) ||
    "";
  const goalAchieved = run.goal_achieved;
  const remainingWork = run.remaining_work || null;

  const isFinished =
    run.status === "completed" ||
    run.status === "complete" ||
    run.status === "failed" ||
    run.status === "stopped";

  // Summary expand/collapse logic (matches runner's 300 char threshold)
  const { isLongSummary, displayText } = useMemo(() => {
    if (!aiSummary) return { isLongSummary: false, displayText: "" };
    const visibleText = aiSummary
      .replace(/\[USER_MESSAGE\]/g, "")
      .replace(/\[\/USER_MESSAGE\]/g, "");
    const isLong = visibleText.length > SUMMARY_COLLAPSE_THRESHOLD;
    if (!isLong || summaryExpanded) {
      return { isLongSummary: isLong, displayText: aiSummary };
    }
    if (aiSummary.includes("[USER_MESSAGE]")) {
      return { isLongSummary: true, displayText: aiSummary };
    }
    const truncated = aiSummary.slice(0, SUMMARY_COLLAPSE_THRESHOLD);
    const lastSpace = truncated.lastIndexOf(" ");
    return {
      isLongSummary: true,
      displayText:
        (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "...",
    };
  }, [aiSummary, summaryExpanded]);

  const handleGenerateSummary = async () => {
    setIsGeneratingSummary(true);
    try {
      await runnerApi.generateTaskRunSummary(run.id);
      toast.success("Summary generated");
      onRefresh?.();
    } catch {
      toast.error("Failed to generate summary");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  if (aiSummary) {
    return (
      <div className="rounded-xl border-2 border-brand-primary/30 bg-gradient-to-br from-brand-primary/5 to-brand-primary/10 p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-primary/20 rounded-lg">
              <Sparkles className="size-5 text-brand-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-lg text-text-primary">
                AI Summary
              </h2>
              {runnerRun.summary_generated_at && (
                <p className="text-xs text-text-muted">
                  Generated {formatDateTime(runnerRun.summary_generated_at)}
                </p>
              )}
            </div>
          </div>
          {/* Goal Achievement Badge */}
          {goalAchieved !== undefined && goalAchieved !== null && (
            <span
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-full ${
                goalAchieved
                  ? "bg-green-500/20 text-green-400"
                  : "bg-amber-500/20 text-amber-400"
              }`}
            >
              <Target className="size-4" />
              {goalAchieved ? "Goal Achieved" : "Goal Not Achieved"}
            </span>
          )}
        </div>

        {/* Summary Text with user message parsing */}
        <div className="space-y-2">
          <SummaryContent text={displayText} />
          {isLongSummary && (
            <button
              onClick={() => setSummaryExpanded(!summaryExpanded)}
              className="flex items-center gap-1 text-sm text-brand-primary hover:text-brand-primary/80 transition-colors"
            >
              {summaryExpanded ? (
                <>
                  <ChevronUp className="size-4" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="size-4" />
                  Show more
                </>
              )}
            </button>
          )}
        </div>

        {/* Remaining Work (if goal not achieved) - matches runner */}
        {remainingWork && !goalAchieved && (
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="size-4 text-amber-500" />
              <span className="font-medium text-amber-500">Remaining Work</span>
            </div>
            <p className="text-amber-300/90 whitespace-pre-wrap">
              {remainingWork}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (isGeneratingSummary) {
    return (
      <div className="rounded-xl border border-border-subtle/50 bg-surface-raised/20 p-5">
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="size-5 animate-spin" />
          <span>Generating AI summary...</span>
        </div>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="rounded-xl border border-border-subtle/50 bg-surface-raised/20 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-text-muted">
            <FileText className="size-5 opacity-50" />
            <span>No AI summary available for this run.</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateSummary}
            className="border-brand-primary/30 text-brand-primary hover:bg-brand-primary/10"
          >
            <Sparkles className="size-4 mr-1.5" />
            Generate Summary
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle/50 bg-surface-raised/20 p-5">
      <div className="flex items-center gap-3 text-text-muted">
        <FileText className="size-5 opacity-50" />
        <span>
          Run in progress. Summary will be available after completion.
        </span>
      </div>
    </div>
  );
}
