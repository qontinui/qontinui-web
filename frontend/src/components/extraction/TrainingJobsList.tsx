"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  Play,
  X,
  Trash2,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  ChevronRight,
  Download,
} from "lucide-react";
import {
  listTrainingJobs,
  startTrainingJob,
  cancelTrainingJob,
  deleteTrainingJob,
  getStatusDisplay,
  type TrainingJob,
  type TrainingJobStatus,
} from "@/lib/api/training";

interface TrainingJobsListProps {
  projectId?: string;
  onViewDetails?: (jobId: string) => void;
  refreshInterval?: number;
}

function StatusBadge({ status }: { status: TrainingJobStatus }) {
  const { color, text, bgColor } = getStatusDisplay(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${bgColor} ${color}`}
    >
      {status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
      {status === "completed" && <CheckCircle className="w-3 h-3" />}
      {status === "failed" && <XCircle className="w-3 h-3" />}
      {status === "pending" && <Clock className="w-3 h-3" />}
      {status === "queued" && <Clock className="w-3 h-3" />}
      {status === "cancelled" && <XCircle className="w-3 h-3" />}
      {text}
    </span>
  );
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(
  startedAt: string | null,
  completedAt: string | null
): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt);
  const end = completedAt ? new Date(completedAt) : new Date();
  const durationMs = end.getTime() - start.getTime();
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function TrainingJobsList({
  projectId,
  onViewDetails,
  refreshInterval = 10000,
}: TrainingJobsListProps) {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await listTrainingJobs({ project_id: projectId });
      setJobs(response.jobs);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load training jobs"
      );
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh for running jobs
  useEffect(() => {
    const hasRunningJobs = jobs.some(
      (job) => job.status === "running" || job.status === "queued"
    );

    if (hasRunningJobs && refreshInterval > 0) {
      const interval = setInterval(fetchJobs, refreshInterval);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [jobs, refreshInterval, fetchJobs]);

  const handleStart = async (jobId: string) => {
    setActionLoading(jobId);
    try {
      await startTrainingJob(jobId);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start job");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (jobId: string) => {
    setActionLoading(jobId);
    try {
      await cancelTrainingJob(jobId);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel job");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm("Are you sure you want to delete this training job?")) {
      return;
    }
    setActionLoading(jobId);
    try {
      await deleteTrainingJob(jobId);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete job");
    } finally {
      setActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
        <p className="text-text-muted mb-4">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setIsLoading(true);
            setError(null);
            fetchJobs();
          }}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-surface-raised flex items-center justify-center mb-4">
          <Clock className="w-6 h-6 text-text-muted" />
        </div>
        <p className="text-text-muted">No training jobs yet</p>
        <p className="text-sm text-text-subtle mt-1">
          Create a training job to start training your model
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Training Jobs</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchJobs}
          disabled={isLoading}
          className="text-text-muted hover:text-white"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-md">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {/* Jobs list */}
      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="p-4 bg-surface-raised rounded-lg border border-border-subtle hover:border-border-default transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              {/* Job info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium truncate">
                    {job.name || `Job ${job.id.slice(0, 8)}`}
                  </span>
                  <StatusBadge status={job.status as TrainingJobStatus} />
                </div>

                <div className="flex items-center gap-4 text-sm text-text-muted">
                  <span>{job.config.model_type}</span>
                  <span>{job.config.epochs} epochs</span>
                  <span>Created {formatDate(job.created_at)}</span>
                </div>

                {/* Progress bar for running jobs */}
                {job.status === "running" && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                      <span>
                        Epoch {job.current_epoch || 0}/
                        {job.total_epochs || job.config.epochs}
                      </span>
                      <span>{job.progress}%</span>
                    </div>
                    <div className="h-1.5 bg-surface-canvas rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-primary transition-all duration-300"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Duration for completed jobs */}
                {(job.status === "completed" || job.status === "failed") &&
                  job.started_at && (
                    <div className="mt-2 text-sm text-text-muted">
                      Duration:{" "}
                      {formatDuration(job.started_at, job.completed_at)}
                    </div>
                  )}

                {/* Error message for failed jobs */}
                {job.status === "failed" && job.error && (
                  <div className="mt-2 text-sm text-red-400">
                    Error: {job.error}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Start button for pending jobs */}
                {job.status === "pending" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStart(job.id)}
                    disabled={actionLoading === job.id}
                    className="border-green-500/50 text-green-400 hover:bg-green-500/10"
                  >
                    {actionLoading === job.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    Start
                  </Button>
                )}

                {/* Cancel button for running/queued jobs */}
                {(job.status === "running" || job.status === "queued") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCancel(job.id)}
                    disabled={actionLoading === job.id}
                    className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
                  >
                    {actionLoading === job.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                    Cancel
                  </Button>
                )}

                {/* Download button for completed jobs */}
                {job.status === "completed" && job.model_url && (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="border-brand-primary/50 text-brand-primary hover:bg-brand-primary/10"
                  >
                    <a
                      href={job.model_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="w-4 h-4" />
                      Model
                    </a>
                  </Button>
                )}

                {/* View details button */}
                {onViewDetails && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewDetails(job.id)}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                )}

                {/* Delete button (not for running jobs) */}
                {job.status !== "running" && job.status !== "queued" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(job.id)}
                    disabled={actionLoading === job.id}
                    className="text-text-muted hover:text-red-400"
                  >
                    {actionLoading === job.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
