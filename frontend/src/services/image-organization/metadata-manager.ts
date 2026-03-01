/**
 * Metadata Manager
 *
 * Handles image metadata operations including tags, usage tracking, and version history.
 */

import {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_IMAGE,
  type ImageMetadata,
  type ImageUsageRecord,
  type ImageVersion,
  type OperationResult,
} from "./types";

// ============================================================================
// Dependencies
// ============================================================================

export interface MetadataManagerDeps {
  metadata: Map<string, ImageMetadata>;
  usageRecords: Map<string, ImageUsageRecord>;
  versions: Map<string, ImageVersion[]>;
  generateId: (prefix: string) => string;
  save: () => void;
}

// ============================================================================
// Tag Operations
// ============================================================================

/**
 * Normalize tag for consistent storage
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Create default metadata for an image
 */
export function createDefaultMetadata(imageId: string): ImageMetadata {
  return {
    imageId,
    tags: [],
    folderId: null,
    lastModified: new Date().toISOString(),
  };
}

/**
 * Add a tag to an image
 */
export function addImageTag(
  deps: MetadataManagerDeps,
  imageId: string,
  tag: string
): OperationResult<void> {
  try {
    const normalized = normalizeTag(tag);

    if (!normalized) {
      return {
        success: false,
        error: "Invalid tag",
      };
    }

    if (normalized.length > MAX_TAG_LENGTH) {
      return {
        success: false,
        error: `Tag exceeds maximum length of ${MAX_TAG_LENGTH} characters`,
      };
    }

    let meta = deps.metadata.get(imageId);
    if (!meta) {
      meta = createDefaultMetadata(imageId);
      deps.metadata.set(imageId, meta);
    }

    if (meta.tags.length >= MAX_TAGS_PER_IMAGE) {
      return {
        success: false,
        error: `Maximum number of tags (${MAX_TAGS_PER_IMAGE}) reached`,
      };
    }

    if (meta.tags.includes(normalized)) {
      return {
        success: true,
        warnings: ["Tag already exists on image"],
      };
    }

    meta.tags.push(normalized);
    meta.lastModified = new Date().toISOString();

    deps.metadata.set(imageId, meta);
    deps.save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to add tag: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Remove a tag from an image
 */
export function removeImageTag(
  deps: MetadataManagerDeps,
  imageId: string,
  tag: string
): OperationResult<void> {
  try {
    const normalized = normalizeTag(tag);
    const meta = deps.metadata.get(imageId);

    if (!meta) {
      return {
        success: false,
        error: "Image metadata not found",
      };
    }

    const index = meta.tags.indexOf(normalized);
    if (index === -1) {
      return {
        success: true,
        warnings: ["Tag not found on image"],
      };
    }

    meta.tags.splice(index, 1);
    meta.lastModified = new Date().toISOString();

    deps.metadata.set(imageId, meta);
    deps.save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to remove tag: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get all images with a specific tag
 */
export function getImagesByTag(
  deps: MetadataManagerDeps,
  tag: string
): OperationResult<string[]> {
  try {
    const normalized = normalizeTag(tag);
    const imageIds = Array.from(deps.metadata.values())
      .filter((m) => m.tags.includes(normalized))
      .map((m) => m.imageId);

    return {
      success: true,
      data: imageIds,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get images by tag: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get all unique tags across all images
 */
export function getAllImageTags(
  deps: MetadataManagerDeps
): OperationResult<string[]> {
  try {
    const tagsSet = new Set<string>();

    deps.metadata.forEach((meta) => {
      meta.tags.forEach((tag) => tagsSet.add(tag));
    });

    const tags = Array.from(tagsSet).sort();

    return {
      success: true,
      data: tags,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get all tags: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Update image metadata
 */
export function updateImageMetadata(
  deps: MetadataManagerDeps,
  imageId: string,
  metadata: Partial<Omit<ImageMetadata, "imageId" | "lastModified">>
): OperationResult<ImageMetadata> {
  try {
    let meta = deps.metadata.get(imageId);

    if (!meta) {
      meta = createDefaultMetadata(imageId);
    }

    const updatedMeta: ImageMetadata = {
      ...meta,
      ...metadata,
      imageId,
      lastModified: new Date().toISOString(),
    };

    deps.metadata.set(imageId, updatedMeta);
    deps.save();

    return {
      success: true,
      data: updatedMeta,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to update metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get image metadata
 */
export function getImageMetadata(
  deps: MetadataManagerDeps,
  imageId: string
): OperationResult<ImageMetadata> {
  const meta = deps.metadata.get(imageId);

  if (!meta) {
    const defaultMeta = createDefaultMetadata(imageId);
    return {
      success: true,
      data: defaultMeta,
    };
  }

  return {
    success: true,
    data: meta,
  };
}

// ============================================================================
// Usage Tracking
// ============================================================================

/**
 * Track image usage
 */
export function trackImageUsage(
  deps: MetadataManagerDeps,
  imageId: string,
  usedIn: {
    type: "workflow" | "state" | "pattern" | "other";
    id: string;
    name: string;
    location?: string;
  }
): OperationResult<void> {
  try {
    let record = deps.usageRecords.get(imageId);

    if (!record) {
      record = {
        imageId,
        usedIn: [],
        totalUsageCount: 0,
      };
    }

    const existingIndex = record.usedIn.findIndex(
      (u) => u.type === usedIn.type && u.id === usedIn.id
    );

    if (existingIndex >= 0) {
      record.usedIn[existingIndex] = usedIn;
    } else {
      record.usedIn.push(usedIn);
    }

    record.totalUsageCount = record.usedIn.length;
    record.lastUsed = new Date().toISOString();

    deps.usageRecords.set(imageId, record);
    deps.save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to track usage: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Remove usage tracking for an image from a specific location
 */
export function removeImageUsage(
  deps: MetadataManagerDeps,
  imageId: string,
  usageId: string
): OperationResult<void> {
  try {
    const record = deps.usageRecords.get(imageId);

    if (!record) {
      return {
        success: true,
        warnings: ["No usage record found for image"],
      };
    }

    record.usedIn = record.usedIn.filter((u) => u.id !== usageId);
    record.totalUsageCount = record.usedIn.length;

    if (record.usedIn.length === 0) {
      deps.usageRecords.delete(imageId);
    } else {
      deps.usageRecords.set(imageId, record);
    }

    deps.save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to remove usage: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get usage information for an image
 */
export function getImageUsage(
  deps: MetadataManagerDeps,
  imageId: string
): OperationResult<ImageUsageRecord> {
  const record = deps.usageRecords.get(imageId);

  if (!record) {
    return {
      success: true,
      data: {
        imageId,
        usedIn: [],
        totalUsageCount: 0,
      },
    };
  }

  return {
    success: true,
    data: record,
  };
}

/**
 * Find images that are not used anywhere
 */
export function findUnusedImages(
  deps: MetadataManagerDeps
): OperationResult<string[]> {
  try {
    const allImageIds = Array.from(deps.metadata.keys());
    const unusedIds = allImageIds.filter((imageId) => {
      const record = deps.usageRecords.get(imageId);
      return !record || record.totalUsageCount === 0;
    });

    return {
      success: true,
      data: unusedIds,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to find unused images: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Find most used images
 */
export function findMostUsedImages(
  deps: MetadataManagerDeps,
  limit = 10
): OperationResult<
  Array<{
    imageId: string;
    usageCount: number;
    metadata?: ImageMetadata;
  }>
> {
  try {
    const usageArray = Array.from(deps.usageRecords.values())
      .map((record) => ({
        imageId: record.imageId,
        usageCount: record.totalUsageCount,
        metadata: deps.metadata.get(record.imageId),
      }))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);

    return {
      success: true,
      data: usageArray,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to find most used images: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ============================================================================
// Version History
// ============================================================================

/**
 * Create a new version of an image
 */
export function createImageVersion(
  deps: MetadataManagerDeps,
  imageId: string,
  url: string,
  description?: string,
  fileSize?: number,
  s3_key?: string
): OperationResult<ImageVersion> {
  try {
    const versions = deps.versions.get(imageId) || [];

    versions.forEach((v) => {
      v.isPrimary = false;
    });

    const newVersion: ImageVersion = {
      id: deps.generateId("version"),
      imageId,
      versionNumber: versions.length + 1,
      url,
      s3_key,
      description,
      created: new Date().toISOString(),
      fileSize: fileSize || 0,
      isPrimary: true,
    };

    versions.push(newVersion);
    deps.versions.set(imageId, versions);
    deps.save();

    return {
      success: true,
      data: newVersion,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create version: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get all versions of an image
 */
export function getImageVersions(
  deps: MetadataManagerDeps,
  imageId: string
): OperationResult<ImageVersion[]> {
  const versions = deps.versions.get(imageId) || [];

  return {
    success: true,
    data: versions.sort((a, b) => b.versionNumber - a.versionNumber),
  };
}

/**
 * Rollback to a specific version
 */
export function rollbackToVersion(
  deps: MetadataManagerDeps,
  imageId: string,
  versionId: string
): OperationResult<ImageVersion> {
  try {
    const versions = deps.versions.get(imageId);

    if (!versions) {
      return {
        success: false,
        error: "No versions found for image",
      };
    }

    const targetVersion = versions.find((v) => v.id === versionId);

    if (!targetVersion) {
      return {
        success: false,
        error: "Version not found",
      };
    }

    versions.forEach((v) => {
      v.isPrimary = false;
    });

    targetVersion.isPrimary = true;

    deps.versions.set(imageId, versions);
    deps.save();

    return {
      success: true,
      data: targetVersion,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to rollback: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Delete a specific version
 */
export function deleteImageVersion(
  deps: MetadataManagerDeps,
  imageId: string,
  versionId: string
): OperationResult<void> {
  try {
    const versions = deps.versions.get(imageId);

    if (!versions) {
      return {
        success: false,
        error: "No versions found for image",
      };
    }

    const versionIndex = versions.findIndex((v) => v.id === versionId);

    if (versionIndex === -1) {
      return {
        success: false,
        error: "Version not found",
      };
    }

    const version = versions[versionIndex];

    if (!version) {
      return {
        success: false,
        error: "Version not found",
      };
    }

    if (version.isPrimary && versions.length > 1) {
      return {
        success: false,
        error:
          "Cannot delete primary version. Make another version primary first.",
      };
    }

    versions.splice(versionIndex, 1);

    if (versions.length === 0) {
      deps.versions.delete(imageId);
    } else {
      deps.versions.set(imageId, versions);
    }

    deps.save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete version: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
