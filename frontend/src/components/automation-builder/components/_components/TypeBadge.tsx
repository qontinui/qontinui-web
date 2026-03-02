import React from "react";
import { PermissionBadge } from "../PermissionBadge";
import type { PermissionLevel } from "@/types/collaboration";

interface TypeBadgeProps {
  currentViewMode: string;
  isLinear: boolean;
  currentPermission?: PermissionLevel;
}

export function TypeBadge({
  currentViewMode,
  isLinear,
  currentPermission,
}: TypeBadgeProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <span
        className={
          currentViewMode === "sequential"
            ? "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-primary/10 text-brand-primary border border-brand-primary/30"
            : "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-success/10 text-brand-success border border-brand-success/30"
        }
      >
        {isLinear ? "Sequential Workflow" : "Graph Workflow"}
      </span>
      {currentPermission && (
        <PermissionBadge permission={currentPermission} size="sm" />
      )}
    </div>
  );
}
