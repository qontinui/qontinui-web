/**
 * Folder Tree Handlers Hook
 *
 * Extracts all useCallback handlers from the FolderTree component.
 */

import React, { useCallback } from "react";
import {
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { WorkflowFolder, FolderTreeNode, DragItem } from "../types";

interface UseFolderTreeHandlersProps {
  // Props from FolderTree
  folders: WorkflowFolder[];
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onUpdateFolder: (id: string, updates: Partial<WorkflowFolder>) => void;
  onDeleteFolder: (id: string) => void;
  onMoveFolder: (folderId: string, newParentId: string | null) => void;
  onMoveWorkflow: (workflowId: string, folderId: string | null) => void;

  // State from useFolderTreeState
  selectedFolderId: string | null | undefined;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  editingFolderId: string | null;
  setEditingFolderId: React.Dispatch<React.SetStateAction<string | null>>;
  editingName: string;
  setEditingName: React.Dispatch<React.SetStateAction<string>>;
  creatingInParentId: string | null;
  setCreatingInParentId: React.Dispatch<React.SetStateAction<string | null>>;
  newFolderName: string;
  setNewFolderName: React.Dispatch<React.SetStateAction<string>>;
  setActiveId: React.Dispatch<React.SetStateAction<UniqueIdentifier | null>>;
  flatTree: FolderTreeNode[];
}

export function useFolderTreeHandlers({
  folders,
  onSelectFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onMoveFolder,
  onMoveWorkflow,
  selectedFolderId,
  setExpandedIds,
  editingFolderId,
  setEditingFolderId,
  editingName,
  setEditingName,
  creatingInParentId,
  setCreatingInParentId,
  newFolderName,
  setNewFolderName,
  setActiveId,
  flatTree,
}: UseFolderTreeHandlersProps) {
  const handleToggle = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [setExpandedIds]
  );

  const handleExpandAll = useCallback(() => {
    const allIds = new Set(folders.map((f) => f.id));
    setExpandedIds(allIds);
  }, [folders, setExpandedIds]);

  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, [setExpandedIds]);

  const handleStartEdit = useCallback(
    (id: string, name: string) => {
      setEditingFolderId(id);
      setEditingName(name);
    },
    [setEditingFolderId, setEditingName]
  );

  const handleFinishEdit = useCallback(
    (save: boolean) => {
      if (save && editingFolderId && editingName.trim()) {
        onUpdateFolder(editingFolderId, { name: editingName.trim() });
      }
      setEditingFolderId(null);
      setEditingName("");
    },
    [
      editingFolderId,
      editingName,
      onUpdateFolder,
      setEditingFolderId,
      setEditingName,
    ]
  );

  const handleCreateSubfolder = useCallback(
    (parentId: string) => {
      setCreatingInParentId(parentId);
      setNewFolderName("");
      // Expand parent
      setExpandedIds((prev) => new Set(prev).add(parentId));
    },
    [setCreatingInParentId, setNewFolderName, setExpandedIds]
  );

  const handleFinishCreate = useCallback(
    (save: boolean) => {
      if (save && newFolderName.trim()) {
        onCreateFolder(newFolderName.trim(), creatingInParentId);
      }
      setCreatingInParentId(null);
      setNewFolderName("");
    },
    [
      newFolderName,
      creatingInParentId,
      onCreateFolder,
      setCreatingInParentId,
      setNewFolderName,
    ]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(event.active.id);
    },
    [setActiveId]
  );

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Drag over handling can be implemented here if needed
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const dragData = active.data.current as DragItem;
        const dropData = over.data.current as DragItem | undefined;

        if (dragData.type === "folder") {
          // Moving a folder
          const newParentId = dropData?.type === "folder" ? dropData.id : null;
          // Prevent moving folder into itself or its descendants
          const folder = folders.find((f) => f.id === dragData.id);
          if (folder && newParentId !== folder.id) {
            onMoveFolder(dragData.id, newParentId);
          }
        } else if (dragData.type === "workflow") {
          // Moving a workflow
          const newFolderId = dropData?.type === "folder" ? dropData.id : null;
          onMoveWorkflow(dragData.id, newFolderId);
        }
      }

      setActiveId(null);
    },
    [folders, onMoveFolder, onMoveWorkflow, setActiveId]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedFolderId) return;

      const currentIndex = flatTree.findIndex((n) => n.id === selectedFolderId);
      if (currentIndex === -1) return;

      const currentNode = flatTree[currentIndex];
      if (!currentNode) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (currentIndex < flatTree.length - 1) {
            const nextNode = flatTree[currentIndex + 1];
            if (nextNode) {
              onSelectFolder(nextNode.id);
            }
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (currentIndex > 0) {
            const prevNode = flatTree[currentIndex - 1];
            if (prevNode) {
              onSelectFolder(prevNode.id);
            }
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (currentNode.children.length > 0 && !currentNode.expanded) {
            handleToggle(currentNode.id);
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (currentNode.expanded) {
            handleToggle(currentNode.id);
          } else if (currentNode.parentId) {
            onSelectFolder(currentNode.parentId);
          }
          break;

        case "Enter":
          e.preventDefault();
          if (currentNode && currentNode.children.length > 0) {
            handleToggle(currentNode.id);
          }
          break;

        case "Delete":
          e.preventDefault();
          if (
            currentNode &&
            window.confirm(`Delete folder "${currentNode.name}"?`)
          ) {
            onDeleteFolder(currentNode.id);
          }
          break;
      }
    },
    [selectedFolderId, flatTree, onSelectFolder, handleToggle, onDeleteFolder]
  );

  return {
    handleToggle,
    handleExpandAll,
    handleCollapseAll,
    handleStartEdit,
    handleFinishEdit,
    handleCreateSubfolder,
    handleFinishCreate,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleKeyDown,
  };
}
