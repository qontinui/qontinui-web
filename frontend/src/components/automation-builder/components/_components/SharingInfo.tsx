import React from "react";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import type { PermissionLevel } from "@/types/collaboration";

interface SharingInfoProps {
  currentPermission?: PermissionLevel;
  collaboratorCount?: number;
  onOpenShare?: () => void;
}

export function SharingInfo({
  currentPermission,
  collaboratorCount,
  onOpenShare,
}: SharingInfoProps) {
  if (!currentPermission && !collaboratorCount) {
    return null;
  }

  return (
    <div className="mb-4 p-3 bg-surface-canvas/50 border border-border-subtle rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Users className="h-4 w-4" />
          <span>
            {collaboratorCount !== undefined && collaboratorCount > 0
              ? `${collaboratorCount} collaborator${collaboratorCount !== 1 ? "s" : ""}`
              : "Not shared"}
          </span>
        </div>
        {onOpenShare && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenShare}
            className="text-xs text-text-muted hover:text-white h-auto py-1 px-2"
          >
            Manage
          </Button>
        )}
      </div>
    </div>
  );
}
