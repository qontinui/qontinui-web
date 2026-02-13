"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTaskRunOutput } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  MessageSquare,
  ArrowDown,
  User,
  Bot,
  Minus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  FileText,
  Flag,
  Lightbulb,
  CheckSquare,
  BookOpen,
  Cog,
} from "lucide-react";

interface AiConversationTabProps {
  runId: string;
}

// ============================================================================
// Segment Types
// ============================================================================

interface SessionDividerSegment {
  type: "session-divider";
  content: string;
  sessionNumber: number;
}

interface AiSegment {
  type: "ai";
  content: string;
  sessionNumber: number;
}

interface UserSegment {
  type: "user";
  content: string;
  sessionNumber: number;
}

interface FindingSegment {
  type: "finding";
  severity: string;
  category: string;
  title: string;
  sessionNumber: number;
}

interface StepCompleteSegment {
  type: "step-complete";
  stepName: string;
  status: string;
  sessionNumber: number;
}

interface TaskCompleteSegment {
  type: "task-complete";
  sessionNumber: number;
}

interface OrchestratorSegment {
  type: "orchestrator";
  agent: "planning" | "verification" | "knowledge" | "orchestrator";
  content: string;
  sessionNumber: number;
}

type ConversationSegment =
  | SessionDividerSegment
  | AiSegment
  | UserSegment
  | FindingSegment
  | StepCompleteSegment
  | TaskCompleteSegment
  | OrchestratorSegment;

// ============================================================================
// Parsing Helpers
// ============================================================================

/** Severity configuration for findings */
const FINDING_SEVERITY_STYLES: Record<
  string,
  { bg: string; border: string; text: string; icon: string }
> = {
  critical: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    icon: "text-red-400",
  },
  high: {
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    text: "text-orange-400",
    icon: "text-orange-400",
  },
  medium: {
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    text: "text-yellow-400",
    icon: "text-yellow-400",
  },
  low: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    icon: "text-blue-400",
  },
};

/** Orchestrator agent display config */
const ORCHESTRATOR_AGENT_CONFIG: Record<
  string,
  {
    label: string;
    bg: string;
    border: string;
    text: string;
    icon: typeof Lightbulb;
  }
> = {
  planning: {
    label: "Planning Agent",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    icon: Lightbulb,
  },
  verification: {
    label: "Verification Agent",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    icon: CheckSquare,
  },
  knowledge: {
    label: "Knowledge Base",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
    text: "text-purple-400",
    icon: BookOpen,
  },
  orchestrator: {
    label: "Orchestrator",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    icon: Cog,
  },
};

/**
 * Parse markers out of a raw text chunk, returning inline segments.
 * Handles: [FINDING:severity:category:title], [STEP_COMPLETE:name:status],
 * [TASK_COMPLETE], and orchestrator agent prefixes like [Planning Agent], etc.
 */
function parseInlineMarkers(
  text: string,
  sessionNumber: number
): ConversationSegment[] {
  const segments: ConversationSegment[] = [];

  // Combined regex to match all marker types in order of appearance
  const markerRegex =
    /\[FINDING:([\w]+):([\w_]+):([^\]]*)\]|\[STEP_COMPLETE:([\w_.-]+):([\w]+)\]|\[TASK_COMPLETE\]|\[(?:Planning Agent|Verification Agent|Knowledge Base|Orchestrator)\]\s*[^\n]*/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(text)) !== null) {
    // Push any AI text before this marker
    const beforeText = text.slice(lastIndex, match.index).trim();
    if (beforeText) {
      segments.push({
        type: "ai",
        content: beforeText,
        sessionNumber,
      });
    }

    const fullMatch = match[0];

    if (fullMatch.startsWith("[FINDING:")) {
      segments.push({
        type: "finding",
        severity: (match[1] ?? "medium").toLowerCase(),
        category: match[2] ?? "unknown",
        title: match[3] ?? "",
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[STEP_COMPLETE:")) {
      segments.push({
        type: "step-complete",
        stepName: match[4] ?? "unknown",
        status: (match[5] ?? "unknown").toLowerCase(),
        sessionNumber,
      });
    } else if (fullMatch === "[TASK_COMPLETE]") {
      segments.push({
        type: "task-complete",
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[Planning Agent]")) {
      segments.push({
        type: "orchestrator",
        agent: "planning",
        content: fullMatch.replace(/^\[Planning Agent\]\s*/, ""),
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[Verification Agent]")) {
      segments.push({
        type: "orchestrator",
        agent: "verification",
        content: fullMatch.replace(/^\[Verification Agent\]\s*/, ""),
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[Knowledge Base]")) {
      segments.push({
        type: "orchestrator",
        agent: "knowledge",
        content: fullMatch.replace(/^\[Knowledge Base\]\s*/, ""),
        sessionNumber,
      });
    } else if (fullMatch.startsWith("[Orchestrator]")) {
      segments.push({
        type: "orchestrator",
        agent: "orchestrator",
        content: fullMatch.replace(/^\[Orchestrator\]\s*/, ""),
        sessionNumber,
      });
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Push any remaining AI text
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    segments.push({
      type: "ai",
      content: remaining,
      sessionNumber,
    });
  }

  return segments;
}

/**
 * Full output_log parser.
 * Splits on [SESSION_START:N] and [USER_MESSAGE]...[/USER_MESSAGE],
 * then parses inline markers from AI text chunks.
 */
function parseOutputLog(outputLog: string): ConversationSegment[] {
  if (!outputLog) return [];

  const segments: ConversationSegment[] = [];
  const sessionParts = outputLog.split(/(\[SESSION_START:(\d+)\])/);
  let currentSessionNumber = 1;

  for (let i = 0; i < sessionParts.length; i++) {
    const part = sessionParts[i] ?? "";
    const sessionMatch = part.match(/^\[SESSION_START:(\d+)\]$/);

    if (sessionMatch) {
      currentSessionNumber = parseInt(sessionMatch[1] ?? "1", 10);
      segments.push({
        type: "session-divider",
        content: `Session ${currentSessionNumber}`,
        sessionNumber: currentSessionNumber,
      });
      continue;
    }

    // Skip the captured group number from the regex split
    const prevPart = sessionParts[i - 1] ?? "";
    if (/^\d+$/.test(part) && i > 0 && /^\[SESSION_START:\d+\]$/.test(prevPart))
      continue;

    if (!part || !part.trim()) continue;

    // Split on user messages
    const userMsgRegex = /\[USER_MESSAGE\]([\s\S]*?)\[\/USER_MESSAGE\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = userMsgRegex.exec(part)) !== null) {
      const aiContent = part.slice(lastIndex, match.index).trim();
      if (aiContent) {
        // Parse inline markers from AI content
        segments.push(...parseInlineMarkers(aiContent, currentSessionNumber));
      }
      const userContent = (match[1] ?? "").trim();
      if (userContent) {
        segments.push({
          type: "user",
          content: userContent,
          sessionNumber: currentSessionNumber,
        });
      }
      lastIndex = match.index + match[0].length;
    }

    const remaining = part.slice(lastIndex).trim();
    if (remaining) {
      segments.push(...parseInlineMarkers(remaining, currentSessionNumber));
    }
  }

  return segments;
}

// ============================================================================
// Summary Stats
// ============================================================================

interface ConversationStats {
  sessionCount: number;
  messageCount: number;
  findingsCount: number;
  findingsBySeverity: Record<string, number>;
  stepsCompleted: number;
  taskComplete: boolean;
}

function computeStats(segments: ConversationSegment[]): ConversationStats {
  const stats: ConversationStats = {
    sessionCount: 0,
    messageCount: 0,
    findingsCount: 0,
    findingsBySeverity: {},
    stepsCompleted: 0,
    taskComplete: false,
  };

  for (const seg of segments) {
    switch (seg.type) {
      case "session-divider":
        if (seg.sessionNumber > stats.sessionCount) {
          stats.sessionCount = seg.sessionNumber;
        }
        break;
      case "ai":
      case "user":
        stats.messageCount++;
        break;
      case "finding":
        stats.findingsCount++;
        stats.findingsBySeverity[seg.severity] =
          (stats.findingsBySeverity[seg.severity] ?? 0) + 1;
        break;
      case "step-complete":
        stats.stepsCompleted++;
        break;
      case "task-complete":
        stats.taskComplete = true;
        break;
      case "orchestrator":
        stats.messageCount++;
        break;
    }
  }

  return stats;
}

// ============================================================================
// Segment Renderers
// ============================================================================

function SessionDivider({ segment }: { segment: SessionDividerSegment }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border-subtle/50" />
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-raised/50 border border-border-subtle/50">
        <Minus className="size-3 text-text-muted" />
        <span className="text-xs font-medium text-text-muted">
          {segment.content}
        </span>
      </div>
      <div className="flex-1 h-px bg-border-subtle/50" />
    </div>
  );
}

function UserMessage({ segment }: { segment: UserSegment }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg p-3 bg-brand-primary/10 border border-brand-primary/30">
        <div className="flex items-center gap-1.5 mb-1">
          <User className="size-3 text-brand-primary" />
          <span className="text-xs font-medium text-brand-primary">User</span>
        </div>
        <pre className="text-sm font-mono text-text-primary whitespace-pre-wrap break-words leading-relaxed">
          {segment.content}
        </pre>
      </div>
    </div>
  );
}

function AiMessage({ segment }: { segment: AiSegment }) {
  return (
    <div className="flex justify-start">
      <div className="w-full rounded-lg p-3 bg-surface-raised/20 border border-border-subtle/40">
        <div className="flex items-center gap-1.5 mb-1">
          <Bot className="size-3 text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">AI</span>
        </div>
        <pre className="text-sm font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed">
          {segment.content}
        </pre>
      </div>
    </div>
  );
}

function FindingBanner({ segment }: { segment: FindingSegment }) {
  const styles =
    FINDING_SEVERITY_STYLES[segment.severity] ??
    FINDING_SEVERITY_STYLES.medium!;

  const SeverityIcon =
    segment.severity === "critical" || segment.severity === "high"
      ? AlertTriangle
      : segment.severity === "medium"
        ? Flag
        : Info;

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${styles.bg} ${styles.border}`}
    >
      <SeverityIcon className={`size-4 flex-shrink-0 ${styles.icon}`} />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Badge
          variant="outline"
          className={`text-[10px] uppercase px-1.5 py-0 ${styles.text} border-current/30`}
        >
          {segment.severity}
        </Badge>
        <span className={`text-xs font-medium ${styles.text}`}>
          {segment.category}
        </span>
        {segment.title && (
          <span className="text-xs text-text-muted truncate">
            {segment.title}
          </span>
        )}
      </div>
      <FileText className={`size-3 flex-shrink-0 ${styles.icon} opacity-50`} />
    </div>
  );
}

function StepCompleteBanner({ segment }: { segment: StepCompleteSegment }) {
  const isSuccess =
    segment.status === "success" ||
    segment.status === "completed" ||
    segment.status === "done";
  const isError =
    segment.status === "error" ||
    segment.status === "failed" ||
    segment.status === "failure";

  const StatusIcon = isSuccess ? CheckCircle : isError ? XCircle : Info;

  const statusColor = isSuccess
    ? "text-emerald-400"
    : isError
      ? "text-red-400"
      : "text-text-muted";

  const bgColor = isSuccess
    ? "bg-emerald-500/5"
    : isError
      ? "bg-red-500/5"
      : "bg-surface-raised/20";

  const borderColor = isSuccess
    ? "border-emerald-500/20"
    : isError
      ? "border-red-500/20"
      : "border-border-subtle/30";

  // Format step name: replace underscores/dots with spaces, title case
  const formattedName = segment.stepName
    .replace(/[_.-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${bgColor} ${borderColor}`}
    >
      <StatusIcon className={`size-3.5 flex-shrink-0 ${statusColor}`} />
      <span className="text-xs text-text-muted">Step completed:</span>
      <span className={`text-xs font-medium ${statusColor}`}>
        {formattedName}
      </span>
      <Badge
        variant="outline"
        className={`text-[10px] ml-auto px-1.5 py-0 ${statusColor} border-current/30`}
      >
        {segment.status}
      </Badge>
    </div>
  );
}

function TaskCompleteBanner() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border bg-emerald-500/10 border-emerald-500/30">
      <CheckCircle className="size-4 flex-shrink-0 text-emerald-400" />
      <span className="text-sm font-medium text-emerald-400">
        Task Completed
      </span>
    </div>
  );
}

function OrchestratorMessage({ segment }: { segment: OrchestratorSegment }) {
  const config = ORCHESTRATOR_AGENT_CONFIG[segment.agent];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div
      className={`rounded-lg px-3 py-2 border ${config.bg} ${config.border}`}
    >
      <div
        className={`flex items-center gap-2 text-xs font-semibold mb-1 ${config.text}`}
      >
        <Icon className="size-3.5" />
        <span>{config.label}</span>
      </div>
      <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed">
        {segment.content}
      </pre>
    </div>
  );
}

// ============================================================================
// Summary Header
// ============================================================================

function ConversationSummaryHeader({ stats }: { stats: ConversationStats }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-text-muted">AI Conversation</span>
      {stats.sessionCount > 0 && (
        <Badge variant="secondary" className="text-xs">
          {stats.sessionCount} session{stats.sessionCount !== 1 ? "s" : ""}
        </Badge>
      )}
      {stats.messageCount > 0 && (
        <Badge variant="outline" className="text-xs text-text-muted">
          <MessageSquare className="size-3" />
          {stats.messageCount} message{stats.messageCount !== 1 ? "s" : ""}
        </Badge>
      )}
      {stats.findingsCount > 0 && (
        <Badge
          variant="outline"
          className="text-xs text-amber-400 border-amber-500/30"
        >
          <FileText className="size-3" />
          {stats.findingsCount} finding{stats.findingsCount !== 1 ? "s" : ""}
          {Object.keys(stats.findingsBySeverity).length > 0 && (
            <span className="text-text-muted ml-1">
              (
              {Object.entries(stats.findingsBySeverity)
                .map(([sev, count]) => `${count} ${sev}`)
                .join(", ")}
              )
            </span>
          )}
        </Badge>
      )}
      {stats.stepsCompleted > 0 && (
        <Badge variant="outline" className="text-xs text-text-muted">
          <CheckCircle className="size-3" />
          {stats.stepsCompleted} step{stats.stepsCompleted !== 1 ? "s" : ""}
        </Badge>
      )}
      {stats.taskComplete && (
        <Badge
          variant="outline"
          className="text-xs text-emerald-400 border-emerald-500/30"
        >
          <CheckCircle className="size-3" />
          Complete
        </Badge>
      )}
    </div>
  );
}

// ============================================================================
// Segment Renderer
// ============================================================================

function SegmentRenderer({ segment }: { segment: ConversationSegment }) {
  switch (segment.type) {
    case "session-divider":
      return <SessionDivider segment={segment} />;
    case "user":
      return <UserMessage segment={segment} />;
    case "ai":
      return <AiMessage segment={segment} />;
    case "finding":
      return <FindingBanner segment={segment} />;
    case "step-complete":
      return <StepCompleteBanner segment={segment} />;
    case "task-complete":
      return <TaskCompleteBanner />;
    case "orchestrator":
      return <OrchestratorMessage segment={segment} />;
    default:
      return null;
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function AiConversationTab({ runId }: AiConversationTabProps) {
  const { data, isLoading, error } = useTaskRunOutput(runId);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const segments = useMemo(() => {
    if (!data?.output_log) return [];
    return parseOutputLog(data.output_log);
  }, [data]);

  const stats = useMemo(() => computeStats(segments), [segments]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [segments, autoScroll]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading AI conversation...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (segments.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <MessageSquare className="size-12 mx-auto mb-4" />
        <p>No AI conversation output for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <ConversationSummaryHeader stats={stats} />
      </div>

      {/* Conversation Container */}
      <div className="relative">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-[650px] overflow-y-auto space-y-3 pr-2"
        >
          {segments.map((segment, index) => (
            <SegmentRenderer key={`seg-${index}`} segment={segment} />
          ))}
        </div>

        {/* Scroll to Bottom Button */}
        {!autoScroll && (
          <div className="absolute bottom-4 right-4">
            <Button
              variant="outline"
              size="sm"
              onClick={scrollToBottom}
              className="rounded-full bg-surface-raised/80 border-border-subtle/80 shadow-lg"
            >
              <ArrowDown className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
