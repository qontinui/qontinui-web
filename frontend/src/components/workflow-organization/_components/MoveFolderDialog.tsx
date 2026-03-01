/**
 * Move Folder Dialog Component
 *
 * Dialog for moving a folder to a new parent location in the tree.
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderTreeIcon,
  Search,
} from "lucide-react";
import { WorkflowFolder } from "../types";
import { Workflow } from "../../../lib/action-schema/action-types";
import { Input } from "../../ui/input";
import { ScrollArea } from "../../ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { buildFolderTree, filterTree, flattenTree } from "../folder-tree-utils";
import { cn } from "../../../lib/utils";

export interface MoveFolderDialogProps {
  movingFolderId: string | null;
  onClose: () => void;
  folders: WorkflowFolder[];
  workflows: Workflow[];
  onMoveFolder: (folderId: string, newParentId: string | null) => void;
}

export function MoveFolderDialog({
  movingFolderId,
  onClose,
  folders,
  workflows,
  onMoveFolder,
}: MoveFolderDialogProps) {
  const [moveDialogSearchQuery, setMoveDialogSearchQuery] = useState("");
  const [moveDialogExpandedIds, setMoveDialogExpandedIds] = useState<
    Set<string>
  >(new Set());

  // Build tree for move dialog (exclude the folder being moved)
  const moveDialogTree = useMemo(
    () =>
      buildFolderTree(
        folders.filter((f) => f.id !== movingFolderId),
        workflows,
        moveDialogExpandedIds
      ),
    [folders, workflows, moveDialogExpandedIds, movingFolderId]
  );

  // Filter move dialog tree
  const filteredMoveDialogTree = useMemo(
    () => filterTree(moveDialogTree, moveDialogSearchQuery),
    [moveDialogTree, moveDialogSearchQuery]
  );

  // Flatten move dialog tree
  const flatMoveDialogTree = useMemo(
    () => flattenTree(filteredMoveDialogTree),
    [filteredMoveDialogTree]
  );

  // Get moving folder
  const movingFolder = useMemo(
    () => folders.find((f) => f.id === movingFolderId),
    [folders, movingFolderId]
  );

  const handleMoveDialogToggle = useCallback((id: string) => {
    setMoveDialogExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleMoveFolder = useCallback(
    (targetFolderId: string | null) => {
      if (movingFolderId) {
        onMoveFolder(movingFolderId, targetFolderId);
        onClose();
        setMoveDialogSearchQuery("");
        setMoveDialogExpandedIds(new Set());
      }
    },
    [movingFolderId, onMoveFolder, onClose]
  );

  return (
    <Dialog
      open={!!movingFolderId}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setMoveDialogSearchQuery("");
          setMoveDialogExpandedIds(new Set());
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move &quot;{movingFolder?.name}&quot; to...</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search folders..."
              value={moveDialogSearchQuery}
              onChange={(e) => setMoveDialogSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Folder list */}
          <ScrollArea className="h-96">
            <div className="space-y-1 pr-4">
              {/* Root option */}
              <button
                onClick={() => handleMoveFolder(null)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors hover:bg-accent"
                )}
              >
                <FolderTreeIcon className="h-4 w-4" />
                <span>Root (Top Level)</span>
              </button>

              {/* Folder tree */}
              {flatMoveDialogTree.map((node) => {
                const hasChildren = node.children.length > 0;
                const FolderIcon = node.expanded ? FolderOpen : Folder;

                return (
                  <div
                    key={node.id}
                    className="flex items-center gap-1 px-3 py-2 rounded-md transition-colors hover:bg-accent"
                    style={{ paddingLeft: `${node.depth * 20 + 12}px` }}
                  >
                    {/* Expand/collapse */}
                    {hasChildren ? (
                      <button
                        onClick={() => handleMoveDialogToggle(node.id)}
                        className="flex-shrink-0 p-0.5 hover:bg-accent rounded"
                      >
                        {node.expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    ) : (
                      <div className="w-5" />
                    )}

                    {/* Folder button */}
                    <button
                      onClick={() => handleMoveFolder(node.id)}
                      className="flex-1 flex items-center gap-2 text-left"
                    >
                      <FolderIcon
                        className="h-4 w-4 flex-shrink-0"
                        style={{ color: node.color || undefined }}
                      />
                      <span className="truncate">{node.name}</span>
                    </button>
                  </div>
                );
              })}

              {/* Empty state */}
              {flatMoveDialogTree.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {moveDialogSearchQuery
                    ? "No folders found"
                    : "No folders available"}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
