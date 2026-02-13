/**
 * Collection Manager
 *
 * Handles image collection CRUD operations.
 */

import type { ImageCollection, OperationResult } from "./types";
import { MAX_COLLECTION_SIZE } from "./types";

// ============================================================================
// Dependencies
// ============================================================================

export interface CollectionManagerDeps {
  collections: Map<string, ImageCollection>;
  generateId: (prefix: string) => string;
  save: () => void;
}

// ============================================================================
// Collection Operations
// ============================================================================

/**
 * Create a new image collection
 */
export function createImageCollection(
  deps: CollectionManagerDeps,
  name: string,
  description?: string,
  imageIds: string[] = []
): OperationResult<ImageCollection> {
  try {
    if (!name || name.trim().length === 0) {
      return {
        success: false,
        error: "Collection name is required",
      };
    }

    if (imageIds.length > MAX_COLLECTION_SIZE) {
      return {
        success: false,
        error: `Collection size exceeds maximum of ${MAX_COLLECTION_SIZE} images`,
      };
    }

    const collection: ImageCollection = {
      id: deps.generateId("collection"),
      name: name.trim(),
      description: description?.trim(),
      imageIds: [...new Set(imageIds)],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    deps.collections.set(collection.id, collection);
    deps.save();

    return {
      success: true,
      data: collection,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to create collection: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Add images to a collection
 */
export function addToCollection(
  deps: CollectionManagerDeps,
  collectionId: string,
  imageIds: string[]
): OperationResult<ImageCollection> {
  try {
    const collection = deps.collections.get(collectionId);

    if (!collection) {
      return {
        success: false,
        error: `Collection not found: ${collectionId}`,
      };
    }

    const currentSet = new Set(collection.imageIds);
    imageIds.forEach((id) => currentSet.add(id));

    if (currentSet.size > MAX_COLLECTION_SIZE) {
      return {
        success: false,
        error: `Collection would exceed maximum size of ${MAX_COLLECTION_SIZE} images`,
      };
    }

    const updatedCollection: ImageCollection = {
      ...collection,
      imageIds: Array.from(currentSet),
      updated: new Date().toISOString(),
    };

    deps.collections.set(collectionId, updatedCollection);
    deps.save();

    return {
      success: true,
      data: updatedCollection,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to add to collection: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Remove images from a collection
 */
export function removeFromCollection(
  deps: CollectionManagerDeps,
  collectionId: string,
  imageIds: string[]
): OperationResult<ImageCollection> {
  try {
    const collection = deps.collections.get(collectionId);

    if (!collection) {
      return {
        success: false,
        error: `Collection not found: ${collectionId}`,
      };
    }

    const idsToRemove = new Set(imageIds);
    const updatedImageIds = collection.imageIds.filter(
      (id) => !idsToRemove.has(id)
    );

    const updatedCollection: ImageCollection = {
      ...collection,
      imageIds: updatedImageIds,
      updated: new Date().toISOString(),
    };

    deps.collections.set(collectionId, updatedCollection);
    deps.save();

    return {
      success: true,
      data: updatedCollection,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to remove from collection: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Get a collection by ID
 */
export function getCollection(
  deps: CollectionManagerDeps,
  id: string
): OperationResult<ImageCollection> {
  const collection = deps.collections.get(id);

  if (!collection) {
    return {
      success: false,
      error: `Collection not found: ${id}`,
    };
  }

  return {
    success: true,
    data: collection,
  };
}

/**
 * Get all collections
 */
export function getAllCollections(
  deps: CollectionManagerDeps
): OperationResult<ImageCollection[]> {
  return {
    success: true,
    data: Array.from(deps.collections.values()),
  };
}

/**
 * Delete a collection
 */
export function deleteCollection(
  deps: CollectionManagerDeps,
  id: string
): OperationResult<void> {
  try {
    if (!deps.collections.has(id)) {
      return {
        success: false,
        error: `Collection not found: ${id}`,
      };
    }

    deps.collections.delete(id);
    deps.save();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete collection: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
