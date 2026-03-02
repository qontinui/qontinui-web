import { useMemo } from "react";
import type { ImageFilter, ImageWithMetadata } from "../types";

export function useFilteredImages(
  images: ImageWithMetadata[],
  selectedFolderId: string | null,
  currentFilter: ImageFilter
) {
  return useMemo(() => {
    let result = [...images];

    // Folder filter
    if (selectedFolderId) {
      result = result.filter((img) => img.folderId === selectedFolderId);
    }

    // Search query
    if (currentFilter.query) {
      const query = currentFilter.query.toLowerCase();
      result = result.filter((img) => img.name.toLowerCase().includes(query));
    }

    // Tags filter
    if (currentFilter.tags && currentFilter.tags.length > 0) {
      result = result.filter((img) => {
        const imgTags = img.tags || [];
        if (currentFilter.tagOperator === "AND") {
          return currentFilter.tags!.every((tag) => imgTags.includes(tag));
        } else {
          return currentFilter.tags!.some((tag) => imgTags.includes(tag));
        }
      });
    }

    // Source filter
    if (currentFilter.sources && currentFilter.sources.length > 0) {
      result = result.filter((img) =>
        currentFilter.sources!.includes(img.source)
      );
    }

    // Usage filter
    if (currentFilter.usageFilter) {
      if (currentFilter.usageFilter === "used") {
        result = result.filter((img) => img.usageCount > 0);
      } else if (currentFilter.usageFilter === "unused") {
        result = result.filter((img) => img.usageCount === 0);
      }
    }

    // Date range filter
    if (currentFilter.dateRange?.from) {
      result = result.filter(
        (img) => img.createdAt >= currentFilter.dateRange!.from!
      );
    }
    if (currentFilter.dateRange?.to) {
      result = result.filter(
        (img) => img.createdAt <= currentFilter.dateRange!.to!
      );
    }

    // Size filter
    if (currentFilter.minSize) {
      result = result.filter((img) => img.size >= currentFilter.minSize!);
    }
    if (currentFilter.maxSize) {
      result = result.filter((img) => img.size <= currentFilter.maxSize!);
    }

    return result;
  }, [images, selectedFolderId, currentFilter]);
}
