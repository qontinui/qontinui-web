"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { runnerFetch } from "@/lib/runner/api-client";
import { useRunnerEvent } from "@/contexts/RunnerEventContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquareWarning,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  X,
} from "lucide-react";

interface DeferredQuestion {
  id: string;
  iteration: number;
  question: string;
  confidence: number;
  risk_level: string;
  status: string;
  auto_decision_type: string;
}

interface DeferredQuestionsFloatingPanelProps {
  runId: string;
}

/**
 * Floating panel shown during active workflow execution.
 * Displays pending deferred questions with inline approve/reject actions.
 * Subscribes to real-time WebSocket events for live updates.
 */
export function DeferredQuestionsFloatingPanel({
  runId,
}: DeferredQuestionsFloatingPanelProps) {
  const [questions, setQuestions] = useState<DeferredQuestion[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const fetchRef = useRef(false);

  const fetchQuestions = useCallback(async () => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    try {
      const data = await runnerFetch<DeferredQuestion[]>(
        `/task-runs/${runId}/deferred-questions`
      );
      setQuestions(data);
    } catch {
      // Runner may not have questions yet — silently ignore
    } finally {
      fetchRef.current = false;
    }
  }, [runId]);

  // Initial fetch
  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  // Subscribe to real-time question events
  useRunnerEvent(
    "deferred-question-created",
    useCallback(
      (payload: unknown) => {
        const msg = payload as Record<string, unknown> | null;
        if (!msg) return;
        const data = (msg.data ?? msg) as Record<string, unknown>;
        const taskRunId = data.task_run_id as string | undefined;
        if (taskRunId && taskRunId === runId) {
          // Show toast notification
          const question = (data.question as string) || "New decision pending";
          const risk = (data.risk_level as string) || "low";
          const confidence = (data.confidence as number) || 0;
          toast.info(
            `Decision needed (${risk} risk, ${Math.round(confidence * 100)}% confidence)`,
            {
              description: question.slice(0, 120),
              duration: 8000,
            }
          );
          // Refresh list
          fetchQuestions();
          setDismissed(false);
        }
      },
      [runId, fetchQuestions]
    )
  );

  useRunnerEvent(
    "deferred-question-reviewed",
    useCallback(
      (payload: unknown) => {
        const msg = payload as Record<string, unknown> | null;
        if (!msg) return;
        const data = (msg.data ?? msg) as Record<string, unknown>;
        if (data.task_run_id === runId) {
          fetchQuestions();
        }
      },
      [runId, fetchQuestions]
    )
  );

  const handleReview = async (
    questionId: string,
    status: "approved" | "rejected"
  ) => {
    setReviewingId(questionId);
    try {
      const comment =
        status === "rejected" ? prompt("Why was this wrong?") : undefined;
      if (status === "rejected" && comment === null) {
        setReviewingId(null);
        return;
      }
      await runnerFetch(
        `/task-runs/${runId}/deferred-questions/${questionId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, comment: comment || undefined }),
        }
      );
      toast.success(status === "approved" ? "Approved" : "Rejected — rework triggered");
      fetchQuestions();
    } catch {
      toast.error("Review failed");
    } finally {
      setReviewingId(null);
    }
  };

  const pending = questions.filter((q) => q.status === "pending");

  // Don't render if no pending questions or dismissed
  if (pending.length === 0 || dismissed) return null;

  const riskColor = (level: string) => {
    switch (level) {
      case "irreversible":
      case "high":
        return "destructive" as const;
      case "medium":
        return "default" as const;
      default:
        return "secondary" as const;
    }
  };

  return (
    <div className="fixed bottom-20 right-4 z-50 w-80 rounded-lg shadow-xl border border-border-default bg-surface-raised/95 backdrop-blur-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-text-primary hover:text-text-secondary transition-colors"
        >
          <MessageSquareWarning className="size-4 text-amber-400" />
          <span>
            {pending.length} pending decision{pending.length !== 1 ? "s" : ""}
          </span>
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronUp className="size-3.5" />
          )}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="p-0.5 rounded hover:bg-surface-base text-text-muted"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Question list */}
      {expanded && (
        <div className="max-h-64 overflow-y-auto divide-y divide-border-subtle">
          {pending.map((q) => (
            <div key={q.id} className="px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-muted">
                  Iter {q.iteration}
                </span>
                <Badge
                  variant={riskColor(q.risk_level)}
                  className="text-[10px] px-1 py-0"
                >
                  {q.risk_level}
                </Badge>
                <span className="text-[10px] text-text-muted">
                  {Math.round(q.confidence * 100)}%
                </span>
              </div>
              <p className="text-xs text-text-secondary line-clamp-2">
                {q.question}
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2"
                  disabled={reviewingId === q.id}
                  onClick={() => handleReview(q.id, "approved")}
                >
                  <CheckCircle2 className="size-3 mr-0.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 text-[10px] px-2"
                  disabled={reviewingId === q.id}
                  onClick={() => handleReview(q.id, "rejected")}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
