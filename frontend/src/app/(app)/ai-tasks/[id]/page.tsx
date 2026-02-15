"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireProject } from "@/components/require-project";
import {
  ArrowLeft,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  AlertTriangle,
  Bug,
  Lightbulb,
  RefreshCw,
  Terminal,
  FileText,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
} from "lucide-react";
import { format } from "date-fns";
import {
  useBackendTaskRun,
  useUpdateBackendFindingStatus,
} from "@/hooks/useTaskRunsBackend";
import VerificationResultsTab from "./VerificationResultsTab";
import type {
  TaskRunSession,
  TaskRunFinding,
  TaskRunFindingStatus,
  TaskRunStatus,
} from "@/types/task-runs";

export default function AITaskDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const taskId = params.id as string;
  const projectId = searchParams.get("project");

  const { data: task, isLoading, error, refetch } = useBackendTaskRun(taskId);
  const updateFinding = useUpdateBackendFindingStatus();

  const [activeTab, setActiveTab] = useState("sessions");
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set()
  );
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const toggleSessionExpand = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  };

  const toggleFindingExpand = (findingId: string) => {
    setExpandedFindings((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(findingId)) {
        newSet.delete(findingId);
      } else {
        newSet.add(findingId);
      }
      return newSet;
    });
  };

  const handleFindingStatusChange = async (
    findingId: string,
    newStatus: string
  ) => {
    try {
      await updateFinding.mutateAsync({
        taskId,
        findingId,
        data: { status: newStatus as TaskRunFindingStatus },
      });
    } catch (error) {
      console.error("Failed to update finding status:", error);
    }
  };

  const getStatusIcon = (status: TaskRunStatus) => {
    switch (status) {
      case "complete":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      case "running":
        return <PlayCircle className="w-5 h-5 text-purple-500 animate-pulse" />;
      case "stopped":
        return <Clock className="w-5 h-5 text-text-muted" />;
      default:
        return <Clock className="w-5 h-5 text-text-muted" />;
    }
  };

  const getStatusBadge = (status: TaskRunStatus) => {
    switch (status) {
      case "complete":
        return (
          <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
            Complete
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-500 border-red-500/30">
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-purple-500/20 text-purple-500 border-purple-500/30">
            Running
          </Badge>
        );
      case "stopped":
        return (
          <Badge className="bg-surface-raised text-text-muted border-border-subtle">
            Stopped
          </Badge>
        );
      default:
        return (
          <Badge className="bg-surface-raised text-text-muted border-border-subtle">
            Unknown
          </Badge>
        );
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "critical":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "high":
        return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      case "medium":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "low":
        return <Lightbulb className="w-4 h-4 text-blue-500" />;
      case "info":
        return <Lightbulb className="w-4 h-4 text-text-muted" />;
      default:
        return <Bug className="w-4 h-4 text-text-muted" />;
    }
  };

  const getFindingStatusBadge = (status: TaskRunFindingStatus) => {
    switch (status) {
      case "resolved":
        return (
          <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
            Resolved
          </Badge>
        );
      case "in_progress":
        return (
          <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30">
            In Progress
          </Badge>
        );
      case "needs_input":
        return (
          <Badge className="bg-purple-500/20 text-purple-500 border-purple-500/30">
            Needs Input
          </Badge>
        );
      case "wont_fix":
        return (
          <Badge className="bg-surface-raised text-text-muted border-border-subtle">
            Won&apos;t Fix
          </Badge>
        );
      case "deferred":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
            Deferred
          </Badge>
        );
      case "detected":
      default:
        return (
          <Badge className="bg-orange-500/20 text-orange-500 border-orange-500/30">
            Detected
          </Badge>
        );
    }
  };

  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds) return "-";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="AI Task Details">
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        {/* Header */}
        <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => router.push(`/ai-tasks?project=${projectId}`)}
                className="text-text-muted hover:text-white"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                All Tasks
              </Button>
              <div className="flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-brand-secondary" />
                <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-secondary to-brand-secondary bg-clip-text text-transparent">
                  AI Task Details
                </h1>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-border-default hover:border-brand-secondary hover:text-brand-secondary"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6 max-w-7xl mx-auto">
          {isLoading ? (
            <div className="text-center py-12 text-text-muted">
              <div className="flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Loading task details...
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">
              Error loading task: {(error as Error).message}
            </div>
          ) : !task ? (
            <div className="text-center py-12 text-text-muted">
              Task not found
            </div>
          ) : (
            <div className="space-y-6">
              {/* Task Header Card */}
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(task.status)}
                        <h2 className="text-xl font-semibold">
                          {task.task_name}
                        </h2>
                        {getStatusBadge(task.status)}
                      </div>
                      {task.prompt && (
                        <p className="text-text-muted line-clamp-2">
                          {task.prompt}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-text-muted">
                        <span>
                          Created:{" "}
                          {format(
                            new Date(task.created_at),
                            "MMM dd, yyyy HH:mm"
                          )}
                        </span>
                        {task.completed_at && (
                          <span>
                            Completed:{" "}
                            {format(
                              new Date(task.completed_at),
                              "MMM dd, yyyy HH:mm"
                            )}
                          </span>
                        )}
                        <span>
                          Duration: {formatDuration(task.duration_seconds)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-brand-secondary">
                          {task.sessions?.length || 0}
                        </div>
                        <div className="text-xs text-text-muted">Sessions</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-brand-secondary">
                          {task.findings?.length || 0}
                        </div>
                        <div className="text-xs text-text-muted">Findings</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="bg-surface-raised/50 border border-border-subtle/50">
                  <TabsTrigger
                    value="sessions"
                    className="data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary"
                  >
                    <Terminal className="w-4 h-4 mr-2" />
                    Sessions ({task.sessions?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger
                    value="findings"
                    className="data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary"
                  >
                    <Bug className="w-4 h-4 mr-2" />
                    Findings ({task.findings?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger
                    value="verification"
                    className="data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary"
                  >
                    <ClipboardCheck className="w-4 h-4 mr-2" />
                    Verification
                  </TabsTrigger>
                  {task.output_summary && (
                    <TabsTrigger
                      value="output"
                      className="data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Output
                    </TabsTrigger>
                  )}
                </TabsList>

                {/* Sessions Tab */}
                <TabsContent value="sessions" className="mt-4">
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Session Timeline
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!task.sessions || task.sessions.length === 0 ? (
                        <div className="text-center py-8 text-text-muted">
                          No sessions recorded for this task
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {task.sessions.map(
                            (session: TaskRunSession, index: number) => (
                              <div
                                key={session.id}
                                className="border border-border-subtle/50 rounded-lg overflow-hidden"
                              >
                                <button
                                  onClick={() =>
                                    toggleSessionExpand(session.id)
                                  }
                                  className="w-full p-4 flex items-center justify-between hover:bg-surface-raised/30 transition-colors"
                                >
                                  <div className="flex items-center gap-4">
                                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-secondary/20 text-brand-secondary text-sm font-medium">
                                      {index + 1}
                                    </div>
                                    <div className="text-left">
                                      <div className="font-medium">
                                        Session{" "}
                                        {session.session_number || index + 1}
                                      </div>
                                      <div className="text-sm text-text-muted">
                                        {format(
                                          new Date(session.started_at),
                                          "MMM dd, yyyy HH:mm:ss"
                                        )}
                                        {" - "}
                                        {session.ended_at
                                          ? format(
                                              new Date(session.ended_at),
                                              "HH:mm:ss"
                                            )
                                          : "In progress..."}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <div className="text-sm text-text-muted">
                                      {formatDuration(session.duration_seconds)}
                                    </div>
                                    {session.ended_at ? (
                                      <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
                                        Complete
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-purple-500/20 text-purple-500 border-purple-500/30">
                                        In Progress
                                      </Badge>
                                    )}
                                    {expandedSessions.has(session.id) ? (
                                      <ChevronUp className="w-4 h-4 text-text-muted" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-text-muted" />
                                    )}
                                  </div>
                                </button>
                                {expandedSessions.has(session.id) &&
                                  session.output_summary && (
                                    <div className="border-t border-border-subtle/50 p-4 bg-surface-canvas/50">
                                      <pre className="text-sm text-text-secondary whitespace-pre-wrap font-mono overflow-x-auto max-h-[400px] overflow-y-auto">
                                        {session.output_summary}
                                      </pre>
                                    </div>
                                  )}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Findings Tab */}
                <TabsContent value="findings" className="mt-4">
                  <Card className="bg-surface-raised/50 border-border-subtle/50">
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Findings by Severity
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!task.findings || task.findings.length === 0 ? (
                        <div className="text-center py-8 text-text-muted">
                          <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-brand-success" />
                          <p>No findings reported for this task</p>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {/* Group findings by severity */}
                          {["critical", "high", "medium", "low", "info"].map(
                            (severity) => {
                              const severityFindings =
                                task.findings?.filter(
                                  (f: TaskRunFinding) => f.severity === severity
                                ) || [];
                              if (severityFindings.length === 0) return null;

                              return (
                                <div key={severity}>
                                  <div className="flex items-center gap-2 mb-3">
                                    {getSeverityIcon(severity)}
                                    <h3 className="font-medium capitalize">
                                      {severity} ({severityFindings.length})
                                    </h3>
                                  </div>
                                  <div className="space-y-2">
                                    {severityFindings.map(
                                      (finding: TaskRunFinding) => (
                                        <div
                                          key={finding.id}
                                          className="border border-border-subtle/50 rounded-lg overflow-hidden"
                                        >
                                          <button
                                            onClick={() =>
                                              toggleFindingExpand(finding.id)
                                            }
                                            className="w-full p-4 flex items-center justify-between hover:bg-surface-raised/30 transition-colors text-left"
                                          >
                                            <div className="flex items-center gap-3">
                                              {getSeverityIcon(
                                                finding.severity
                                              )}
                                              <div>
                                                <div className="font-medium">
                                                  {finding.title}
                                                </div>
                                                <div className="text-sm text-text-muted">
                                                  {finding.category ||
                                                    "General"}
                                                </div>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                              {getFindingStatusBadge(
                                                finding.status
                                              )}
                                              {expandedFindings.has(
                                                finding.id
                                              ) ? (
                                                <ChevronUp className="w-4 h-4 text-text-muted" />
                                              ) : (
                                                <ChevronDown className="w-4 h-4 text-text-muted" />
                                              )}
                                            </div>
                                          </button>
                                          {expandedFindings.has(finding.id) && (
                                            <div className="border-t border-border-subtle/50 p-4 bg-surface-canvas/50 space-y-4">
                                              <div>
                                                <h4 className="text-sm font-medium text-text-muted mb-1">
                                                  Description
                                                </h4>
                                                <p className="text-sm text-text-secondary">
                                                  {finding.description}
                                                </p>
                                              </div>
                                              {finding.resolution && (
                                                <div>
                                                  <h4 className="text-sm font-medium text-text-muted mb-1">
                                                    Resolution
                                                  </h4>
                                                  <p className="text-sm text-text-secondary">
                                                    {finding.resolution}
                                                  </p>
                                                </div>
                                              )}
                                              {finding.file_path && (
                                                <div>
                                                  <h4 className="text-sm font-medium text-text-muted mb-1">
                                                    Location
                                                  </h4>
                                                  <code className="text-sm text-brand-secondary bg-brand-secondary/10 px-2 py-1 rounded">
                                                    {finding.file_path}
                                                    {finding.line_number &&
                                                      `:${finding.line_number}`}
                                                  </code>
                                                </div>
                                              )}
                                              <div className="flex items-center gap-2 pt-2">
                                                <span className="text-sm text-text-muted">
                                                  Status:
                                                </span>
                                                <select
                                                  value={finding.status}
                                                  onChange={(e) =>
                                                    handleFindingStatusChange(
                                                      finding.id,
                                                      e.target.value
                                                    )
                                                  }
                                                  className="bg-surface-canvas border border-border-default rounded px-2 py-1 text-sm"
                                                >
                                                  <option value="detected">
                                                    Detected
                                                  </option>
                                                  <option value="in_progress">
                                                    In Progress
                                                  </option>
                                                  <option value="needs_input">
                                                    Needs Input
                                                  </option>
                                                  <option value="resolved">
                                                    Resolved
                                                  </option>
                                                  <option value="wont_fix">
                                                    Won&apos;t Fix
                                                  </option>
                                                  <option value="deferred">
                                                    Deferred
                                                  </option>
                                                </select>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      )
                                    )}
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Verification Tab */}
                <TabsContent value="verification" className="mt-4">
                  <VerificationResultsTab taskId={taskId} />
                </TabsContent>

                {/* Output Tab */}
                {task.output_summary && (
                  <TabsContent value="output" className="mt-4">
                    <Card className="bg-surface-raised/50 border-border-subtle/50">
                      <CardHeader>
                        <CardTitle className="text-lg">
                          Output Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <pre className="text-sm text-text-secondary whitespace-pre-wrap font-mono overflow-x-auto max-h-[600px] overflow-y-auto bg-surface-canvas/50 p-4 rounded-lg">
                          {task.output_summary}
                        </pre>
                      </CardContent>
                    </Card>
                  </TabsContent>
                )}
              </Tabs>
            </div>
          )}
        </main>
      </div>
    </RequireProject>
  );
}
