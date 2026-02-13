/**
 * Image Organization Service
 *
 * Barrel module that re-exports all types and composes the singleton service.
 */

// Re-export all types
export type {
  ImageFolder,
  ImageMetadata,
  ImageCollection,
  ImageSearchFilter,
  ImageUsageRecord,
  ImageVersion,
  FolderTreeNode,
  ImageSearchResult,
  OperationResult,
  BulkOperationResult,
  ImageOrganizationData,
  ImportExportData,
} from "./types";

export {
  STORAGE_VERSION,
  STORAGE_KEY,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_NAME_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_IMAGE,
  MAX_COLLECTION_SIZE,
} from "./types";

// Re-export sub-module functions for direct use
export {
  createImageFolder,
  updateImageFolder,
  deleteImageFolder,
  getImageFolder,
  getAllImageFolders,
  getImageFolderTree,
  moveImageToFolder,
  getImagesInFolder,
  validateFolderName,
  calculateFolderDepth,
  calculateFolderDepthFromFolder,
  getNextFolderOrder,
  getSubfolders,
  updateFolderCounts,
} from "./folder-manager";
export type { FolderManagerDeps } from "./folder-manager";

export {
  createImageCollection,
  addToCollection,
  removeFromCollection,
  getCollection,
  getAllCollections,
  deleteCollection,
} from "./collection-manager";
export type { CollectionManagerDeps } from "./collection-manager";

export {
  normalizeTag,
  createDefaultMetadata,
  addImageTag,
  removeImageTag,
  getImagesByTag,
  getAllImageTags,
  updateImageMetadata,
  getImageMetadata,
  trackImageUsage,
  removeImageUsage,
  getImageUsage,
  findUnusedImages,
  findMostUsedImages,
  createImageVersion,
  getImageVersions,
  rollbackToVersion,
  deleteImageVersion,
} from "./metadata-manager";
export type { MetadataManagerDeps } from "./metadata-manager";

export { searchImages, filterByUsage } from "./search-filter";
export type { SearchFilterDeps } from "./search-filter";

export {
  bulkTag,
  bulkMove,
  bulkDelete,
  bulkDownload,
} from "./bulk-operations";
export type { BulkOperationsDeps } from "./bulk-operations";

export {
  saveToStorage,
  loadFromStorage,
  clearAllData,
  exportImages,
  importImages,
  exportAllData,
  importAllData,
  getStatistics,
} from "./persistence";
export type { PersistenceDeps } from "./persistence";

// ============================================================================
// Imports for the composed class
// ============================================================================

import type {
  ImageFolder,
  ImageMetadata,
  ImageCollection,
  ImageUsageRecord,
  ImageVersion,
  ImageSearchFilter,
  ImageSearchResult,
  ImageOrganizationData,
  ImportExportData,
  OperationResult,
  BulkOperationResult,
} from "./types";

import * as folderMgr from "./folder-manager";
import * as collectionMgr from "./collection-manager";
import * as metadataMgr from "./metadata-manager";
import * as searchFilter from "./search-filter";
import * as bulkOps from "./bulk-operations";
import * as persistence from "./persistence";

// ============================================================================
// Composed Singleton Class
// ============================================================================

/**
 * ImageOrganizationService composes all sub-modules into a single facade
 * that preserves the original class API for backward compatibility.
 */
export class ImageOrganizationService {
  private static instance: ImageOrganizationService;

  private folders: Map<string, ImageFolder> = new Map();
  private metadata: Map<string, ImageMetadata> = new Map();
  private collections: Map<string, ImageCollection> = new Map();
  private usageRecords: Map<string, ImageUsageRecord> = new Map();
  private versions: Map<string, ImageVersion[]> = new Map();

  private autoSaveEnabled = true;
  private saveTimeoutId: NodeJS.Timeout | null = null;

  private constructor() {
    this.loadFromStorage();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ImageOrganizationService {
    if (!ImageOrganizationService.instance) {
      ImageOrganizationService.instance = new ImageOrganizationService();
    }
    return ImageOrganizationService.instance;
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private generateId(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `${prefix}_${timestamp}_${random}`;
  }

  private get folderDeps(): folderMgr.FolderManagerDeps {
    return {
      folders: this.folders,
      metadata: this.metadata,
      generateId: (p: string) => this.generateId(p),
      save: () => this.save(),
    };
  }

  private get collectionDeps(): collectionMgr.CollectionManagerDeps {
    return {
      collections: this.collections,
      generateId: (p: string) => this.generateId(p),
      save: () => this.save(),
    };
  }

  private get metadataDeps(): metadataMgr.MetadataManagerDeps {
    return {
      metadata: this.metadata,
      usageRecords: this.usageRecords,
      versions: this.versions,
      generateId: (p: string) => this.generateId(p),
      save: () => this.save(),
    };
  }

  private get searchDeps(): searchFilter.SearchFilterDeps {
    return {
      metadata: this.metadata,
      collections: this.collections,
      usageRecords: this.usageRecords,
    };
  }

  private get bulkDeps(): bulkOps.BulkOperationsDeps {
    return {
      metadata: this.metadata,
      collections: this.collections,
      usageRecords: this.usageRecords,
      versions: this.versions,
      folders: this.folders,
      generateId: (p: string) => this.generateId(p),
      save: () => this.save(),
      createDefaultMetadata: metadataMgr.createDefaultMetadata,
    };
  }

  private get persistenceDeps(): persistence.PersistenceDeps {
    return {
      folders: this.folders,
      metadata: this.metadata,
      collections: this.collections,
      usageRecords: this.usageRecords,
      versions: this.versions,
      generateId: (p: string) => this.generateId(p),
    };
  }

  // --------------------------------------------------------------------------
  // Folder Management
  // --------------------------------------------------------------------------

  createImageFolder(
    name: string,
    parentId?: string,
    color?: string,
    icon?: string
  ): OperationResult<ImageFolder> {
    return folderMgr.createImageFolder(
      this.folderDeps,
      name,
      parentId,
      color,
      icon
    );
  }

  updateImageFolder(
    id: string,
    updates: Partial<
      Pick<ImageFolder, "name" | "color" | "icon" | "description" | "order">
    >
  ): OperationResult<ImageFolder> {
    return folderMgr.updateImageFolder(this.folderDeps, id, updates);
  }

  deleteImageFolder(
    id: string,
    options?: {
      moveImagesToParent?: boolean;
      recursive?: boolean;
    }
  ): OperationResult<void> {
    return folderMgr.deleteImageFolder(this.folderDeps, id, options);
  }

  getImageFolder(id: string): OperationResult<ImageFolder> {
    return folderMgr.getImageFolder(this.folderDeps, id);
  }

  getAllImageFolders(): OperationResult<ImageFolder[]> {
    return folderMgr.getAllImageFolders(this.folderDeps);
  }

  getImageFolderTree(): OperationResult<import("./types").FolderTreeNode[]> {
    return folderMgr.getImageFolderTree(this.folderDeps);
  }

  moveImageToFolder(
    imageId: string,
    folderId: string | null
  ): OperationResult<void> {
    return folderMgr.moveImageToFolder(
      this.folderDeps,
      imageId,
      folderId,
      metadataMgr.createDefaultMetadata
    );
  }

  getImagesInFolder(
    folderId: string,
    recursive = false
  ): OperationResult<string[]> {
    return folderMgr.getImagesInFolder(this.folderDeps, folderId, recursive);
  }

  // --------------------------------------------------------------------------
  // Tags and Metadata
  // --------------------------------------------------------------------------

  addImageTag(imageId: string, tag: string): OperationResult<void> {
    return metadataMgr.addImageTag(this.metadataDeps, imageId, tag);
  }

  removeImageTag(imageId: string, tag: string): OperationResult<void> {
    return metadataMgr.removeImageTag(this.metadataDeps, imageId, tag);
  }

  getImagesByTag(tag: string): OperationResult<string[]> {
    return metadataMgr.getImagesByTag(this.metadataDeps, tag);
  }

  getAllImageTags(): OperationResult<string[]> {
    return metadataMgr.getAllImageTags(this.metadataDeps);
  }

  updateImageMetadata(
    imageId: string,
    metadata: Partial<Omit<ImageMetadata, "imageId" | "lastModified">>
  ): OperationResult<ImageMetadata> {
    return metadataMgr.updateImageMetadata(
      this.metadataDeps,
      imageId,
      metadata
    );
  }

  getImageMetadata(imageId: string): OperationResult<ImageMetadata> {
    return metadataMgr.getImageMetadata(this.metadataDeps, imageId);
  }

  // --------------------------------------------------------------------------
  // Collections
  // --------------------------------------------------------------------------

  createImageCollection(
    name: string,
    description?: string,
    imageIds: string[] = []
  ): OperationResult<ImageCollection> {
    return collectionMgr.createImageCollection(
      this.collectionDeps,
      name,
      description,
      imageIds
    );
  }

  addToCollection(
    collectionId: string,
    imageIds: string[]
  ): OperationResult<ImageCollection> {
    return collectionMgr.addToCollection(
      this.collectionDeps,
      collectionId,
      imageIds
    );
  }

  removeFromCollection(
    collectionId: string,
    imageIds: string[]
  ): OperationResult<ImageCollection> {
    return collectionMgr.removeFromCollection(
      this.collectionDeps,
      collectionId,
      imageIds
    );
  }

  getCollection(id: string): OperationResult<ImageCollection> {
    return collectionMgr.getCollection(this.collectionDeps, id);
  }

  getAllCollections(): OperationResult<ImageCollection[]> {
    return collectionMgr.getAllCollections(this.collectionDeps);
  }

  deleteCollection(id: string): OperationResult<void> {
    return collectionMgr.deleteCollection(this.collectionDeps, id);
  }

  // --------------------------------------------------------------------------
  // Search and Filter
  // --------------------------------------------------------------------------

  searchImages(
    query?: string,
    filters?: ImageSearchFilter
  ): OperationResult<ImageSearchResult> {
    return searchFilter.searchImages(this.searchDeps, query, filters);
  }

  filterByUsage(
    workflowIds?: string[],
    stateIds?: string[]
  ): OperationResult<string[]> {
    return searchFilter.filterByUsage(this.searchDeps, workflowIds, stateIds);
  }

  // --------------------------------------------------------------------------
  // Bulk Operations
  // --------------------------------------------------------------------------

  bulkTag(imageIds: string[], tags: string[]): BulkOperationResult {
    return bulkOps.bulkTag(this.bulkDeps, imageIds, tags);
  }

  bulkMove(imageIds: string[], folderId: string | null): BulkOperationResult {
    return bulkOps.bulkMove(this.bulkDeps, imageIds, folderId);
  }

  bulkDelete(imageIds: string[]): BulkOperationResult {
    return bulkOps.bulkDelete(this.bulkDeps, imageIds);
  }

  bulkDownload(imageIds: string[]): OperationResult<{
    manifest: Array<{
      imageId: string;
      metadata: ImageMetadata;
      filename: string;
    }>;
    totalSize: number;
  }> {
    return bulkOps.bulkDownload(this.bulkDeps, imageIds);
  }

  // --------------------------------------------------------------------------
  // Usage Tracking
  // --------------------------------------------------------------------------

  trackImageUsage(
    imageId: string,
    usedIn: {
      type: "workflow" | "state" | "pattern" | "other";
      id: string;
      name: string;
      location?: string;
    }
  ): OperationResult<void> {
    return metadataMgr.trackImageUsage(this.metadataDeps, imageId, usedIn);
  }

  removeImageUsage(imageId: string, usageId: string): OperationResult<void> {
    return metadataMgr.removeImageUsage(this.metadataDeps, imageId, usageId);
  }

  getImageUsage(imageId: string): OperationResult<ImageUsageRecord> {
    return metadataMgr.getImageUsage(this.metadataDeps, imageId);
  }

  findUnusedImages(): OperationResult<string[]> {
    return metadataMgr.findUnusedImages(this.metadataDeps);
  }

  findMostUsedImages(limit = 10): OperationResult<
    Array<{
      imageId: string;
      usageCount: number;
      metadata?: ImageMetadata;
    }>
  > {
    return metadataMgr.findMostUsedImages(this.metadataDeps, limit);
  }

  // --------------------------------------------------------------------------
  // Version History
  // --------------------------------------------------------------------------

  createImageVersion(
    imageId: string,
    url: string,
    description?: string,
    fileSize?: number,
    s3_key?: string
  ): OperationResult<ImageVersion> {
    return metadataMgr.createImageVersion(
      this.metadataDeps,
      imageId,
      url,
      description,
      fileSize,
      s3_key
    );
  }

  getImageVersions(imageId: string): OperationResult<ImageVersion[]> {
    return metadataMgr.getImageVersions(this.metadataDeps, imageId);
  }

  rollbackToVersion(
    imageId: string,
    versionId: string
  ): OperationResult<ImageVersion> {
    return metadataMgr.rollbackToVersion(
      this.metadataDeps,
      imageId,
      versionId
    );
  }

  deleteImageVersion(
    imageId: string,
    versionId: string
  ): OperationResult<void> {
    return metadataMgr.deleteImageVersion(
      this.metadataDeps,
      imageId,
      versionId
    );
  }

  // --------------------------------------------------------------------------
  // Import/Export
  // --------------------------------------------------------------------------

  exportImages(
    imageIds: string[],
    includeFolders = true
  ): OperationResult<ImportExportData> {
    return persistence.exportImages(
      this.persistenceDeps,
      imageIds,
      includeFolders
    );
  }

  importImages(data: ImportExportData): OperationResult<{
    importedImages: number;
    importedFolders: number;
    importedCollections: number;
  }> {
    return persistence.importImages(this.persistenceDeps, data, () =>
      this.save()
    );
  }

  exportAllData(): OperationResult<ImageOrganizationData> {
    return persistence.exportAllData(this.persistenceDeps);
  }

  importAllData(data: ImageOrganizationData): OperationResult<void> {
    return persistence.importAllData(this.persistenceDeps, data, () =>
      this.save()
    );
  }

  // --------------------------------------------------------------------------
  // Persistence & Statistics
  // --------------------------------------------------------------------------

  clearAllData(): OperationResult<void> {
    return persistence.clearAllData(this.persistenceDeps);
  }

  getStatistics(): OperationResult<{
    totalImages: number;
    totalFolders: number;
    totalCollections: number;
    totalTags: number;
    usedImages: number;
    unusedImages: number;
    totalVersions: number;
  }> {
    return persistence.getStatistics(
      this.persistenceDeps,
      () => this.getAllImageTags(),
      () => this.findUnusedImages()
    );
  }

  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }

  forceSave(): void {
    if (this.saveTimeoutId) {
      clearTimeout(this.saveTimeoutId);
    }
    persistence.saveToStorage(this.persistenceDeps);
  }

  // --------------------------------------------------------------------------
  // Private persistence helpers
  // --------------------------------------------------------------------------

  private save(): void {
    if (!this.autoSaveEnabled) return;

    if (this.saveTimeoutId) {
      clearTimeout(this.saveTimeoutId);
    }

    this.saveTimeoutId = setTimeout(() => {
      persistence.saveToStorage(this.persistenceDeps);
    }, 500);
  }

  private loadFromStorage(): void {
    persistence.loadFromStorage(this.persistenceDeps);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Get the singleton instance of ImageOrganizationService
 */
export const getImageOrganizationService = (): ImageOrganizationService => {
  return ImageOrganizationService.getInstance();
};

export default ImageOrganizationService;
