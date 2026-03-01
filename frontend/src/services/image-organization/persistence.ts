/**
 * Persistence
 *
 * Handles save/load/storage operations and import/export functionality.
 */

import {
  STORAGE_KEY,
  STORAGE_VERSION,
  type ImageCollection,
  type ImageFolder,
  type ImageMetadata,
  type ImageOrganizationData,
  type ImageUsageRecord,
  type ImageVersion,
  type ImportExportData,
  type OperationResult,
} from "./types";
import { calculateFolderDepthFromFolder } from "./folder-manager";
import { createLogger } from "@/lib/logger";
const logger = createLogger("ImageOrgPersistence");

// ============================================================================
// Dependencies
// ============================================================================

export interface PersistenceDeps {
  folders: Map<string, ImageFolder>;
  metadata: Map<string, ImageMetadata>;
  collections: Map<string, ImageCollection>;
  usageRecords: Map<string, ImageUsageRecord>;
  versions: Map<string, ImageVersion[]>;
  generateId: (prefix: string) => string;
}

// ============================================================================
// Storage Operations
// ============================================================================

/**
 * Save to localStorage
 */
export function saveToStorage(deps: PersistenceDeps): void {
  try {
    if (typeof window === "undefined") return;

    const data: ImageOrganizationData = {
      version: STORAGE_VERSION,
      folders: Array.from(deps.folders.values()),
      metadata: Array.from(deps.metadata.values()),
      collections: Array.from(deps.collections.values()),
      usageRecords: Array.from(deps.usageRecords.values()),
      versions: Array.from(deps.versions.entries()).flatMap(
        ([_, versions]) => versions
      ),
      lastUpdated: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    logger.error("Failed to save image organization data:", error);
  }
}

/**
 * Load from localStorage
 */
export function loadFromStorage(deps: PersistenceDeps): void {
  try {
    if (typeof window === "undefined") return;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const data: ImageOrganizationData = JSON.parse(stored);

    // Load folders
    deps.folders.clear();
    data.folders.forEach((folder) => {
      deps.folders.set(folder.id, folder);
    });

    // Load metadata
    deps.metadata.clear();
    data.metadata.forEach((meta) => {
      deps.metadata.set(meta.imageId, meta);
    });

    // Load collections
    deps.collections.clear();
    data.collections.forEach((collection) => {
      deps.collections.set(collection.id, collection);
    });

    // Load usage records
    deps.usageRecords.clear();
    data.usageRecords.forEach((record) => {
      deps.usageRecords.set(record.imageId, record);
    });

    // Load versions
    deps.versions.clear();
    data.versions.forEach((version) => {
      const imageVersions = deps.versions.get(version.imageId) || [];
      imageVersions.push(version);
      deps.versions.set(version.imageId, imageVersions);
    });
  } catch (error) {
    logger.error("Failed to load image organization data:", error);
  }
}

/**
 * Clear all data
 */
export function clearAllData(deps: PersistenceDeps): OperationResult<void> {
  try {
    deps.folders.clear();
    deps.metadata.clear();
    deps.collections.clear();
    deps.usageRecords.clear();
    deps.versions.clear();

    saveToStorage(deps);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to clear data: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ============================================================================
// Import/Export Operations
// ============================================================================

/**
 * Export images and organization data
 */
export function exportImages(
  deps: PersistenceDeps,
  imageIds: string[],
  includeFolders = true
): OperationResult<ImportExportData> {
  try {
    const exportData: ImportExportData = {
      version: STORAGE_VERSION,
      exportDate: new Date().toISOString(),
      metadata: [],
      collections: [],
    };

    // Export metadata for selected images
    imageIds.forEach((imageId) => {
      const meta = deps.metadata.get(imageId);
      if (meta) {
        exportData.metadata!.push(meta);
      }
    });

    // Export folders if requested
    if (includeFolders) {
      const folderIds = new Set<string>();

      exportData.metadata!.forEach((meta) => {
        if (meta.folderId) {
          folderIds.add(meta.folderId);

          let currentFolder = deps.folders.get(meta.folderId);
          while (currentFolder?.parentId) {
            folderIds.add(currentFolder.parentId);
            currentFolder = deps.folders.get(currentFolder.parentId);
          }
        }
      });

      exportData.folders = Array.from(folderIds)
        .map((id) => deps.folders.get(id))
        .filter((f): f is ImageFolder => f !== undefined);
    }

    // Export collections that contain any of the selected images
    const imageIdSet = new Set(imageIds);
    deps.collections.forEach((collection) => {
      const hasImages = collection.imageIds.some((id) => imageIdSet.has(id));
      if (hasImages) {
        const filteredCollection = {
          ...collection,
          imageIds: collection.imageIds.filter((id) => imageIdSet.has(id)),
        };
        exportData.collections!.push(filteredCollection);
      }
    });

    return {
      success: true,
      data: exportData,
    };
  } catch (error) {
    return {
      success: false,
      error: `Export failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Import images and organization data
 */
export function importImages(
  deps: PersistenceDeps,
  data: ImportExportData,
  save: () => void
): OperationResult<{
  importedImages: number;
  importedFolders: number;
  importedCollections: number;
}> {
  try {
    let importedImages = 0;
    let importedFolders = 0;
    let importedCollections = 0;

    // Import folders
    if (data.folders) {
      const folderIdMap = new Map<string, string>();

      const sortedFolders = [...data.folders].sort((a, b) => {
        const depthA = calculateFolderDepthFromFolder(a, data.folders!);
        const depthB = calculateFolderDepthFromFolder(b, data.folders!);
        return depthA - depthB;
      });

      sortedFolders.forEach((folder) => {
        const oldId = folder.id;
        const newFolder = {
          ...folder,
          id: deps.generateId("folder"),
          parentId: folder.parentId
            ? folderIdMap.get(folder.parentId) || null
            : null,
        };

        deps.folders.set(newFolder.id, newFolder);
        folderIdMap.set(oldId, newFolder.id);
        importedFolders++;
      });

      // Update metadata with new folder IDs
      if (data.metadata) {
        data.metadata.forEach((meta) => {
          if (meta.folderId && folderIdMap.has(meta.folderId)) {
            meta.folderId = folderIdMap.get(meta.folderId)!;
          }
        });
      }
    }

    // Import metadata
    if (data.metadata) {
      data.metadata.forEach((meta) => {
        let newId = meta.imageId;
        if (deps.metadata.has(newId)) {
          newId = deps.generateId("image");
        }

        const newMeta = {
          ...meta,
          imageId: newId,
          lastModified: new Date().toISOString(),
        };

        deps.metadata.set(newId, newMeta);
        importedImages++;
      });
    }

    // Import collections
    if (data.collections) {
      data.collections.forEach((collection) => {
        const newCollection = {
          ...collection,
          id: deps.generateId("collection"),
          updated: new Date().toISOString(),
        };

        deps.collections.set(newCollection.id, newCollection);
        importedCollections++;
      });
    }

    save();

    return {
      success: true,
      data: {
        importedImages,
        importedFolders,
        importedCollections,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Export all organization data to JSON
 */
export function exportAllData(
  deps: PersistenceDeps
): OperationResult<ImageOrganizationData> {
  try {
    const data: ImageOrganizationData = {
      version: STORAGE_VERSION,
      folders: Array.from(deps.folders.values()),
      metadata: Array.from(deps.metadata.values()),
      collections: Array.from(deps.collections.values()),
      usageRecords: Array.from(deps.usageRecords.values()),
      versions: Array.from(deps.versions.entries()).flatMap(
        ([, versions]) => versions
      ),
      lastUpdated: new Date().toISOString(),
    };

    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: `Export all failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Import all organization data from JSON
 */
export function importAllData(
  deps: PersistenceDeps,
  data: ImageOrganizationData,
  save: () => void
): OperationResult<void> {
  try {
    deps.folders.clear();
    deps.metadata.clear();
    deps.collections.clear();
    deps.usageRecords.clear();
    deps.versions.clear();

    data.folders.forEach((folder) => {
      deps.folders.set(folder.id, folder);
    });

    data.metadata.forEach((meta) => {
      deps.metadata.set(meta.imageId, meta);
    });

    data.collections.forEach((collection) => {
      deps.collections.set(collection.id, collection);
    });

    data.usageRecords.forEach((record) => {
      deps.usageRecords.set(record.imageId, record);
    });

    data.versions.forEach((version) => {
      const imageVersions = deps.versions.get(version.imageId) || [];
      imageVersions.push(version);
      deps.versions.set(version.imageId, imageVersions);
    });

    save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Import all failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get statistics about the image library
 */
export function getStatistics(
  deps: PersistenceDeps,
  getAllImageTags: () => OperationResult<string[]>,
  findUnusedImages: () => OperationResult<string[]>
): OperationResult<{
  totalImages: number;
  totalFolders: number;
  totalCollections: number;
  totalTags: number;
  usedImages: number;
  unusedImages: number;
  totalVersions: number;
}> {
  try {
    const allTags = getAllImageTags();
    const unusedImages = findUnusedImages();

    const totalVersions = Array.from(deps.versions.values()).reduce(
      (sum, versions) => sum + versions.length,
      0
    );

    return {
      success: true,
      data: {
        totalImages: deps.metadata.size,
        totalFolders: deps.folders.size,
        totalCollections: deps.collections.size,
        totalTags: allTags.data?.length || 0,
        usedImages: deps.usageRecords.size,
        unusedImages: unusedImages.data?.length || 0,
        totalVersions,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get statistics: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
