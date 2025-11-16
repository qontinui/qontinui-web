/**
 * Folder Manager Hook
 *
 * Custom hook for managing folder state and operations
 */

import { useState, useCallback, useMemo } from 'react';
import { WorkflowFolder } from './types';
import {
  createFolder,
  validateFolderName,
  wouldCreateCycle,
  reorderFolders,
  getDescendantIds,
} from './folder-utils';

export interface UseFolderManagerOptions {
  initialFolders?: WorkflowFolder[];
  onFoldersChange?: (folders: WorkflowFolder[]) => void;
}

export interface UseFolderManagerResult {
  folders: WorkflowFolder[];
  createNewFolder: (name: string, parentId?: string | null) => WorkflowFolder | null;
  updateFolder: (id: string, updates: Partial<WorkflowFolder>) => void;
  deleteFolder: (id: string) => void;
  moveFolder: (folderId: string, newParentId: string | null) => void;
  duplicateFolder: (id: string) => void;
  resetFolders: () => void;
  importFolders: (folders: WorkflowFolder[]) => void;
}

/**
 * Hook for managing folder state
 */
export function useFolderManager(
  options: UseFolderManagerOptions = {}
): UseFolderManagerResult {
  const { initialFolders = [], onFoldersChange } = options;

  const [folders, setFolders] = useState<WorkflowFolder[]>(initialFolders);

  // Notify parent of changes
  const notifyChange = useCallback(
    (newFolders: WorkflowFolder[]) => {
      setFolders(newFolders);
      onFoldersChange?.(newFolders);
    },
    [onFoldersChange]
  );

  // Create new folder
  const createNewFolder = useCallback(
    (name: string, parentId: string | null = null): WorkflowFolder | null => {
      // Validate name
      const validation = validateFolderName(name, folders, parentId);
      if (!validation.valid) {
        console.error('Invalid folder name:', validation.error);
        return null;
      }

      // Calculate order (append to end of siblings)
      const siblings = folders.filter((f) => f.parentId === parentId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map((f) => f.order)) : -1;

      // Create folder
      const newFolder = createFolder(name, parentId, { order: maxOrder + 1 });

      notifyChange([...folders, newFolder]);
      return newFolder;
    },
    [folders, notifyChange]
  );

  // Update folder
  const updateFolder = useCallback(
    (id: string, updates: Partial<WorkflowFolder>) => {
      const updatedFolders = folders.map((folder) => {
        if (folder.id === id) {
          // Validate name if it's being updated
          if (updates.name !== undefined && updates.name !== folder.name) {
            const validation = validateFolderName(
              updates.name,
              folders,
              folder.parentId,
              id
            );
            if (!validation.valid) {
              console.error('Invalid folder name:', validation.error);
              return folder;
            }
          }

          return {
            ...folder,
            ...updates,
            updatedAt: new Date(),
          };
        }
        return folder;
      });

      notifyChange(updatedFolders);
    },
    [folders, notifyChange]
  );

  // Delete folder
  const deleteFolder = useCallback(
    (id: string) => {
      // Get all descendant folder IDs
      const descendantIds = getDescendantIds(id, folders);
      const allIdsToDelete = [id, ...descendantIds];

      // Remove folder and all descendants
      const updatedFolders = folders.filter((f) => !allIdsToDelete.includes(f.id));

      notifyChange(updatedFolders);
    },
    [folders, notifyChange]
  );

  // Move folder
  const moveFolder = useCallback(
    (folderId: string, newParentId: string | null) => {
      // Check if move would create a cycle
      if (wouldCreateCycle(folderId, newParentId, folders)) {
        console.error('Cannot move folder: would create a cycle');
        return;
      }

      // Reorder folders
      const updatedFolders = reorderFolders(folders, folderId, newParentId);
      notifyChange(updatedFolders);
    },
    [folders, notifyChange]
  );

  // Duplicate folder
  const duplicateFolder = useCallback(
    (id: string) => {
      const folderToDuplicate = folders.find((f) => f.id === id);
      if (!folderToDuplicate) return;

      // Create duplicate name
      let duplicateName = `${folderToDuplicate.name} (Copy)`;
      let counter = 1;
      while (
        folders.some(
          (f) =>
            f.name === duplicateName &&
            f.parentId === folderToDuplicate.parentId
        )
      ) {
        counter++;
        duplicateName = `${folderToDuplicate.name} (Copy ${counter})`;
      }

      // Create duplicate
      const duplicate = createFolder(duplicateName, folderToDuplicate.parentId, {
        color: folderToDuplicate.color,
        icon: folderToDuplicate.icon,
        order: folderToDuplicate.order + 1,
      });

      notifyChange([...folders, duplicate]);
    },
    [folders, notifyChange]
  );

  // Reset folders
  const resetFolders = useCallback(() => {
    notifyChange(initialFolders);
  }, [initialFolders, notifyChange]);

  // Import folders
  const importFoldersCallback = useCallback(
    (newFolders: WorkflowFolder[]) => {
      notifyChange(newFolders);
    },
    [notifyChange]
  );

  return {
    folders,
    createNewFolder,
    updateFolder,
    deleteFolder,
    moveFolder,
    duplicateFolder,
    resetFolders,
    importFolders: importFoldersCallback,
  };
}

/**
 * Hook for managing folder expansion state
 */
export function useFolderExpansion(initialExpandedIds: string[] = []) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(initialExpandedIds)
  );

  const toggleFolder = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandFolder = useCallback((id: string) => {
    setExpandedIds((prev) => new Set(prev).add(id));
  }, []);

  const collapseFolder = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const expandAll = useCallback((folderIds: string[]) => {
    setExpandedIds(new Set(folderIds));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const isExpanded = useCallback(
    (id: string) => {
      return expandedIds.has(id);
    },
    [expandedIds]
  );

  return {
    expandedIds,
    toggleFolder,
    expandFolder,
    collapseFolder,
    expandAll,
    collapseAll,
    isExpanded,
  };
}

/**
 * Hook for managing folder selection
 */
export function useFolderSelection(initialSelectedId?: string | null) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    initialSelectedId ?? null
  );

  const selectFolder = useCallback((id: string | null) => {
    setSelectedFolderId(id);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFolderId(null);
  }, []);

  const isSelected = useCallback(
    (id: string) => {
      return selectedFolderId === id;
    },
    [selectedFolderId]
  );

  return {
    selectedFolderId,
    selectFolder,
    clearSelection,
    isSelected,
  };
}
