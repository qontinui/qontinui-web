"use client";

import { useState, useMemo, lazy, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sparkles,
  Target,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ShieldCheck,
  BookOpen,
  RefreshCw,
  Brain,
  Users,
  FileText,
  User,
  StopCircle,
  Activity,
  Calendar,
  Repeat,
  Bug,
  Shield,
  Zap,
  Settings,
  FlaskConical,
  Filter,
} from "lucide-react";
import {
  runnerApi,
  useTaskRunVerification,
  useTaskRunKnowledge,
} from "@/lib/runner-api";
import type {
  TaskRun,
  VerificationData,
  Finding,
  FailureInfo,
} from "@/lib/runner-api";
import { toast } from "sonner";
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
// Helper Functions
// =============================================================================

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  // Support both seconds and ms - if value > 100000 it's likely ms
  const totalSeconds = ms > 100000 ? Math.round(ms / 1000) : Math.round(ms);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString();
  } catch {
    return dateString;
  }
}

// =============================================================================
// AI Summary: User Message Parsing (matches runner's AISummarySection)
// =============================================================================

interface SummarySegment {
  type: "text" | "user_message";
  content: string;
}

function parseSummarySegments(text: string): SummarySegment[] {
  const segments: SummarySegment[] = [];
  const regex = /\[USER_MESSAGE\]\s*([\s\S]*?)\s*\[\/USER_MESSAGE\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", content: before });
    }
    const userContent = match[1]!.trim();
    if (userContent)
      segments.push({ type: "user_message", content: userContent });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) segments.push({ type: "text", content: remaining });
  }

  return segments;
}

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
// Severity helpers for Knowledge/Findings
// =============================================================================

type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

const SEVERITY_ORDER: FindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

const SEVERITY_COLORS: Record<
  FindingSeverity,
  { bg: string; text: string; border: string }
> = {
  critical: {
    bg: "bg-red-500/10",
    text: "text-red-500",
    border: "border-red-500/30",
  },
  high: {
    bg: "bg-orange-500/10",
    text: "text-orange-500",
    border: "border-orange-500/30",
  },
  medium: {
    bg: "bg-amber-500/10",
    text: "text-amber-500",
    border: "border-amber-500/30",
  },
  low: {
    bg: "bg-blue-500/10",
    text: "text-blue-500",
    border: "border-blue-500/30",
  },
  info: {
    bg: "bg-gray-500/10",
    text: "text-gray-400",
    border: "border-gray-500/30",
  },
};

// Category icons mapping (matches runner's KnowledgeTab)
const CATEGORY_ICONS: Record<string, typeof Bug> = {
  code_bug: Bug,
  security: Shield,
  performance: Zap,
  todo: CheckCircle2,
  enhancement: Sparkles,
  config_issue: Settings,
  documentation: FileText,
  test_issue: FlaskConical,
};

// =============================================================================
// Inline Sub-tab: VerificationSubTab (rewritten to match runner)
// =============================================================================

function VerificationSubTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunVerification(runId);
  const [expandedResults, setExpandedResults] = useState<Set<number>>(
    new Set()
  );

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading verification results...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        <AlertTriangle className="size-5 mx-auto mb-2" />
        Failed to load verification results
      </div>
    );
  }

  const verificationData = data as VerificationData | null;

  if (!verificationData || verificationData.results.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <FlaskConical className="size-12 mx-auto mb-4 opacity-50" />
        <h3 className="font-medium text-lg mb-2">No Verification Results</h3>
        <p className="text-sm text-text-secondary max-w-md mx-auto">
          No verification steps have been executed for this run. Verification
          steps include tests, checks, and other validation tasks defined in
          your workflow.
        </p>
      </div>
    );
  }

  const { results, summary } = verificationData;

  // Compute summary from results if not provided by API
  const totalCount = summary?.total ?? results.length;
  const passedCount = summary?.passed ?? results.filter((r) => r.passed).length;
  const failedCount =
    summary?.failed ?? results.filter((r) => !r.passed).length;
  const allPassed = summary?.all_passed ?? failedCount === 0;

  const toggleResult = (index: number) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      <div
        className={`rounded-lg p-4 ${
          allPassed
            ? "bg-green-500/10 text-green-500"
            : "bg-amber-500/10 text-amber-500"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {allPassed ? (
              <CheckCircle2 className="size-6" />
            ) : (
              <AlertTriangle className="size-6" />
            )}
            <div>
              <h3 className="font-medium">
                {allPassed
                  ? "All Verification Passed"
                  : `${failedCount} of ${totalCount} Checks Failed`}
              </h3>
              <p className="text-sm opacity-80">
                {totalCount} verification check{totalCount !== 1 ? "s" : ""}{" "}
                executed
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              {passedCount}/{totalCount}
            </div>
            <div className="text-xs opacity-80">checks passed</div>
          </div>
        </div>
      </div>

      {/* Individual Result Cards */}
      <div className="space-y-2">
        {results.map((result, index) => {
          const isExpanded = expandedResults.has(index);
          const hasDetails = !!result.observation;

          return (
            <div
              key={result.id ?? index}
              className="border border-border-subtle/50 rounded-lg overflow-hidden bg-surface-raised/30"
            >
              {/* Card Header (clickable) */}
              <button
                onClick={() => toggleResult(index)}
                disabled={!hasDetails}
                className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${
                  hasDetails
                    ? "hover:bg-surface-canvas/50 cursor-pointer"
                    : "cursor-default"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Status icon */}
                  {result.passed ? (
                    <CheckCircle2 className="size-5 text-green-500" />
                  ) : (
                    <XCircle className="size-5 text-red-500" />
                  )}

                  {/* Type icon */}
                  <div
                    className={`p-1.5 rounded ${
                      result.passed
                        ? "bg-green-500/10 text-green-500"
                        : "bg-red-500/10 text-red-500"
                    }`}
                  >
                    <ShieldCheck className="size-4" />
                  </div>

                  {/* Criterion text */}
                  <span className="font-medium text-sm text-text-primary text-left">
                    {result.criterion}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Confidence badge */}
                  <Badge
                    variant={
                      result.confidence >= 0.8
                        ? "success"
                        : result.confidence >= 0.5
                          ? "warning"
                          : "destructive"
                    }
                    className="text-xs"
                  >
                    {Math.round(result.confidence * 100)}%
                  </Badge>

                  {/* Timestamp */}
                  <span className="text-xs text-text-muted flex items-center gap-1">
                    <Clock className="size-3" />
                    {formatDateTime(result.verified_at)}
                  </span>

                  {/* Expand chevron */}
                  {hasDetails &&
                    (isExpanded ? (
                      <ChevronDown className="size-4 text-text-muted" />
                    ) : (
                      <ChevronRight className="size-4 text-text-muted" />
                    ))}
                </div>
              </button>

              {/* Expanded details */}
              {isExpanded && hasDetails && (
                <div className="border-t border-border-subtle/50 p-4 bg-surface-canvas/30">
                  <h4 className="text-sm font-medium mb-1 text-text-secondary">
                    Observation
                  </h4>
                  <p className="text-sm text-text-muted whitespace-pre-wrap">
                    {result.observation}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Inline Sub-tab: KnowledgeSubTab (rewritten to match runner)
// =============================================================================

function KnowledgeSubTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunKnowledge(runId);
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(
    new Set()
  );
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

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

  const toggleFinding = (index: number) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Group findings by severity
  const findingsBySeverity = data.findings.reduce(
    (acc, finding) => {
      const severity = (
        finding.severity || "info"
      ).toLowerCase() as FindingSeverity;
      if (!acc[severity]) acc[severity] = [];
      acc[severity]!.push(finding);
      return acc;
    },
    {} as Partial<Record<FindingSeverity, Finding[]>>
  );

  // Get unique categories for filter
  const categories = ["all", ...new Set(data.findings.map((f) => f.category))];

  // Filter findings by category if set
  const getFilteredFindings = (findings: Finding[]) => {
    if (categoryFilter === "all") return findings;
    return findings.filter((f) => f.category === categoryFilter);
  };

  return (
    <div className="space-y-4">
      {/* Findings Panel (grouped by severity like runner) */}
      {data.findings.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="size-5 text-amber-500" />
                Findings ({data.findings.length})
              </CardTitle>
              {/* Category filter */}
              {categories.length > 2 && (
                <div className="flex items-center gap-1">
                  <Filter className="size-4 text-text-muted" />
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="text-xs bg-surface-canvas/50 border border-border-subtle/50 rounded px-2 py-1 text-text-secondary"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat === "all" ? "All Categories" : cat}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {SEVERITY_ORDER.map((severity) => {
              const severityFindings = getFilteredFindings(
                findingsBySeverity[severity] || []
              );
              if (severityFindings.length === 0) return null;

              const colors = SEVERITY_COLORS[severity];

              return (
                <div
                  key={severity}
                  className={`rounded-lg border ${colors.border} ${colors.bg}`}
                >
                  {/* Severity header */}
                  <div
                    className={`px-3 py-2 font-medium ${colors.text} capitalize`}
                  >
                    {severity} ({severityFindings.length})
                  </div>
                  {/* Finding items */}
                  <div className="divide-y divide-border-subtle/30">
                    {severityFindings.map((finding: Finding) => {
                      const globalIndex = data.findings.indexOf(finding);
                      const Icon =
                        CATEGORY_ICONS[finding.category] || AlertTriangle;
                      const isExpanded = expandedFindings.has(globalIndex);

                      return (
                        <div
                          key={finding.id ?? globalIndex}
                          className="px-3 py-2"
                        >
                          <button
                            onClick={() => toggleFinding(globalIndex)}
                            className="w-full flex items-center gap-2 text-left"
                          >
                            <Icon
                              className={`size-4 ${colors.text} flex-shrink-0`}
                            />
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} flex-shrink-0`}
                            >
                              {finding.category}
                            </span>
                            <span className="flex-1 text-sm font-medium text-text-primary truncate">
                              {finding.title}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-xs shrink-0"
                            >
                              {finding.status}
                            </Badge>
                            {isExpanded ? (
                              <ChevronDown className="size-4 text-text-muted flex-shrink-0" />
                            ) : (
                              <ChevronRight className="size-4 text-text-muted flex-shrink-0" />
                            )}
                          </button>
                          {isExpanded && (
                            <div className="mt-2 ml-6 text-sm text-text-secondary space-y-1">
                              <p>{finding.description}</p>
                              {finding.file_path && (
                                <p className="text-xs text-text-muted font-mono">
                                  File: {finding.file_path}
                                  {finding.line_number != null &&
                                    `:${finding.line_number}`}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Observations */}
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

      {/* Hypotheses */}
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

// =============================================================================
// FailureSection (matches runner's FailureSection component)
// =============================================================================

function FailureSection({ failure }: { failure: FailureInfo }) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <XCircle className="size-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-red-500">Run Failed</h3>
          <p className="text-sm text-red-400 mt-1">{failure.reason}</p>
        </div>
      </div>

      {failure.failed_step && (
        <div className="ml-8 text-sm">
          <span className="text-text-muted">Failed at: </span>
          <span className="text-red-400 font-medium">
            {failure.failed_step}
          </span>
        </div>
      )}

      {failure.error_type && (
        <div className="ml-8 text-sm">
          <span className="text-text-muted">Error type: </span>
          <span className="text-red-400">{failure.error_type}</span>
        </div>
      )}

      {failure.error_details && failure.error_details !== failure.reason && (
        <div className="ml-8 mt-2">
          <details className="text-sm">
            <summary className="cursor-pointer text-text-muted hover:text-text-primary">
              Show error details
            </summary>
            <pre className="mt-2 p-3 bg-surface-canvas/50 rounded text-xs overflow-x-auto whitespace-pre-wrap text-red-300">
              {failure.error_details}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SummaryTab Props
// =============================================================================

interface SummaryTabProps {
  run: TaskRun;
  onRefresh?: () => void;
}

// =============================================================================
// Main Component (matches runner's RunRecapTab layout)
// =============================================================================

const SUMMARY_COLLAPSE_THRESHOLD = 300;

export function SummaryTab({ run, onRefresh }: SummaryTabProps) {
  const [additionalSessions, setAdditionalSessions] = useState(3);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const aiSummary = run.summary || run.ai_summary || "";
  const goalAchieved = run.goal_achieved;
  const remainingWork = run.remaining_work || null;
  const loopResult = run.loop_result || null;
  const failureInfo = run.failure_info || null;

  const isFinished =
    run.status === "completed" ||
    run.status === "complete" ||
    run.status === "failed" ||
    run.status === "stopped";

  // Compute duration from timestamps if duration_seconds not provided
  const durationSeconds = useMemo(() => {
    if (run.duration_seconds != null) return run.duration_seconds;
    if (run.created_at && run.completed_at) {
      return (
        (new Date(run.completed_at).getTime() -
          new Date(run.created_at).getTime()) /
        1000
      );
    }
    return undefined;
  }, [run.duration_seconds, run.created_at, run.completed_at]);

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

  // ---- Status banner color/icon/label logic (matches runner's StatusBanner) ----
  const isSuccess = run.status === "complete" || run.status === "completed";
  const isFailed = run.status === "failed";
  const isRunning = run.status === "running";
  const isStopped = run.status === "stopped";

  let bannerBg = "bg-surface-raised/30";
  let bannerText = "text-text-muted";
  let bannerIcon = <Clock className="size-5" />;
  let bannerLabel = run.status.charAt(0).toUpperCase() + run.status.slice(1);

  // Determine status based on loop result if available (matches runner logic)
  if (loopResult) {
    if (loopResult.was_stopped) {
      bannerBg = "bg-amber-500/10";
      bannerText = "text-amber-500";
      bannerIcon = <StopCircle className="size-5" />;
      bannerLabel = "Run Stopped";
    } else if (loopResult.critical_failure) {
      bannerBg = "bg-red-500/10";
      bannerText = "text-red-500";
      bannerIcon = <AlertTriangle className="size-5" />;
      bannerLabel = "Critical Failure";
    } else if (loopResult.verification_passed) {
      bannerBg = "bg-green-500/10";
      bannerText = "text-green-500";
      bannerIcon = <CheckCircle2 className="size-5" />;
      bannerLabel = goalAchieved ? "Goal Achieved" : "Verification Passed";
    } else if (loopResult.max_iterations_reached) {
      bannerBg = "bg-amber-500/10";
      bannerText = "text-amber-500";
      bannerIcon = <AlertTriangle className="size-5" />;
      bannerLabel = "Max Iterations Reached";
    } else if (isSuccess) {
      bannerBg = "bg-green-500/10";
      bannerText = "text-green-500";
      bannerIcon = <CheckCircle2 className="size-5" />;
      bannerLabel = "Run Completed";
    }
  } else if (isSuccess) {
    bannerBg = "bg-green-500/10";
    bannerText = "text-green-500";
    bannerIcon = <CheckCircle2 className="size-5" />;
    bannerLabel = goalAchieved ? "Goal Achieved" : "Run Completed";
  } else if (isFailed) {
    bannerBg = "bg-red-500/10";
    bannerText = "text-red-500";
    bannerIcon = <XCircle className="size-5" />;
    bannerLabel = "Run Failed";
  } else if (isRunning) {
    bannerBg = "bg-blue-500/10";
    bannerText = "text-blue-500";
    bannerIcon = <Activity className="size-5 animate-pulse" />;
    bannerLabel = "Running";
  } else if (isStopped) {
    bannerBg = "bg-amber-500/10";
    bannerText = "text-amber-500";
    bannerIcon = <StopCircle className="size-5" />;
    bannerLabel = "Run Stopped";
  }

  return (
    <div className="space-y-4">
      {/* ================================================================= */}
      {/* 1. AI Summary Section (matches runner's AISummarySection) */}
      {/* ================================================================= */}
      {aiSummary ? (
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
                {run.summary_generated_at && (
                  <p className="text-xs text-text-muted">
                    Generated {formatDateTime(run.summary_generated_at)}
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
                <span className="font-medium text-amber-500">
                  Remaining Work
                </span>
              </div>
              <p className="text-amber-300/90 whitespace-pre-wrap">
                {remainingWork}
              </p>
            </div>
          )}
        </div>
      ) : isGeneratingSummary ? (
        <div className="rounded-xl border border-border-subtle/50 bg-surface-raised/20 p-5">
          <div className="flex items-center gap-3 text-text-muted">
            <Loader2 className="size-5 animate-spin" />
            <span>Generating AI summary...</span>
          </div>
        </div>
      ) : isFinished ? (
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
      ) : (
        <div className="rounded-xl border border-border-subtle/50 bg-surface-raised/20 p-5">
          <div className="flex items-center gap-3 text-text-muted">
            <FileText className="size-5 opacity-50" />
            <span>
              Run in progress. Summary will be available after completion.
            </span>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 2. Status & Stats */}
      {/* ================================================================= */}
      <div className={`${bannerBg} ${bannerText} rounded-lg p-4 space-y-2`}>
        {/* Line 1: Status, badges, duration, timestamps */}
        <div className="flex items-center justify-between flex-wrap gap-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            {bannerIcon}
            <span className="font-medium">{bannerLabel}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                goalAchieved === true
                  ? "bg-green-500/20 text-green-400"
                  : goalAchieved === false
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-surface-raised/30 text-text-muted"
              }`}
            >
              {goalAchieved === true
                ? "Goal \u2713"
                : goalAchieved === false
                  ? "Goal \u2717"
                  : "Goal: Pending"}
            </span>
            {loopResult && loopResult.iterations_run > 0 && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                <Repeat className="size-3" />
                {loopResult.iterations_run} iteration
                {loopResult.iterations_run !== 1 ? "s" : ""}
              </span>
            )}
            {run.workflow_type && (
              <Badge variant="outline" className="text-xs">
                {run.workflow_type.toUpperCase()}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm opacity-80">
            <div className="flex items-center gap-2">
              <Clock className="size-4" />
              <span>
                {durationSeconds != null
                  ? formatDuration(durationSeconds)
                  : "In progress..."}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="size-4" />
              <span>{formatDateTime(run.created_at)}</span>
            </div>
            {run.completed_at && (
              <div className="flex items-center gap-2">
                <span>&ndash;</span>
                <span>{formatDateTime(run.completed_at)}</span>
              </div>
            )}
          </div>
        </div>

        {loopResult && loopResult.summary && (
          <div className="text-sm opacity-90">{loopResult.summary}</div>
        )}

        {/* Line 2: Session stats + actions */}
        <div className="flex items-center gap-3 text-sm opacity-90 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="size-4" />
            <span>
              {run.sessions_count ?? 0} session
              {(run.sessions_count ?? 0) !== 1 ? "s" : ""}
              {run.max_sessions ? ` / ${run.max_sessions} max` : ""}
            </span>
          </div>
          <div className="w-px h-4 bg-current opacity-20" />
          <div className="flex items-center gap-2">
            <FileText className="size-4" />
            <span>
              {run.output_log
                ? `${Math.round(run.output_log.length / 1024)}KB output`
                : "No output"}
            </span>
          </div>
          {run.auto_continue && (
            <>
              <div className="w-px h-4 bg-current opacity-20" />
              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">
                Auto-continue
              </span>
            </>
          )}
          {isFailed && (
            <>
              <div className="w-px h-4 bg-current opacity-20" />
              <div className="flex items-center gap-2 ml-auto">
                <label
                  htmlFor="additionalSessions"
                  className="whitespace-nowrap"
                >
                  Sessions:
                </label>
                <Input
                  id="additionalSessions"
                  type="number"
                  min={1}
                  max={20}
                  value={additionalSessions}
                  onChange={(e) =>
                    setAdditionalSessions(
                      Math.max(1, Math.min(20, parseInt(e.target.value) || 1))
                    )
                  }
                  className="w-16 h-8 bg-surface-canvas/50 border-border-subtle/50"
                />
                <Button
                  onClick={handleContinue}
                  disabled={isContinuing}
                  variant="brand-primary"
                  size="sm"
                >
                  {isContinuing ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-1" />
                      Reopening...
                    </>
                  ) : (
                    <>
                      <Play className="size-4 mr-1" />
                      Continue Run
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* 4. Failure Section (matches runner's FailureSection with structured info) */}
      {/* ================================================================= */}
      {isFailed && failureInfo && <FailureSection failure={failureInfo} />}
      {isFailed && !failureInfo && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-3">
            <XCircle className="size-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-red-500">Run Failed</h3>
              <p className="text-sm text-red-400 mt-1">
                {run.summary ||
                  run.ai_summary ||
                  "Run failed. Check the output log for details."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 6. Nested Sub-tabs: Timeline, Verification, Knowledge, Context */}
      {/* ================================================================= */}
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
          <Suspense fallback={<div className="text-center py-8 text-text-muted"><Loader2 className="size-4 animate-spin mx-auto mb-2" />Loading...</div>}>
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
          <Suspense fallback={<div className="text-center py-8 text-text-muted"><Loader2 className="size-4 animate-spin mx-auto mb-2" />Loading...</div>}>
            <ContextTab runId={run.id} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
