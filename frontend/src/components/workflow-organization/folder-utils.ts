/**
 * Folder Utilities
 *
 * Helper functions for folder operations
 */

import { WorkflowFolder } from "./types";
import { Workflow } from "../../lib/action-schema/action-types";

/**
 * Generate a unique folder ID
 */
export function generateFolderId(): string {
  return `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new folder
 */
export function createFolder(
  name: string,
  parentId: string | null = null,
  options?: {
    color?: string;
    icon?: string;
    order?: number;
  }
): WorkflowFolder {
  return {
    id: generateFolderId(),
    name,
    parentId,
    color: options?.color,
    icon: options?.icon,
    createdAt: new Date(),
    updatedAt: new Date(),
    order: options?.order ?? 0,
    expanded: false,
  };
}

/**
 * Get all descendant folder IDs
 */
export function getDescendantIds(
  folderId: string,
  folders: WorkflowFolder[]
): string[] {
  const descendants: string[] = [];
  const children = folders.filter((f) => f.parentId === folderId);

  children.forEach((child) => {
    descendants.push(child.id);
    descendants.push(...getDescendantIds(child.id, folders));
  });

  return descendants;
}

/**
 * Check if moving a folder would create a cycle
 */
export function wouldCreateCycle(
  folderId: string,
  newParentId: string | null,
  folders: WorkflowFolder[]
): boolean {
  if (newParentId === null) return false;
  if (folderId === newParentId) return true;

  const descendants = getDescendantIds(folderId, folders);
  return descendants.includes(newParentId);
}

/**
 * Get folder path (breadcrumb)
 */
export function getFolderPath(
  folderId: string,
  folders: WorkflowFolder[]
): string[] {
  const path: string[] = [];
  let current = folders.find((f) => f.id === folderId);

  while (current) {
    path.unshift(current.name);
    current = folders.find((f) => f.id === current?.parentId);
  }

  return path;
}

/**
 * Get all workflows in a folder (including subfolders)
 */
export function getWorkflowsInFolder(
  folderId: string | null,
  workflows: Workflow[],
  folders: WorkflowFolder[],
  includeSubfolders: boolean = true
): Workflow[] {
  if (folderId === null) {
    return workflows;
  }

  if (folderId === "uncategorized") {
    return workflows.filter((w) => !(w as { folderId?: string }).folderId);
  }

  const folderIds = includeSubfolders
    ? [folderId, ...getDescendantIds(folderId, folders)]
    : [folderId];

  return workflows.filter((w) => {
    const workflowFolderId = (w as { folderId?: string }).folderId;
    return workflowFolderId && folderIds.includes(workflowFolderId);
  });
}

/**
 * Count workflows in folder
 */
export function countWorkflowsInFolder(
  folderId: string,
  workflows: Workflow[],
  includeSubfolders: boolean = false
): number {
  if (includeSubfolders) {
    // This requires folders array, so we can't implement it here
    // It's better to do this in the tree building logic
    return 0;
  }

  return workflows.filter((w) => (w as { folderId?: string }).folderId === folderId).length;
}

/**
 * Sort folders by order and name
 */
export function sortFolders(folders: WorkflowFolder[]): WorkflowFolder[] {
  return [...folders].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Reorder folders after moving
 */
export function reorderFolders(
  folders: WorkflowFolder[],
  movedFolderId: string,
  newParentId: string | null,
  insertIndex?: number
): WorkflowFolder[] {
  const movedFolder = folders.find((f) => f.id === movedFolderId);
  if (!movedFolder) return folders;

  // Get siblings in new parent
  const siblings = folders.filter(
    (f) => f.parentId === newParentId && f.id !== movedFolderId
  );

  // Calculate new order
  const newOrder =
    insertIndex !== undefined
      ? insertIndex
      : siblings.length > 0
        ? Math.max(...siblings.map((f) => f.order)) + 1
        : 0;

  // Update moved folder
  const updatedFolders = folders.map((f) => {
    if (f.id === movedFolderId) {
      return {
        ...f,
        parentId: newParentId,
        order: newOrder,
        updatedAt: new Date(),
      };
    }
    return f;
  });

  return updatedFolders;
}

/**
 * Validate folder name
 */
export function validateFolderName(
  name: string,
  existingFolders: WorkflowFolder[],
  parentId: string | null,
  excludeFolderId?: string
): { valid: boolean; error?: string } {
  // Check if name is empty
  if (!name.trim()) {
    return { valid: false, error: "Folder name cannot be empty" };
  }

  // Check if name is too long
  if (name.length > 100) {
    return {
      valid: false,
      error: "Folder name is too long (max 100 characters)",
    };
  }

  // Check for duplicate names in same parent
  const siblings = existingFolders.filter(
    (f) => f.parentId === parentId && f.id !== excludeFolderId
  );

  const duplicate = siblings.find(
    (f) => f.name.toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    return {
      valid: false,
      error: "A folder with this name already exists in this location",
    };
  }

  return { valid: true };
}

/**
 * Find folder by path
 */
export function findFolderByPath(
  path: string[],
  folders: WorkflowFolder[]
): WorkflowFolder | null {
  let currentParentId: string | null = null;

  for (const name of path) {
    const folder = folders.find(
      (f) =>
        f.name.toLowerCase() === name.toLowerCase() &&
        f.parentId === currentParentId
    );

    if (!folder) return null;
    currentParentId = folder.id;
  }

  return folders.find((f) => f.id === currentParentId) || null;
}

/**
 * Export folders to JSON
 */
export function exportFolders(folders: WorkflowFolder[]): string {
  return JSON.stringify(folders, null, 2);
}

/**
 * Import folders from JSON
 */
export function importFolders(json: string): WorkflowFolder[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      throw new Error("Invalid folder data: expected array");
    }

    return parsed.map((folder) => ({
      ...folder,
      createdAt: new Date(folder.createdAt),
      updatedAt: new Date(folder.updatedAt),
    }));
  } catch (error) {
    throw new Error(`Failed to import folders: ${error}`);
  }
}

/**
 * Get folder statistics
 */
export interface FolderStats {
  totalFolders: number;
  maxDepth: number;
  avgChildrenPerFolder: number;
  emptyFolders: number;
  foldersWithColor: number;
  foldersWithIcon: number;
}

export function getFolderStats(
  folders: WorkflowFolder[],
  workflows: Workflow[]
): FolderStats {
  const depths: number[] = [];

  function calculateDepth(folderId: string): number {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder || !folder.parentId) return 0;
    return 1 + calculateDepth(folder.parentId);
  }

  folders.forEach((f) => {
    depths.push(calculateDepth(f.id));
  });

  const childrenCounts = folders.map(
    (f) => folders.filter((child) => child.parentId === f.id).length
  );

  const emptyFolders = folders.filter((f) => {
    const hasChildren = folders.some((child) => child.parentId === f.id);
    const hasWorkflows = workflows.some(
      (w) => (w as { folderId?: string }).folderId === f.id
    );
    return !hasChildren && !hasWorkflows;
  }).length;

  return {
    totalFolders: folders.length,
    maxDepth: depths.length > 0 ? Math.max(...depths) : 0,
    avgChildrenPerFolder:
      childrenCounts.length > 0
        ? childrenCounts.reduce((a, b) => a + b, 0) / childrenCounts.length
        : 0,
    emptyFolders,
    foldersWithColor: folders.filter((f) => f.color).length,
    foldersWithIcon: folders.filter((f) => f.icon).length,
  };
}
