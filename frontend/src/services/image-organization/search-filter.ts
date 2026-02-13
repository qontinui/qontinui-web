/**
 * Search and Filter
 *
 * Handles image search and filtering logic.
 */

import type {
  ImageMetadata,
  ImageCollection,
  ImageUsageRecord,
  ImageSearchFilter,
  ImageSearchResult,
  OperationResult,
} from "./types";
import { normalizeTag } from "./metadata-manager";

// ============================================================================
// Dependencies
// ============================================================================

export interface SearchFilterDeps {
  metadata: Map<string, ImageMetadata>;
  collections: Map<string, ImageCollection>;
  usageRecords: Map<string, ImageUsageRecord>;
}

// ============================================================================
// Search and Filter Operations
// ============================================================================

/**
 * Search images with advanced filters
 */
export function searchImages(
  deps: SearchFilterDeps,
  query?: string,
  filters?: ImageSearchFilter
): OperationResult<ImageSearchResult> {
  try {
    let results = Array.from(deps.metadata.values());
    const highlightedFields: Record<string, string[]> = {};

    // Text search
    if (query && query.trim().length > 0) {
      const searchTerm = query.toLowerCase().trim();
      results = results.filter((meta) => {
        const matches: string[] = [];

        if (meta.tags.some((tag) => tag.toLowerCase().includes(searchTerm))) {
          matches.push("tags");
        }

        if (meta.description?.toLowerCase().includes(searchTerm)) {
          matches.push("description");
        }

        if (meta.originalFileName?.toLowerCase().includes(searchTerm)) {
          matches.push("originalFileName");
        }

        if (matches.length > 0) {
          highlightedFields[meta.imageId] = matches;
          return true;
        }

        return false;
      });
    }

    // Folder filter
    if (filters?.folderIds && filters.folderIds.length > 0) {
      const folderSet = new Set(filters.folderIds);
      results = results.filter(
        (meta) => meta.folderId !== null && folderSet.has(meta.folderId)
      );
    }

    // Tag filter
    if (filters?.tags && filters.tags.length > 0) {
      const matchMode = filters.tagMatchMode || "any";
      results = results.filter((meta) => {
        if (matchMode === "all") {
          return filters.tags!.every((tag) =>
            meta.tags.includes(normalizeTag(tag))
          );
        } else {
          return filters.tags!.some((tag) =>
            meta.tags.includes(normalizeTag(tag))
          );
        }
      });
    }

    // Date range filter
    if (filters?.dateRange) {
      const start = filters.dateRange.start.getTime();
      const end = filters.dateRange.end.getTime();
      results = results.filter((meta) => {
        const lastMod = new Date(meta.lastModified).getTime();
        return lastMod >= start && lastMod <= end;
      });
    }

    // File type filter
    if (filters?.fileTypes && filters.fileTypes.length > 0) {
      const typeSet = new Set(filters.fileTypes.map((t) => t.toLowerCase()));
      results = results.filter(
        (meta) => meta.fileType && typeSet.has(meta.fileType.toLowerCase())
      );
    }

    // Dimensions filter
    if (filters?.dimensions) {
      const { minWidth, maxWidth, minHeight, maxHeight } = filters.dimensions;
      results = results.filter((meta) => {
        if (!meta.dimensions) return false;

        if (minWidth && meta.dimensions.width < minWidth) return false;
        if (maxWidth && meta.dimensions.width > maxWidth) return false;
        if (minHeight && meta.dimensions.height < minHeight) return false;
        if (maxHeight && meta.dimensions.height > maxHeight) return false;

        return true;
      });
    }

    // Usage status filter
    if (filters?.usageStatus && filters.usageStatus !== "all") {
      results = results.filter((meta) => {
        const usage = deps.usageRecords.get(meta.imageId);
        const isUsed = usage && usage.totalUsageCount > 0;

        return filters.usageStatus === "used" ? isUsed : !isUsed;
      });
    }

    // Collection filter
    if (filters?.collectionIds && filters.collectionIds.length > 0) {
      const imageIdsInCollections = new Set<string>();
      filters.collectionIds.forEach((collId) => {
        const collection = deps.collections.get(collId);
        if (collection) {
          collection.imageIds.forEach((id) => imageIdsInCollections.add(id));
        }
      });
      results = results.filter((meta) =>
        imageIdsInCollections.has(meta.imageId)
      );
    }

    // Source filter
    if (filters?.source && filters.source.length > 0) {
      const sourceSet = new Set(filters.source);
      results = results.filter((meta) => {
        const source = meta.customFields?.source;
        return (
          typeof source === "string" &&
          sourceSet.has(
            source as
              | "uploaded"
              | "pattern_optimization"
              | "image_extraction"
              | "state_discovery"
          )
        );
      });
    }

    // Build result
    const metadataMap: Record<string, ImageMetadata> = {};
    results.forEach((meta) => {
      metadataMap[meta.imageId] = meta;
    });

    return {
      success: true,
      data: {
        imageIds: results.map((m) => m.imageId),
        totalCount: results.length,
        metadata: metadataMap,
        highlightedFields:
          Object.keys(highlightedFields).length > 0
            ? highlightedFields
            : undefined,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Filter images by usage in specific workflows or states
 */
export function filterByUsage(
  deps: SearchFilterDeps,
  workflowIds?: string[],
  stateIds?: string[]
): OperationResult<string[]> {
  try {
    const results: string[] = [];

    deps.usageRecords.forEach((record, imageId) => {
      const matchesWorkflow =
        !workflowIds ||
        workflowIds.length === 0 ||
        record.usedIn.some(
          (usage) =>
            usage.type === "workflow" && workflowIds.includes(usage.id)
        );

      const matchesState =
        !stateIds ||
        stateIds.length === 0 ||
        record.usedIn.some(
          (usage) => usage.type === "state" && stateIds.includes(usage.id)
        );

      if (matchesWorkflow && matchesState) {
        results.push(imageId);
      }
    });

    return {
      success: true,
      data: results,
    };
  } catch (error) {
    return {
      success: false,
      error: `Filter by usage failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
