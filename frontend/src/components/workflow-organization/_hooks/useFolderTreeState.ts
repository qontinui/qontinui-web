/**
 * Folder Tree State Hook
 *
 * Manages all useState hooks, useMemo computations, and DnD sensors
 * for the FolderTree component.
 */

import { useState, useMemo } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { WorkflowFolder } from "../types";
import { Workflow } from "../../../lib/action-schema/action-types";
import { buildFolderTree, filterTree, flattenTree } from "../folder-tree-utils";

export function useFolderTreeState(
  folders: WorkflowFolder[],
  workflows: Workflow[]
) {
  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [creatingInParentId, setCreatingInParentId] = useState<string | null>(
    null
  );
  const [newFolderName, setNewFolderName] = useState("");
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);
  const [showIconPicker, setShowIconPicker] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [_overId, _setOverId] = useState<UniqueIdentifier | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);

  // Build tree
  const tree = useMemo(
    () => buildFolderTree(folders, workflows, expandedIds),
    [folders, workflows, expandedIds]
  );

  // Filter tree
  const filteredTree = useMemo(
    () => filterTree(tree, searchQuery),
    [tree, searchQuery]
  );

  // Flatten for rendering
  const flatTree = useMemo(() => flattenTree(filteredTree), [filteredTree]);

  // Count total workflows
  const totalWorkflows = workflows.length;
  const uncategorizedCount = workflows.filter(
    (w) => !(w as { folderId?: string | null }).folderId
  ).length;

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  return {
    // State values
    searchQuery,
    setSearchQuery,
    expandedIds,
    setExpandedIds,
    editingFolderId,
    setEditingFolderId,
    editingName,
    setEditingName,
    creatingInParentId,
    setCreatingInParentId,
    newFolderName,
    setNewFolderName,
    showColorPicker,
    setShowColorPicker,
    showIconPicker,
    setShowIconPicker,
    activeId,
    setActiveId,
    movingFolderId,
    setMovingFolderId,

    // Computed values
    tree,
    filteredTree,
    flatTree,
    totalWorkflows,
    uncategorizedCount,

    // DnD
    sensors,
  };
}
