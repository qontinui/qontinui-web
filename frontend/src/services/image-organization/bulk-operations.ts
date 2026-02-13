/**
 * Bulk Operations
 *
 * Handles bulk operations on multiple images.
 */

import type {
  ImageMetadata,
  ImageCollection,
  ImageUsageRecord,
  ImageVersion,
  BulkOperationResult,
  OperationResult,
} from "./types";
import { addImageTag } from "./metadata-manager";
import { moveImageToFolder } from "./folder-manager";
import type { FolderManagerDeps } from "./folder-manager";
import type { MetadataManagerDeps } from "./metadata-manager";

// ============================================================================
// Dependencies
// ============================================================================

export interface BulkOperationsDeps {
  metadata: Map<string, ImageMetadata>;
  collections: Map<string, ImageCollection>;
  usageRecords: Map<string, ImageUsageRecord>;
  versions: Map<string, ImageVersion[]>;
  folders: FolderManagerDeps["folders"];
  generateId: (prefix: string) => string;
  save: () => void;
  createDefaultMetadata: (imageId: string) => ImageMetadata;
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Add tags to multiple images
 */
export function bulkTag(
  deps: BulkOperationsDeps,
  imageIds: string[],
  tags: string[]
): BulkOperationResult {
  const errors: Array<{ imageId: string; error: string }> = [];
  let successCount = 0;

  const metadataDeps: MetadataManagerDeps = {
    metadata: deps.metadata,
    usageRecords: deps.usageRecords,
    versions: deps.versions,
    generateId: deps.generateId,
    save: deps.save,
  };

  imageIds.forEach((imageId) => {
    let allTagsAdded = true;

    tags.forEach((tag) => {
      const result = addImageTag(metadataDeps, imageId, tag);
      if (!result.success) {
        allTagsAdded = false;
        errors.push({ imageId, error: result.error || "Unknown error" });
      }
    });

    if (allTagsAdded) {
      successCount++;
    }
  });

  return {
    success: errors.length === 0,
    successCount,
    failureCount: errors.length,
    errors,
  };
}

/**
 * Move multiple images to a folder
 */
export function bulkMove(
  deps: BulkOperationsDeps,
  imageIds: string[],
  folderId: string | null
): BulkOperationResult {
  const errors: Array<{ imageId: string; error: string }> = [];
  let successCount = 0;

  const folderDeps: FolderManagerDeps = {
    folders: deps.folders,
    metadata: deps.metadata,
    generateId: deps.generateId,
    save: deps.save,
  };

  imageIds.forEach((imageId) => {
    const result = moveImageToFolder(
      folderDeps,
      imageId,
      folderId,
      deps.createDefaultMetadata
    );
    if (result.success) {
      successCount++;
    } else {
      errors.push({ imageId, error: result.error || "Unknown error" });
    }
  });

  return {
    success: errors.length === 0,
    successCount,
    failureCount: errors.length,
    errors,
  };
}

/**
 * Delete metadata for multiple images
 */
export function bulkDelete(
  deps: BulkOperationsDeps,
  imageIds: string[]
): BulkOperationResult {
  const errors: Array<{ imageId: string; error: string }> = [];
  let successCount = 0;

  imageIds.forEach((imageId) => {
    try {
      deps.metadata.delete(imageId);

      deps.collections.forEach((collection) => {
        collection.imageIds = collection.imageIds.filter(
          (id) => id !== imageId
        );
      });

      deps.usageRecords.delete(imageId);

      deps.versions.delete(imageId);

      successCount++;
    } catch (error) {
      errors.push({
        imageId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  deps.save();

  return {
    success: errors.length === 0,
    successCount,
    failureCount: errors.length,
    errors,
  };
}

/**
 * Prepare download bundle for multiple images
 * Returns manifest with image info for downloading
 */
export function bulkDownload(
  deps: BulkOperationsDeps,
  imageIds: string[]
): OperationResult<{
  manifest: Array<{
    imageId: string;
    metadata: ImageMetadata;
    filename: string;
  }>;
  totalSize: number;
}> {
  try {
    const manifest: Array<{
      imageId: string;
      metadata: ImageMetadata;
      filename: string;
    }> = [];

    let totalSize = 0;

    imageIds.forEach((imageId) => {
      const meta = deps.metadata.get(imageId);
      if (meta) {
        const filename = meta.originalFileName || `image-${imageId}.png`;
        manifest.push({
          imageId,
          metadata: meta,
          filename,
        });

        if (meta.customFields?.fileSize) {
          totalSize += meta.customFields.fileSize as number;
        }
      }
    });

    return {
      success: true,
      data: {
        manifest,
        totalSize,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to prepare download: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
