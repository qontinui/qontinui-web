"use client";

import { Badge } from "@/components/ui/badge";
import { Clock, Loader2, CheckCircle2, XCircle, Ban } from "lucide-react";
import type { JobStatus } from "@/types/rag-dashboard";

interface JobStatusBadgeProps {
  status: JobStatus;
}

const statusConfig: Record<
  JobStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  pending: {
    label: "Pending",
    className: "border-yellow-500/50 text-yellow-500 bg-yellow-500/10",
    icon: Clock,
  },
  in_progress: {
    label: "In Progress",
    className: "border-brand-primary/50 text-brand-primary bg-brand-primary/10",
    icon: Loader2,
  },
  completed: {
    label: "Completed",
    className: "border-brand-success/50 text-brand-success bg-brand-success/10",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "border-red-500/50 text-red-500 bg-red-500/10",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    className: "border-text-muted/50 text-text-muted bg-text-muted/10",
    icon: Ban,
  },
};

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={config.className}>
      <Icon
        className={`w-3 h-3 mr-1 ${
          status === "in_progress" ? "animate-spin" : ""
        }`}
      />
      {config.label}
    </Badge>
  );
}
