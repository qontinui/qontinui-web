/**
 * Folder Tree Footer Component
 *
 * Breadcrumb display showing the currently selected folder path.
 */

import React from "react";
import { WorkflowFolder } from "../types";

export interface FolderTreeFooterProps {
  selectedFolderId: string | null | undefined;
  folders: WorkflowFolder[];
}

export function FolderTreeFooter({
  selectedFolderId,
  folders,
}: FolderTreeFooterProps) {
  return (
    <div className="p-2 border-t text-xs text-muted-foreground">
      {selectedFolderId && selectedFolderId !== "uncategorized" && (
        <div className="flex items-center gap-1">
          {(() => {
            const folder = folders.find((f) => f.id === selectedFolderId);
            if (!folder) return null;

            const breadcrumbs: string[] = [];
            let current: WorkflowFolder | undefined = folder;
            while (current) {
              breadcrumbs.unshift(current.name);
              current = folders.find((f) => f.id === current?.parentId);
            }

            return breadcrumbs.join(" / ");
          })()}
        </div>
      )}
      {selectedFolderId === null && <div>Viewing all workflows</div>}
      {selectedFolderId === "uncategorized" && (
        <div>Workflows without a folder</div>
      )}
    </div>
  );
}
