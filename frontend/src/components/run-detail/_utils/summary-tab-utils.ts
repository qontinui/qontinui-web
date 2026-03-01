import type { LucideIcon } from "lucide-react";
import {
  Bug,
  Shield,
  Zap,
  CheckCircle2,
  Sparkles,
  Settings,
  FileText,
  FlaskConical,
} from "lucide-react";
import type { TaskRun } from "@/lib/runner-api";
import type { TaskRunView } from "@/lib/task-run-mappers";

// =============================================================================
// Types
// =============================================================================

export interface SummarySegment {
  type: "text" | "user_message";
  content: string;
}

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

/** Accept either full runner TaskRun or the dual-source TaskRunView. */
export type SummaryTabRun = TaskRun | TaskRunView;

export interface SummaryTabProps {
  run: SummaryTabRun;
  onRefresh?: () => void;
}

// =============================================================================
// Constants
// =============================================================================

export const SUMMARY_COLLAPSE_THRESHOLD = 300;

export const SEVERITY_ORDER: FindingSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const SEVERITY_COLORS: Record<
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
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
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
// Pure Functions
// =============================================================================

export function formatDuration(ms: number | null | undefined): string {
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

export function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString();
  } catch {
    return dateString;
  }
}

export function parseSummarySegments(text: string): SummarySegment[] {
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
