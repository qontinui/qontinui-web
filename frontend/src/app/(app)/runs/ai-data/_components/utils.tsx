import { Badge } from "@/components/ui/badge";

export function getSeverityBadge(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "high":
      return (
        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
          High
        </Badge>
      );
    case "medium":
      return <Badge variant="warning">Medium</Badge>;
    case "low":
      return <Badge variant="info">Low</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}

export function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "completed":
    case "complete":
      return <Badge variant="success">Completed</Badge>;
    case "running":
    case "in_progress":
      return <Badge variant="info">Running</Badge>;
    case "failed":
    case "error":
      return <Badge variant="destructive">Failed</Badge>;
    case "stopped":
      return <Badge variant="warning">Stopped</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString();
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.round(secs % 60);
  return `${mins}m ${remainSecs}s`;
}

export function tryFormatJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
