"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import { recordingService } from "@/services/service-factory";
import {
  RecordingStatusLabels,
  ProcessingPhaseLabels,
} from "@/types/recording";
import type {
  ProcessingJobStatus,
  ProcessingLogEntry,
  ProcessingPhase,
} from "@/types/recording";
import { formatDistanceToNow } from "date-fns";

interface ProcessingMonitorProps {
  recordingId: string;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export function ProcessingMonitor({
  recordingId,
  onComplete,
  onError,
}: ProcessingMonitorProps) {
  const [status, setStatus] = useState<ProcessingJobStatus | null>(null);
  const [logs, setLogs] = useState<ProcessingLogEntry[]>([]);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!polling) return;

    const poll = async () => {
      try {
        const jobStatus =
          await recordingService.getProcessingStatus(recordingId);
        setStatus(jobStatus);

        // Fetch logs
        const logEntries =
          await recordingService.getProcessingLogs(recordingId);
        setLogs(logEntries as ProcessingLogEntry[]);

        // Check if completed or failed
        if (jobStatus.status === "completed") {
          setPolling(false);
          onComplete?.();
        } else if (jobStatus.status === "failed") {
          setPolling(false);
          onError?.(jobStatus.error || "Processing failed");
        }
      } catch (error: unknown) {
        console.error("Failed to fetch processing status:", error);
      }
    };

    // Initial poll
    poll();

    // Set up polling interval (every 2 seconds)
    const interval = setInterval(poll, 2000);

    return () => clearInterval(interval);
  }, [recordingId, polling, onComplete, onError]);

  const getPhaseIcon = (phase: ProcessingPhase) => {
    if (!status) return <Clock className="h-5 w-5 text-text-muted" />;

    const currentPhaseIndex = Object.keys(ProcessingPhaseLabels).indexOf(
      status.phase || ""
    );
    const thisPhaseIndex = Object.keys(ProcessingPhaseLabels).indexOf(phase);

    if (currentPhaseIndex > thisPhaseIndex) {
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    } else if (currentPhaseIndex === thisPhaseIndex) {
      return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
    } else {
      return <Clock className="h-5 w-5 text-text-muted" />;
    }
  };

  const getPhaseStatus = (
    phase: ProcessingPhase
  ): "completed" | "active" | "pending" => {
    if (!status || !status.phase) return "pending";

    const currentPhaseIndex = Object.keys(ProcessingPhaseLabels).indexOf(
      status.phase
    );
    const thisPhaseIndex = Object.keys(ProcessingPhaseLabels).indexOf(phase);

    if (currentPhaseIndex > thisPhaseIndex) return "completed";
    if (currentPhaseIndex === thisPhaseIndex) return "active";
    return "pending";
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-600 dark:text-red-400";
      case "warning":
        return "text-yellow-600 dark:text-yellow-400";
      case "info":
      default:
        return "text-text-muted";
    }
  };

  const getLogLevelIcon = (level: string) => {
    switch (level) {
      case "error":
        return <XCircle className="h-4 w-4" />;
      case "warning":
        return <AlertCircle className="h-4 w-4" />;
      case "info":
      default:
        return <CheckCircle className="h-4 w-4" />;
    }
  };

  if (!status) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading processing status...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Progress */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Processing Status</CardTitle>
              <CardDescription>
                {status.status === "completed"
                  ? "Processing completed successfully"
                  : status.status === "failed"
                    ? "Processing failed"
                    : "Automated state discovery in progress..."}
              </CardDescription>
            </div>
            <Badge
              className={
                status.status === "completed"
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                  : status.status === "failed"
                    ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
              }
            >
              {RecordingStatusLabels[status.status]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {status.phase
                  ? ProcessingPhaseLabels[status.phase]
                  : "Initializing..."}
              </span>
              <span className="font-medium">
                {Math.round(status.progress * 100)}%
              </span>
            </div>
            <Progress value={status.progress * 100} />
          </div>

          {/* Estimated Completion */}
          {status.estimated_completion && status.status === "processing" && (
            <p className="text-sm text-muted-foreground">
              Estimated completion:{" "}
              {formatDistanceToNow(new Date(status.estimated_completion), {
                addSuffix: true,
              })}
            </p>
          )}

          {/* Error Message */}
          {status.error && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-red-900 dark:text-red-100">
                    Processing Error
                  </h4>
                  <p className="text-sm text-red-800 dark:text-red-200 mt-1">
                    {status.error}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Processing Phases */}
      <Card>
        <CardHeader>
          <CardTitle>Processing Phases</CardTitle>
          <CardDescription>
            The automated discovery process consists of 5 phases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {(Object.keys(ProcessingPhaseLabels) as ProcessingPhase[]).map(
              (phase, index) => {
                const phaseStatus = getPhaseStatus(phase);
                return (
                  <div
                    key={phase}
                    className={`flex items-start space-x-3 p-3 rounded-lg ${
                      phaseStatus === "active"
                        ? "bg-blue-50 dark:bg-blue-950"
                        : phaseStatus === "completed"
                          ? "bg-green-50 dark:bg-green-950"
                          : "bg-muted dark:bg-surface-raised"
                    }`}
                  >
                    {getPhaseIcon(phase)}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">
                          {index + 1}. {ProcessingPhaseLabels[phase]}
                        </h4>
                        {phaseStatus === "completed" && (
                          <Badge variant="outline" className="text-green-600">
                            Complete
                          </Badge>
                        )}
                        {phaseStatus === "active" && (
                          <Badge variant="outline" className="text-blue-600">
                            In Progress
                          </Badge>
                        )}
                      </div>
                      {phaseStatus === "active" && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {getPhaseDescription(phase)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </CardContent>
      </Card>

      {/* Processing Logs */}
      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Processing Logs</CardTitle>
            <CardDescription>
              Detailed log entries from the processing pipeline
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] w-full rounded-md border p-4">
              <div className="space-y-2">
                {logs.map((log, index) => (
                  <div
                    key={index}
                    className={`flex items-start space-x-2 text-sm ${getLogLevelColor(
                      log.level
                    )}`}
                  >
                    {getLogLevelIcon(log.level)}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{log.message}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {log.data && (
                        <pre className="text-xs mt-1 text-muted-foreground overflow-x-auto">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function getPhaseDescription(phase: ProcessingPhase): string {
  switch (phase) {
    case "frame_analysis":
      return "Computing perceptual hashes and clustering similar frames...";
    case "state_identification":
      return "Identifying states from frame clusters and extracting visual elements...";
    case "interaction_processing":
      return "Processing mouse and keyboard interactions...";
    case "transition_discovery":
      return "Discovering transitions between states and generating workflows...";
    case "state_machine_assembly":
      return "Assembling complete state machine structure...";
    case "optimization":
      return "Optimizing and validating discovered structures...";
    case "completed":
      return "Processing complete";
  }
}
