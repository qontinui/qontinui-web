import React from "react";
import {
  CheckSquare,
  Square,
  Loader2,
  Tag,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";

interface BulkActionsBarProps {
  selectedCount: number;
  onToggleSelectAll: () => void;
  onBulkApprove: () => void;
  onBulkReject: () => void;
  onSetStateHint: () => void;
  bulkInProgress: boolean;
}

export function BulkActionsBar({
  selectedCount,
  onToggleSelectAll,
  onBulkApprove,
  onBulkReject,
  onSetStateHint,
  bulkInProgress,
}: BulkActionsBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onToggleSelectAll}>
          {selectedCount > 0 ? (
            <CheckSquare className="h-4 w-4 mr-2" />
          ) : (
            <Square className="h-4 w-4 mr-2" />
          )}
          {selectedCount > 0
            ? `${selectedCount} selected`
            : "Select all pending"}
        </Button>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-2">
          <DestructiveButton
            size="sm"
            className="text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
            onClick={onBulkApprove}
            disabled={bulkInProgress}
          >
            {bulkInProgress ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Approve {selectedCount}
          </DestructiveButton>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={onBulkReject}
            disabled={bulkInProgress}
          >
            {bulkInProgress ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4 mr-2" />
            )}
            Reject {selectedCount}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSetStateHint}
            disabled={bulkInProgress}
          >
            <Tag className="h-4 w-4 mr-2" />
            Set State Hint
          </Button>
        </div>
      )}
    </div>
  );
}
