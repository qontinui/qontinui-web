"use client";

import { User, Users, GitMerge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConflictFooterProps {
  loading: boolean;
  showBulkActions: boolean;
  onResolve: (resolution: "local" | "remote" | "merge") => void;
  onResolveAll: (resolution: "local" | "remote") => void;
}

export function ConflictFooter({
  loading,
  showBulkActions,
  onResolve,
  onResolveAll,
}: ConflictFooterProps) {
  return (
    <>
      <div className="flex gap-2 flex-1">
        {showBulkActions && (
          <>
            <Button
              variant="outline"
              onClick={() => onResolveAll("local")}
              disabled={loading}
              className="flex-1"
              data-ui-id="dialog-conflict-resolution-keep-all-mine-btn"
            >
              Keep All Mine
            </Button>
            <Button
              variant="outline"
              onClick={() => onResolveAll("remote")}
              disabled={loading}
              className="flex-1"
              data-ui-id="dialog-conflict-resolution-keep-all-theirs-btn"
            >
              Keep All Theirs
            </Button>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => onResolve("local")}
          disabled={loading}
          data-ui-id="dialog-conflict-resolution-keep-mine-btn"
        >
          <User className="mr-2 h-4 w-4" />
          Keep Mine
        </Button>
        <Button
          variant="outline"
          onClick={() => onResolve("remote")}
          disabled={loading}
          data-ui-id="dialog-conflict-resolution-keep-theirs-btn"
        >
          <Users className="mr-2 h-4 w-4" />
          Keep Theirs
        </Button>
        <Button
          onClick={() => onResolve("merge")}
          disabled={loading}
          data-ui-id="dialog-conflict-resolution-merge-btn"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <GitMerge className="mr-2 h-4 w-4" />
          )}
          Merge Changes
        </Button>
      </div>
    </>
  );
}
