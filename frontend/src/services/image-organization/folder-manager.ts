/**
 * Folder Manager
 *
 * Handles folder CRUD operations and tree structure management.
 */

import type {
  ImageFolder,
  ImageMetadata,
  FolderTreeNode,
  OperationResult,
} from "./types";
import { MAX_FOLDER_DEPTH, MAX_FOLDER_NAME_LENGTH } from "./types";

// ============================================================================
// Utility helpers (shared across managers via injection)
// ============================================================================

export interface FolderManagerDeps {
  folders: Map<string, ImageFolder>;
  metadata: Map<string, ImageMetadata>;
  generateId: (prefix: string) => string;
  save: () => void;
}

// ============================================================================
// Folder CRUD and Tree Operations
// ============================================================================

/**
 * Create a new image folder
 */
export function createImageFolder(
  deps: FolderManagerDeps,
  name: string,
  parentId?: string,
  color?: string,
  icon?: string
): OperationResult<ImageFolder> {
  try {
    const nameValidation = validateFolderName(deps, name, parentId);
    if (!nameValidation.success) {
      return nameValidation as OperationResult<ImageFolder>;
    }

    if (parentId && !deps.folders.has(parentId)) {
      return {
        success: false,
        error: `Parent folder not found: ${parentId}`,
      };
    }

    const depth = calculateFolderDepth(deps, parentId);
    if (depth >= MAX_FOLDER_DEPTH) {
      return {
        success: false,
        error: `Maximum folder depth (${MAX_FOLDER_DEPTH}) exceeded`,
      };
    }

    const folder: ImageFolder = {
      id: deps.generateId("folder"),
      name: name.trim(),
      parentId: parentId || null,
      color: color,
      icon: icon,
      order: getNextFolderOrder(deps, parentId),
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        imageCount: 0,
        descendantCount: 0,
      },
    };

    deps.folders.set(folder.id, folder);
    updateFolderCounts(deps, folder.parentId);
    deps.save();

    return {
      success: true,
      data: folder,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create folder: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Update an existing image folder
 */
export function updateImageFolder(
  deps: FolderManagerDeps,
  id: string,
  updates: Partial<
    Pick<ImageFolder, "name" | "color" | "icon" | "description" | "order">
  >
): OperationResult<ImageFolder> {
  try {
    const folder = deps.folders.get(id);
    if (!folder) {
      return {
        success: false,
        error: `Folder not found: ${id}`,
      };
    }

    if (updates.name && updates.name !== folder.name) {
      const nameValidation = validateFolderName(
        deps,
        updates.name,
        folder.parentId,
        id
      );
      if (!nameValidation.success) {
        return nameValidation as OperationResult<ImageFolder>;
      }
    }

    const updatedFolder: ImageFolder = {
      ...folder,
      ...updates,
      name: updates.name?.trim() || folder.name,
      metadata: {
        ...folder.metadata,
        updated: new Date().toISOString(),
      },
    };

    deps.folders.set(id, updatedFolder);
    deps.save();

    return {
      success: true,
      data: updatedFolder,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update folder: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Delete an image folder
 */
export function deleteImageFolder(
  deps: FolderManagerDeps,
  id: string,
  options?: {
    moveImagesToParent?: boolean;
    recursive?: boolean;
  }
): OperationResult<void> {
  try {
    const folder = deps.folders.get(id);
    if (!folder) {
      return {
        success: false,
        error: `Folder not found: ${id}`,
      };
    }

    const subfolders = getSubfolders(deps, id);
    if (subfolders.length > 0 && !options?.recursive) {
      return {
        success: false,
        error: `Folder contains ${subfolders.length} subfolders. Use recursive option to delete all.`,
      };
    }

    const imagesInFolder = getImagesInFolder(deps, id, false).data || [];
    if (imagesInFolder.length > 0) {
      if (options?.moveImagesToParent) {
        imagesInFolder.forEach((imageId) => {
          const meta = deps.metadata.get(imageId);
          if (meta) {
            meta.folderId = folder.parentId;
            deps.metadata.set(imageId, meta);
          }
        });
      } else {
        imagesInFolder.forEach((imageId) => {
          const meta = deps.metadata.get(imageId);
          if (meta) {
            meta.folderId = null;
            deps.metadata.set(imageId, meta);
          }
        });
      }
    }

    if (options?.recursive) {
      subfolders.forEach((subfolder) => {
        deleteImageFolder(deps, subfolder.id, options);
      });
    }

    deps.folders.delete(id);
    updateFolderCounts(deps, folder.parentId);
    deps.save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete folder: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get a single folder by ID
 */
export function getImageFolder(
  deps: FolderManagerDeps,
  id: string
): OperationResult<ImageFolder> {
  const folder = deps.folders.get(id);
  if (!folder) {
    return {
      success: false,
      error: `Folder not found: ${id}`,
    };
  }
  return {
    success: true,
    data: folder,
  };
}

/**
 * Get all folders
 */
export function getAllImageFolders(
  deps: FolderManagerDeps
): OperationResult<ImageFolder[]> {
  return {
    success: true,
    data: Array.from(deps.folders.values()).sort((a, b) => a.order - b.order),
  };
}

/**
 * Get folder tree structure
 */
export function getImageFolderTree(
  deps: FolderManagerDeps
): OperationResult<FolderTreeNode[]> {
  try {
    const rootFolders = Array.from(deps.folders.values())
      .filter((f) => f.parentId === null)
      .sort((a, b) => a.order - b.order);

    const buildTree = (
      folder: ImageFolder,
      depth: number,
      path: string[]
    ): FolderTreeNode => {
      const images = Array.from(deps.metadata.values())
        .filter((m) => m.folderId === folder.id)
        .map((m) => m.imageId);

      const children = Array.from(deps.folders.values())
        .filter((f) => f.parentId === folder.id)
        .sort((a, b) => a.order - b.order)
        .map((f) => buildTree(f, depth + 1, [...path, folder.name]));

      return {
        folder,
        children,
        images,
        depth,
        path,
      };
    };

    const tree = rootFolders.map((f) => buildTree(f, 0, [f.name]));

    return {
      success: true,
      data: tree,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to build folder tree: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Move an image to a folder
 */
export function moveImageToFolder(
  deps: FolderManagerDeps,
  imageId: string,
  folderId: string | null,
  createDefaultMetadata: (imageId: string) => ImageMetadata
): OperationResult<void> {
  try {
    if (folderId !== null && !deps.folders.has(folderId)) {
      return {
        success: false,
        error: `Folder not found: ${folderId}`,
      };
    }

    let meta = deps.metadata.get(imageId);
    if (!meta) {
      meta = createDefaultMetadata(imageId);
      deps.metadata.set(imageId, meta);
    }

    const oldFolderId = meta.folderId;
    meta.folderId = folderId;
    meta.lastModified = new Date().toISOString();

    deps.metadata.set(imageId, meta);

    updateFolderCounts(deps, oldFolderId);
    updateFolderCounts(deps, folderId);

    deps.save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to move image: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get images in a folder
 */
export function getImagesInFolder(
  deps: FolderManagerDeps,
  folderId: string,
  recursive = false
): OperationResult<string[]> {
  try {
    if (!deps.folders.has(folderId)) {
      return {
        success: false,
        error: `Folder not found: ${folderId}`,
      };
    }

    const imageIds: string[] = [];

    const directImages = Array.from(deps.metadata.values())
      .filter((m) => m.folderId === folderId)
      .map((m) => m.imageId);

    imageIds.push(...directImages);

    if (recursive) {
      const subfolders = getSubfolders(deps, folderId);
      subfolders.forEach((subfolder) => {
        const subImages = getImagesInFolder(deps, subfolder.id, true);
        if (subImages.success && subImages.data) {
          imageIds.push(...subImages.data);
        }
      });
    }

    return {
      success: true,
      data: imageIds,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get images: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Validate folder name
 */
export function validateFolderName(
  deps: FolderManagerDeps,
  name: string,
  parentId?: string | null,
  excludeId?: string
): OperationResult<void> {
  if (!name || name.trim().length === 0) {
    return {
      success: false,
      error: "Folder name is required",
    };
  }

  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    return {
      success: false,
      error: `Folder name exceeds maximum length of ${MAX_FOLDER_NAME_LENGTH} characters`,
    };
  }

  const siblings = Array.from(deps.folders.values()).filter(
    (f) => f.parentId === (parentId || null) && f.id !== excludeId
  );

  if (
    siblings.some((f) => f.name.toLowerCase() === name.trim().toLowerCase())
  ) {
    return {
      success: false,
      error: "A folder with this name already exists in the same location",
    };
  }

  return { success: true };
}

/**
 * Calculate folder depth
 */
export function calculateFolderDepth(
  deps: FolderManagerDeps,
  folderId?: string | null
): number {
  if (!folderId) return 0;

  let depth = 0;
  let currentId: string | null = folderId;

  while (currentId) {
    depth++;
    const folder = deps.folders.get(currentId);
    currentId = folder?.parentId || null;

    if (depth > MAX_FOLDER_DEPTH) break;
  }

  return depth;
}

/**
 * Calculate folder depth from folder object (for import)
 */
export function calculateFolderDepthFromFolder(
  folder: ImageFolder,
  allFolders: ImageFolder[]
): number {
  let depth = 0;
  let currentFolder: ImageFolder | undefined = folder;

  while (currentFolder?.parentId) {
    depth++;
    currentFolder = allFolders.find((f) => f.id === currentFolder!.parentId);

    if (depth > MAX_FOLDER_DEPTH) break;
  }

  return depth;
}

/**
 * Get next order number for folders
 */
export function getNextFolderOrder(
  deps: FolderManagerDeps,
  parentId?: string | null
): number {
  const siblings = Array.from(deps.folders.values()).filter(
    (f) => f.parentId === (parentId || null)
  );

  if (siblings.length === 0) return 0;

  return Math.max(...siblings.map((f) => f.order)) + 1;
}

/**
 * Get subfolders of a folder
 */
export function getSubfolders(
  deps: FolderManagerDeps,
  folderId: string
): ImageFolder[] {
  return Array.from(deps.folders.values()).filter(
    (f) => f.parentId === folderId
  );
}

/**
 * Update folder image counts recursively
 */
export function updateFolderCounts(
  deps: FolderManagerDeps,
  folderId: string | null
): void {
  if (!folderId) return;

  const folder = deps.folders.get(folderId);
  if (!folder) return;

  const imageCount = Array.from(deps.metadata.values()).filter(
    (m) => m.folderId === folderId
  ).length;

  const subfolders = getSubfolders(deps, folderId);
  let descendantCount = imageCount;

  subfolders.forEach((subfolder) => {
    updateFolderCounts(deps, subfolder.id);
    const sub = deps.folders.get(subfolder.id);
    if (sub) {
      descendantCount += sub.metadata.descendantCount;
    }
  });

  folder.metadata.imageCount = imageCount;
  folder.metadata.descendantCount = descendantCount;
  folder.metadata.updated = new Date().toISOString();

  deps.folders.set(folderId, folder);

  if (folder.parentId) {
    updateFolderCounts(deps, folder.parentId);
  }
}
