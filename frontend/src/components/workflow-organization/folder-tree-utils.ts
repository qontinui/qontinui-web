/**
 * Folder Tree Utilities
 *
 * Pure functions and constants for building, filtering, and flattening
 * the folder tree structure.
 */

import { WorkflowFolder, FolderTreeNode } from "./types";
import { Workflow } from "../../lib/action-schema/action-types";

// ============================================================================
// Constants
// ============================================================================

export const FOLDER_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#6366f1", // indigo
];

export const FOLDER_ICONS = [
  "Folder",
  "FolderOpen",
  "FolderPlus",
  "FolderTree",
  "Archive",
  "Bookmark",
  "Tag",
  "Star",
  "Heart",
  "Shield",
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build tree structure from flat folder list
 */
export function buildFolderTree(
  folders: WorkflowFolder[],
  workflows: Workflow[],
  expandedIds: Set<string>
): FolderTreeNode[] {
  const folderMap = new Map<string, FolderTreeNode>();
  const rootFolders: FolderTreeNode[] = [];

  // Count workflows per folder
  const workflowCounts = new Map<string, number>();
  workflows.forEach((workflow) => {
    const folderId =
      (workflow as { folderId?: string | null }).folderId || null;
    if (folderId) {
      workflowCounts.set(folderId, (workflowCounts.get(folderId) || 0) + 1);
    }
  });

  // Create tree nodes
  folders.forEach((folder) => {
    const node: FolderTreeNode = {
      ...folder,
      children: [],
      workflowCount: workflowCounts.get(folder.id) || 0,
      totalWorkflowCount: 0,
      depth: 0,
      expanded: expandedIds.has(folder.id),
    };
    folderMap.set(folder.id, node);
  });

  // Build hierarchy
  folders.forEach((folder) => {
    const node = folderMap.get(folder.id)!;
    if (folder.parentId === null) {
      rootFolders.push(node);
    } else {
      const parent = folderMap.get(folder.parentId);
      if (parent) {
        parent.children.push(node);
        node.depth = parent.depth + 1;
      } else {
        // Parent not found, treat as root
        rootFolders.push(node);
      }
    }
  });

  // Calculate total counts (including subfolders)
  function calculateTotalCounts(node: FolderTreeNode): number {
    let total = node.workflowCount;
    node.children.forEach((child) => {
      total += calculateTotalCounts(child);
    });
    node.totalWorkflowCount = total;
    return total;
  }

  rootFolders.forEach(calculateTotalCounts);

  // Sort by order
  function sortChildren(nodes: FolderTreeNode[]) {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach((node) => sortChildren(node.children));
  }
  sortChildren(rootFolders);

  return rootFolders;
}

/**
 * Flatten tree for drag-and-drop
 */
export function flattenTree(nodes: FolderTreeNode[]): FolderTreeNode[] {
  const result: FolderTreeNode[] = [];
  function traverse(nodes: FolderTreeNode[]) {
    nodes.forEach((node) => {
      result.push(node);
      if (node.expanded && node.children.length > 0) {
        traverse(node.children);
      }
    });
  }
  traverse(nodes);
  return result;
}

/**
 * Filter tree by search query
 */
export function filterTree(
  nodes: FolderTreeNode[],
  query: string
): FolderTreeNode[] {
  if (!query) return nodes;

  const lowerQuery = query.toLowerCase();

  function matchesSearch(node: FolderTreeNode): boolean {
    return node.name.toLowerCase().includes(lowerQuery);
  }

  function filterNode(node: FolderTreeNode): FolderTreeNode | null {
    const matches = matchesSearch(node);
    const filteredChildren = node.children
      .map((child) => filterNode(child))
      .filter((child): child is FolderTreeNode => child !== null);

    if (matches || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
        // Expand nodes that have matching children
        expanded: filteredChildren.length > 0 ? true : node.expanded,
      };
    }

    return null;
  }

  return nodes
    .map((node) => filterNode(node))
    .filter((node): node is FolderTreeNode => node !== null);
}
