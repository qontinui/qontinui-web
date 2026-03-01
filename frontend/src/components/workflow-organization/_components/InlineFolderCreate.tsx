/**
 * Inline Folder Create Component
 *
 * Inline input for creating a new subfolder within the tree.
 */

import React from "react";
import { FolderPlus } from "lucide-react";
import { FolderTreeNode } from "../types";
import { Input } from "../../ui/input";

export interface InlineFolderCreateProps {
  creatingInParentId: string | null;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  onFinishCreate: (save: boolean) => void;
  flatTree: FolderTreeNode[];
}

export function InlineFolderCreate({
  creatingInParentId,
  newFolderName,
  setNewFolderName,
  onFinishCreate,
  flatTree,
}: InlineFolderCreateProps) {
  if (creatingInParentId === null) return null;

  const parentNode = flatTree.find((n) => n.id === creatingInParentId);
  const depth = parentNode?.depth || 0;

  return (
    <div
      className="flex items-center gap-1 py-1 px-2"
      style={{
        paddingLeft: depth * 20 + 44,
      }}
    >
      <FolderPlus className="h-4 w-4 text-muted-foreground" />
      <Input
        value={newFolderName}
        onChange={(e) => setNewFolderName(e.target.value)}
        onBlur={() => onFinishCreate(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onFinishCreate(true);
          } else if (e.key === "Escape") {
            onFinishCreate(false);
          }
        }}
        placeholder="New folder name..."
        className="h-6 py-0 px-1 text-sm flex-1"
      />
    </div>
  );
}
