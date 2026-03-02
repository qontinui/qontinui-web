import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";

type StatusIconVariant = "default" | "compact";

interface StatusIconProps {
  status: string;
  /** "default" uses size-4 icons; "compact" uses size-3.5 with shrink-0 */
  variant?: StatusIconVariant;
}

/**
 * Renders a colored icon representing a step/stage status.
 *
 * Supports statuses: success, complete, failed, running, skipped, pending, and unknown/default.
 */
export function StatusIcon({ status, variant = "default" }: StatusIconProps) {
  const isCompact = variant === "compact";
  const sizeClass = isCompact ? "size-3.5 shrink-0" : "size-4";

  switch (status) {
    case "success":
    case "complete":
      return <CheckCircle2 className={`${sizeClass} text-green-500`} />;
    case "failed":
      return <XCircle className={`${sizeClass} text-red-500`} />;
    case "running":
      return isCompact ? (
        <Loader2 className={`${sizeClass} text-blue-400 animate-spin`} />
      ) : (
        <Activity className={`${sizeClass} text-blue-500 animate-pulse`} />
      );
    case "skipped":
    case "pending":
      return isCompact ? (
        <div className={`${sizeClass} rounded-full bg-zinc-600`} />
      ) : (
        <AlertCircle className={`${sizeClass} text-yellow-500`} />
      );
    default:
      return isCompact ? (
        <div className={`${sizeClass} rounded-full bg-border-subtle`} />
      ) : (
        <Clock className={`${sizeClass} text-text-muted`} />
      );
  }
}
