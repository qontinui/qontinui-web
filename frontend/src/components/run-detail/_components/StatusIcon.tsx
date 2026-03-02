import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

export function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
    case "complete":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "running":
      return <Activity className="size-4 text-blue-500 animate-pulse" />;
    case "skipped":
    case "pending":
      return <AlertCircle className="size-4 text-yellow-500" />;
    default:
      return <Clock className="size-4 text-text-muted" />;
  }
}
