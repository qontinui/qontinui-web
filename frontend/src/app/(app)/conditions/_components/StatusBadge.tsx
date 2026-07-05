"use client";

import { Badge } from "@/components/ui/badge";
import type { ConditionStatus } from "../types";

/** Map a run/group status to a badge variant + human label. */
const STATUS_META: Record<
  ConditionStatus,
  { variant: "success" | "destructive" | "warning" | "info"; label: string }
> = {
  pass: { variant: "success", label: "Pass" },
  fail: { variant: "destructive", label: "Fail" },
  error: { variant: "warning", label: "Error" },
  running: { variant: "info", label: "Running" },
};

interface StatusBadgeProps {
  status: ConditionStatus | null | undefined;
  /** Label shown when there is no status yet (default "Never run"). */
  emptyLabel?: string;
}

/**
 * Status pill for a group's last run or an individual run. Colors come from the
 * shared badge variants (`success`/`destructive`/`warning`/`info`) — never
 * hardcoded. A missing status renders a neutral "Never run" pill.
 */
export function StatusBadge({
  status,
  emptyLabel = "Never run",
}: StatusBadgeProps) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {emptyLabel}
      </Badge>
    );
  }
  const meta = STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
