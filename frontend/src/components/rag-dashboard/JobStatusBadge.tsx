"use client";

import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
} from "lucide-react";
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
    className: "border-[#00D9FF]/50 text-[#00D9FF] bg-[#00D9FF]/10",
    icon: Loader2,
  },
  completed: {
    label: "Completed",
    className: "border-[#00FF88]/50 text-[#00FF88] bg-[#00FF88]/10",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "border-red-500/50 text-red-500 bg-red-500/10",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    className: "border-gray-500/50 text-gray-500 bg-gray-500/10",
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
