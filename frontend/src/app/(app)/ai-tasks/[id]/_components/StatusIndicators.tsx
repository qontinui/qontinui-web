import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  AlertTriangle,
  Bug,
  Lightbulb,
} from "lucide-react";
import type { TaskRunStatus, TaskRunFindingStatus } from "@/types/task-runs";

export function StatusIcon({ status }: { status: TaskRunStatus }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    case "failed":
      return <XCircle className="w-5 h-5 text-red-500" />;
    case "running":
      return <PlayCircle className="w-5 h-5 text-purple-500 animate-pulse" />;
    case "stopped":
      return <Clock className="w-5 h-5 text-muted-foreground" />;
    default:
      return <Clock className="w-5 h-5 text-muted-foreground" />;
  }
}

export function StatusBadge({ status }: { status: TaskRunStatus }) {
  switch (status) {
    case "complete":
      return (
        <Badge className="bg-green-500/10 text-green-500 border-green-500/30">
          Complete
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/10 text-red-500 border-red-500/30">
          Failed
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/30">
          Running
        </Badge>
      );
    case "stopped":
      return (
        <Badge className="bg-muted text-muted-foreground border-border">
          Stopped
        </Badge>
      );
    default:
      return (
        <Badge className="bg-muted text-muted-foreground border-border">
          Unknown
        </Badge>
      );
  }
}

export function SeverityIcon({ severity }: { severity: string }) {
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
      return <Lightbulb className="w-4 h-4 text-muted-foreground" />;
    default:
      return <Bug className="w-4 h-4 text-muted-foreground" />;
  }
}

export function FindingStatusBadge({
  status,
}: {
  status: TaskRunFindingStatus;
}) {
  switch (status) {
    case "resolved":
      return (
        <Badge className="bg-green-500/10 text-green-500 border-green-500/30">
          Resolved
        </Badge>
      );
    case "in_progress":
      return (
        <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/30">
          In Progress
        </Badge>
      );
    case "needs_input":
      return (
        <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/30">
          Needs Input
        </Badge>
      );
    case "wont_fix":
      return (
        <Badge className="bg-muted text-muted-foreground border-border">
          Won&apos;t Fix
        </Badge>
      );
    case "deferred":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">
          Deferred
        </Badge>
      );
    case "detected":
    default:
      return (
        <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/30">
          Detected
        </Badge>
      );
  }
}
