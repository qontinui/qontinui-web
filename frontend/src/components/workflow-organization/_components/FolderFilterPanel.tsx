/**
 * FolderFilterPanel Component
 *
 * Checkbox list for filtering workflows by folder.
 */

import React from "react";
import { Folder } from "lucide-react";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";
import { WorkflowFolder } from "../types";

export interface FolderFilterPanelProps {
  folders: WorkflowFolder[];
  selectedFolderIds: string[];
  setSelectedFolderIds: (ids: string[]) => void;
}

export function FolderFilterPanel({
  folders,
  selectedFolderIds,
  setSelectedFolderIds,
}: FolderFilterPanelProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Folder className="h-4 w-4 text-muted-foreground" />
        <Label>Folders</Label>
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
        {folders.map((folder) => (
          <div
            key={folder.id}
            className="flex items-center gap-2 py-1 px-2 hover:bg-accent rounded cursor-pointer"
          >
            <Checkbox
              checked={selectedFolderIds.includes(folder.id)}
              onCheckedChange={(checked) => {
                if (checked) {
                  setSelectedFolderIds([...selectedFolderIds, folder.id]);
                } else {
                  setSelectedFolderIds(
                    selectedFolderIds.filter((id) => id !== folder.id)
                  );
                }
              }}
            />
            <span className="text-sm">{folder.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
