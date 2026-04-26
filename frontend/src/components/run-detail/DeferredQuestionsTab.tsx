"use client";

import { useCallback, useEffect, useState } from "react";
import { runnerFetch } from "@/lib/runner/api-client";
import { httpClient } from "@/services/service-factory";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  MessageSquareWarning,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface DeferredQuestion {
  id: string;
  task_run_id: string;
  iteration: number;
  question: string;
  context_json: string;
  auto_decision_type: string;
  auto_decision_detail: string | null;
  confidence: number;
  risk_level: string;
  status: string;
  git_checkpoint: string | null;
  contingent_iterations: string;
  reviewer_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
}

interface DeferredQuestionsTabProps {
  taskRunId: string;
}

export function DeferredQuestionsTab({ taskRunId }: DeferredQuestionsTabProps) {
  const [questions, setQuestions] = useState<DeferredQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchQuestions = useCallback(async () => {
    try {
      // Try runner first (live data), fall back to backend (synced data)
      let data: DeferredQuestion[];
      try {
        data = await runnerFetch<DeferredQuestion[]>(
          `/task-runs/${taskRunId}/deferred-questions`
        );
      } catch {
        // Runner offline — fetch from backend
        data = await httpClient.get<DeferredQuestion[]>(
          `/api/v1/task-runs/${taskRunId}/deferred-questions`
        );
      }
      setQuestions(data);
    } catch (err) {
      console.error("Failed to fetch deferred questions:", err);
    } finally {
      setLoading(false);
    }
  }, [taskRunId]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const handleReview = async (
    questionId: string,
    status: "approved" | "rejected",
    comment?: string
  ) => {
    setReviewingId(questionId);
    try {
      const result = await runnerFetch<{
        reviewed: boolean;
        rework_task_run_id?: string;
      }>(`/task-runs/${taskRunId}/deferred-questions/${questionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, comment }),
      });
      toast.success(
        status === "approved"
          ? "Decision approved"
          : `Decision rejected${result.rework_task_run_id ? " — rework triggered" : ""}`
      );
      fetchQuestions();
    } catch (err) {
      toast.error("Failed to submit review");
      console.error(err);
    } finally {
      setReviewingId(null);
    }
  };

  const handleBulkApprove = async () => {
    const pendingIds = questions
      .filter((q) => q.status === "pending")
      .map((q) => q.id);
    if (pendingIds.length === 0) return;

    try {
      await runnerFetch(
        `/task-runs/${taskRunId}/deferred-questions/bulk-review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_ids: pendingIds,
            status: "approved",
          }),
        }
      );
      toast.success(`Approved ${pendingIds.length} decision(s)`);
      fetchQuestions();
    } catch {
      toast.error("Bulk approve failed");
    }
  };

  const pending = questions.filter((q) => q.status === "pending");
  const approved = questions.filter((q) => q.status === "approved");
  const rejected = questions.filter((q) => q.status === "rejected");

  const riskColor = (level: string) => {
    switch (level) {
      case "irreversible":
        return "destructive";
      case "high":
        return "destructive";
      case "medium":
        return "default";
      default:
        return "secondary";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        Loading deferred questions...
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted gap-2">
        <CheckCircle2 className="h-8 w-8 opacity-40" />
        <p>No deferred questions for this run</p>
        <p className="text-xs">
          Questions appear when the system makes autonomous decisions with low
          confidence
        </p>
      </div>
    );
  }

  const renderQuestion = (q: DeferredQuestion) => {
    const isExpanded = expandedId === q.id;
    const isPending = q.status === "pending";
    const isReviewing = reviewingId === q.id;
    let context: Record<string, unknown> = {};
    try {
      context = JSON.parse(q.context_json || "{}");
    } catch {}

    return (
      <div
        key={q.id}
        className="border rounded-lg p-4 bg-surface-base hover:bg-surface-raised transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={() => setExpandedId(isExpanded ? null : q.id)}
                className="p-0.5 hover:bg-surface-raised rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <span className="text-sm font-medium">
                Iteration {q.iteration}
              </span>
              <Badge variant={riskColor(q.risk_level)} className="text-xs">
                {q.risk_level}
              </Badge>
              <span className="text-xs text-text-muted">
                {Math.round(q.confidence * 100)}% confidence
              </span>
            </div>
            <p className="text-sm text-text-secondary ml-7 line-clamp-2">
              {q.question}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isPending ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReview(q.id, "approved")}
                  disabled={isReviewing || rejectingId === q.id}
                  className="text-xs"
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setRejectingId(q.id);
                    setRejectReason("");
                  }}
                  disabled={isReviewing || rejectingId === q.id}
                  className="text-xs"
                >
                  Reject
                </Button>
              </>
            ) : (
              <Badge
                variant={q.status === "approved" ? "secondary" : "destructive"}
                className="text-xs"
              >
                {q.status}
              </Badge>
            )}
          </div>
        </div>

        {rejectingId === q.id && (
          <div className="mt-3 ml-7 space-y-2">
            <textarea
              className="w-full text-sm rounded border border-border-default bg-surface-base px-2 py-1.5 resize-none text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-border-focus"
              rows={3}
              placeholder="Why was this decision wrong? (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="destructive"
                className="text-xs"
                disabled={isReviewing}
                onClick={() => {
                  handleReview(q.id, "rejected", rejectReason || undefined);
                  setRejectingId(null);
                  setRejectReason("");
                }}
              >
                Confirm Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  setRejectingId(null);
                  setRejectReason("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isExpanded && (
          <div className="mt-3 ml-7 space-y-2 text-sm">
            <div>
              <span className="font-medium">Auto-decision:</span>{" "}
              <span className="text-text-secondary">
                {q.auto_decision_type === "proceeded"
                  ? "Continued as planned"
                  : q.auto_decision_detail || q.auto_decision_type}
              </span>
            </div>
            {typeof context.summary === "string" && (
              <div>
                <span className="font-medium">Summary:</span>{" "}
                <span className="text-text-secondary">{context.summary}</span>
              </div>
            )}
            {Array.isArray(context.files_modified) &&
              context.files_modified.length > 0 && (
                <div>
                  <span className="font-medium">Files modified:</span>
                  <ul className="list-disc ml-4 text-text-muted text-xs">
                    {(context.files_modified as string[]).map((f: string) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            {q.reviewer_comment && (
              <div>
                <span className="font-medium">Review comment:</span>{" "}
                <span className="text-text-secondary">
                  {q.reviewer_comment}
                </span>
              </div>
            )}
            {q.git_checkpoint && (
              <div className="text-xs text-text-muted">
                Git checkpoint: <code>{q.git_checkpoint.slice(0, 8)}</code>
              </div>
            )}
            <div className="text-xs text-text-muted">
              Created: {new Date(q.created_at).toLocaleString()}
              {q.reviewed_at &&
                ` · Reviewed: ${new Date(q.reviewed_at).toLocaleString()}`}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">Deferred Questions</h3>
          <div className="flex gap-2">
            {pending.length > 0 && (
              <Badge variant="default" className="text-xs">
                {pending.length} pending
              </Badge>
            )}
            {approved.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {approved.length} approved
              </Badge>
            )}
            {rejected.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                {rejected.length} rejected
              </Badge>
            )}
          </div>
        </div>
        {pending.length > 1 && (
          <Button size="sm" variant="outline" onClick={handleBulkApprove}>
            Approve all ({pending.length})
          </Button>
        )}
      </div>

      {/* Question groups */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-muted flex items-center gap-1.5">
            <MessageSquareWarning className="h-3.5 w-3.5" />
            Pending Review
          </h4>
          {pending.map(renderQuestion)}
        </div>
      )}

      {rejected.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-muted flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5" />
            Rejected
          </h4>
          {rejected.map(renderQuestion)}
        </div>
      )}

      {approved.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-muted flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approved
          </h4>
          {approved.map(renderQuestion)}
        </div>
      )}
    </div>
  );
}
