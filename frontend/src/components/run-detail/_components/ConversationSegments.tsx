import { Badge } from "@/components/ui/badge";
import {
  Minus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  FileText,
  Flag,
  User,
  Bot,
  Lightbulb,
  CheckSquare,
  BookOpen,
  Cog,
} from "lucide-react";
import type {
  ConversationSegment,
  SessionDividerSegment,
  AiSegment,
  UserSegment,
  FindingSegment,
  StepCompleteSegment,
  OrchestratorSegment,
} from "../_types/ai-conversation-types";

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

export function SegmentRenderer({ segment }: { segment: ConversationSegment }) {
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
