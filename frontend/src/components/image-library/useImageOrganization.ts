/**
 * Image Organization Hook
 *
 * Manages image folders, collections, tags, and organization state
 */

import { useState, useCallback, useMemo } from "react";
import {
  ImageFolder,
  ImageFolderTreeNode,
  ImageCollection,
  ImageFilter,
  SavedImageFilter,
  ImageTag,
  ImageWithMetadata,
} from "./types";

export interface UseImageOrganizationProps {
  images: ImageWithMetadata[];
  onUpdateImage?: (image: ImageWithMetadata) => void;
}

export function useImageOrganization({
  images,
  onUpdateImage,
}: UseImageOrganizationProps) {
  // Folder state
  const [folders, setFolders] = useState<ImageFolder[]>([]);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    new Set()
  );

  // Collection state
  const [collections, setCollections] = useState<ImageCollection[]>([]);

  // Filter state
  const [currentFilter, setCurrentFilter] = useState<ImageFilter>({});
  const [savedFilters, setSavedFilters] = useState<SavedImageFilter[]>([]);

  // Tag state
  const [availableTags, setAvailableTags] = useState<ImageTag[]>([]);

  // Selection state
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(
    new Set()
  );

  // ============================================================================
  // Folder Operations
  // ============================================================================

  const createFolder = useCallback(
    (name: string, parentId: string | null = null, color?: string) => {
      const newFolder: ImageFolder = {
        id: `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        parentId,
        color: color || "#3b82f6",
        createdAt: new Date(),
        updatedAt: new Date(),
        order: folders.filter((f) => f.parentId === parentId).length,
        expanded: true,
      };
      setFolders((prev) => [...prev, newFolder]);
      return newFolder;
    },
    [folders]
  );

  const updateFolder = useCallback(
    (id: string, updates: Partial<ImageFolder>) => {
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === id
            ? { ...folder, ...updates, updatedAt: new Date() }
            : folder
        )
      );
    },
    []
  );

  const deleteFolder = useCallback(
    (id: string) => {
      // Move images in folder to parent or root
      const folder = folders.find((f) => f.id === id);
      if (!folder) return;

      // Update images in this folder
      images.forEach((image) => {
        if (image.folderId === id) {
          onUpdateImage?.({ ...image, folderId: folder.parentId });
        }
      });

      // Delete folder and move subfolders to parent
      setFolders((prev) => {
        const updated = prev.filter((f) => f.id !== id);
        return updated.map((f) =>
          f.parentId === id ? { ...f, parentId: folder.parentId } : f
        );
      });
    },
    [folders, images, onUpdateImage]
  );

  const moveFolder = useCallback(
    (folderId: string, newParentId: string | null) => {
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === folderId
            ? { ...folder, parentId: newParentId, updatedAt: new Date() }
            : folder
        )
      );
    },
    []
  );

  const toggleFolderExpanded = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // Build folder tree
  const folderTree = useMemo(() => {
    return buildFolderTree(folders, images, expandedFolderIds);
  }, [folders, images, expandedFolderIds]);

  // ============================================================================
  // Collection Operations
  // ============================================================================

  const createCollection = useCallback(
    (name: string, description?: string, imageIds: string[] = []) => {
      const newCollection: ImageCollection = {
        id: `collection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        description,
        imageIds,
        thumbnailIds: imageIds.slice(0, 4),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setCollections((prev) => [...prev, newCollection]);
      return newCollection;
    },
    []
  );

  const updateCollection = useCallback(
    (id: string, updates: Partial<ImageCollection>) => {
      setCollections((prev) =>
        prev.map((collection) =>
          collection.id === id
            ? {
                ...collection,
                ...updates,
                thumbnailIds: (updates.imageIds || collection.imageIds).slice(
                  0,
                  4
                ),
                updatedAt: new Date(),
              }
            : collection
        )
      );
    },
    []
  );

  const deleteCollection = useCallback((id: string) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const addImagesToCollection = useCallback(
    (collectionId: string, imageIds: string[]) => {
      setCollections((prev) =>
        prev.map((collection) =>
          collection.id === collectionId
            ? {
                ...collection,
                imageIds: [...new Set([...collection.imageIds, ...imageIds])],
                updatedAt: new Date(),
              }
            : collection
        )
      );
    },
    []
  );

  const removeImagesFromCollection = useCallback(
    (collectionId: string, imageIds: string[]) => {
      setCollections((prev) =>
        prev.map((collection) =>
          collection.id === collectionId
            ? {
                ...collection,
                imageIds: collection.imageIds.filter(
                  (id) => !imageIds.includes(id)
                ),
                updatedAt: new Date(),
              }
            : collection
        )
      );
    },
    []
  );

  // ============================================================================
  // Tag Operations
  // ============================================================================

  const addTagToImages = useCallback(
    (imageIds: string[], tagName: string) => {
      imageIds.forEach((imageId) => {
        const image = images.find((img) => img.id === imageId);
        if (image) {
          const tags = image.tags || [];
          if (!tags.includes(tagName)) {
            onUpdateImage?.({ ...image, tags: [...tags, tagName] });
          }
        }
      });

      // Update available tags
      setAvailableTags((prev) => {
        const existing = prev.find((t) => t.name === tagName);
        if (existing) {
          return prev.map((t) =>
            t.name === tagName ? { ...t, count: t.count + imageIds.length } : t
          );
        }
        return [
          ...prev,
          {
            id: `tag-${Date.now()}`,
            name: tagName,
            count: imageIds.length,
          },
        ];
      });
    },
    [images, onUpdateImage]
  );

  const removeTagFromImages = useCallback(
    (imageIds: string[], tagName: string) => {
      imageIds.forEach((imageId) => {
        const image = images.find((img) => img.id === imageId);
        if (image) {
          const tags = image.tags || [];
          onUpdateImage?.({
            ...image,
            tags: tags.filter((t) => t !== tagName),
          });
        }
      });

      // Update available tags
      setAvailableTags((prev) =>
        prev
          .map((t) =>
            t.name === tagName ? { ...t, count: t.count - imageIds.length } : t
          )
          .filter((t) => t.count > 0)
      );
    },
    [images, onUpdateImage]
  );

  // ============================================================================
  // Filter Operations
  // ============================================================================

  const saveFilter = useCallback((name: string, filter: ImageFilter) => {
    const newFilter: SavedImageFilter = {
      id: `filter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      filter,
      createdAt: new Date(),
    };
    setSavedFilters((prev) => [...prev, newFilter]);
    return newFilter;
  }, []);

  const loadFilter = useCallback(
    (filterId: string) => {
      const filter = savedFilters.find((f) => f.id === filterId);
      if (filter) {
        setCurrentFilter(filter.filter);
      }
    },
    [savedFilters]
  );

  const deleteFilter = useCallback((filterId: string) => {
    setSavedFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  // ============================================================================
  // Selection Operations
  // ============================================================================

  const toggleImageSelection = useCallback((imageId: string) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }, []);

  const selectAllImages = useCallback((imageIds: string[]) => {
    setSelectedImageIds(new Set(imageIds));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedImageIds(new Set());
  }, []);

  return {
    // Folders
    folders,
    folderTree,
    expandedFolderIds,
    createFolder,
    updateFolder,
    deleteFolder,
    moveFolder,
    toggleFolderExpanded,

    // Collections
    collections,
    createCollection,
    updateCollection,
    deleteCollection,
    addImagesToCollection,
    removeImagesFromCollection,

    // Tags
    availableTags,
    addTagToImages,
    removeTagFromImages,

    // Filters
    currentFilter,
    setCurrentFilter,
    savedFilters,
    saveFilter,
    loadFilter,
    deleteFilter,

    // Selection
    selectedImageIds,
    toggleImageSelection,
    selectAllImages,
    clearSelection,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildFolderTree(
  folders: ImageFolder[],
  images: ImageWithMetadata[],
  expandedIds: Set<string>
): ImageFolderTreeNode[] {
  const folderMap = new Map<string, ImageFolderTreeNode>();
  const rootFolders: ImageFolderTreeNode[] = [];

  // Count images per folder
  const imageCounts = new Map<string, number>();
  images.forEach((image) => {
    const folderId = image.folderId || null;
    if (folderId) {
      imageCounts.set(folderId, (imageCounts.get(folderId) || 0) + 1);
    }
  });

  // Create tree nodes
  folders.forEach((folder) => {
    const node: ImageFolderTreeNode = {
      ...folder,
      children: [],
      imageCount: imageCounts.get(folder.id) || 0,
      totalImageCount: 0,
      depth: 0,
      expanded: expandedIds.has(folder.id),
    };
    folderMap.set(folder.id, node);
  });

  // Build tree structure
  folderMap.forEach((node) => {
    if (node.parentId === null) {
      rootFolders.push(node);
    } else {
      const parent = folderMap.get(node.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not found, make it a root folder
        rootFolders.push(node);
      }
    }
  });

  // Calculate depths and total counts
  function processNode(node: ImageFolderTreeNode, depth: number): number {
    node.depth = depth;
    let totalCount = node.imageCount;

    node.children.forEach((child) => {
      totalCount += processNode(child, depth + 1);
    });

    node.totalImageCount = totalCount;
    return totalCount;
  }

  rootFolders.forEach((node) => processNode(node, 0));

  // Sort by order
  function sortChildren(node: ImageFolderTreeNode) {
    node.children.sort((a, b) => a.order - b.order);
    node.children.forEach(sortChildren);
  }

  rootFolders.sort((a, b) => a.order - b.order);
  rootFolders.forEach(sortChildren);

  return rootFolders;
}
