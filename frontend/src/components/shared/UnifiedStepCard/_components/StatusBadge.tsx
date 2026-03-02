"use client";

import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Loader2, Info } from "lucide-react";
import type { UnifiedExecutionStep } from "@/types/tree-events";

interface StatusBadgeProps {
  status: UnifiedExecutionStep["status"];
}

/**
 * Renders a colored badge indicating the step's execution status.
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  switch (status) {
    case "success":
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Success
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-surface-raised/20 text-text-muted border-border-default/30">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
    default:
      return (
        <Badge className="bg-surface-raised/20 text-text-muted border-border-default/30">
          <Info className="w-3 h-3 mr-1" />
          Info
        </Badge>
      );
  }
}
