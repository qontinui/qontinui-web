"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Brain,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  PlayCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { runnerApi } from "@/lib/runner-api";
import { toast } from "sonner";

interface OverviewTabProps {
  run: {
    id: string;
    task_name: string;
    status: string;
    created_at: string;
    completed_at?: string;
    duration_seconds?: number;
    summary?: string;
    ai_summary?: string;
    workflow_name?: string;
    iteration_count?: number;
    phase?: string;
    sessions_count?: number;
    max_sessions?: number;
    auto_continue?: boolean;
    task_type?: string;
    workflow_type?: string;
  };
  onRefresh?: () => void;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
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

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-5 text-green-500" />;
    case "failed":
      return <XCircle className="size-5 text-red-500" />;
    case "running":
      return <PlayCircle className="size-5 text-blue-500 animate-pulse" />;
    default:
      return <Clock className="size-5 text-text-muted" />;
  }
}

export function OverviewTab({ run, onRefresh }: OverviewTabProps) {
  const [additionalSessions, setAdditionalSessions] = useState(3);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  const handleContinue = async () => {
    setIsContinuing(true);
    try {
      await runnerApi.continueTaskRun(run.id, {
        additional_sessions: additionalSessions,
      });
      toast.success("Run continued");
      onRefresh?.();
    } catch {
      toast.error("Failed to continue run");
    } finally {
      setIsContinuing(false);
    }
  };

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

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(run.status)}
              <div>
                <div className="font-semibold text-text-primary">
                  {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                </div>
                <div className="text-xs text-text-muted">
                  {run.phase && <span>Phase: {run.phase}</span>}
                  {run.iteration_count != null && (
                    <span className="ml-2">
                      {run.phase ? "- " : ""}
                      {run.iteration_count} iterations
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {run.workflow_type && (
                <Badge variant="outline">
                  {run.workflow_type.toUpperCase()}
                </Badge>
              )}
              <Badge variant="outline">
                {formatDuration(run.duration_seconds)}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Stats */}
      {(run.sessions_count != null || run.auto_continue != null) && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardContent className="py-4">
            <div className="flex items-center gap-6 text-sm">
              {run.sessions_count != null && (
                <div>
                  <span className="text-text-muted">Sessions: </span>
                  <span className="font-medium text-text-primary">
                    {run.sessions_count}
                    {run.max_sessions ? ` / ${run.max_sessions}` : ""}
                  </span>
                </div>
              )}
              {run.auto_continue != null && (
                <Badge variant={run.auto_continue ? "success" : "secondary"}>
                  Auto-continue: {run.auto_continue ? "On" : "Off"}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardContent className="pt-6">
            <div className="text-sm text-text-muted mb-1">Duration</div>
            <div className="text-lg font-semibold text-text-primary">
              {formatDuration(run.duration_seconds)}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardContent className="pt-6">
            <div className="text-sm text-text-muted mb-1">Iterations</div>
            <div className="text-lg font-semibold text-text-primary">
              {run.iteration_count ?? "-"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardContent className="pt-6">
            <div className="text-sm text-text-muted mb-1">Started</div>
            <div className="text-sm font-medium text-text-primary">
              {formatDateTime(run.created_at)}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardContent className="pt-6">
            <div className="text-sm text-text-muted mb-1">Completed</div>
            <div className="text-sm font-medium text-text-primary">
              {run.completed_at ? formatDateTime(run.completed_at) : "-"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-text-muted">Task Name</dt>
              <dd className="font-medium text-text-primary mt-0.5">
                {run.task_name}
              </dd>
            </div>
            {run.workflow_name && (
              <div>
                <dt className="text-text-muted">Workflow</dt>
                <dd className="font-medium text-text-primary mt-0.5">
                  {run.workflow_name}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* AI Summary */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="size-4" />
              AI Summary
            </CardTitle>
            {!run.summary && !run.ai_summary && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateSummary}
                disabled={isGeneratingSummary}
              >
                {isGeneratingSummary ? (
                  <Loader2 className="size-4 animate-spin mr-1" />
                ) : (
                  <Brain className="size-4 mr-1" />
                )}
                Generate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {run.summary || run.ai_summary ? (
            <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
              {run.summary || run.ai_summary}
            </p>
          ) : (
            <p className="text-sm text-text-muted">
              No summary available. Click Generate to create one.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Failure Section */}
      {run.status === "failed" && (
        <Card className="bg-red-950/20 border-red-500/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-400">
              <AlertTriangle className="size-4" />
              Failure Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-300">
              {run.summary ||
                run.ai_summary ||
                "Run failed. Check the output log for details."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Continue Run */}
      {(run.status === "completed" ||
        run.status === "stopped" ||
        run.status === "failed") && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowRight className="size-4" />
              Continue Run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-muted">
                  Additional sessions:
                </span>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={additionalSessions}
                  onChange={(e) =>
                    setAdditionalSessions(
                      Math.max(1, parseInt(e.target.value) || 1)
                    )
                  }
                  className="w-20 bg-surface-canvas/50 border-border-subtle/50"
                />
              </div>
              <Button
                onClick={handleContinue}
                disabled={isContinuing}
                variant="brand-primary"
              >
                {isContinuing ? (
                  <Loader2 className="size-4 animate-spin mr-1" />
                ) : (
                  <PlayCircle className="size-4 mr-1" />
                )}
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
