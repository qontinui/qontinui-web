/**
 * Image Organization Service
 *
 * Comprehensive service for organizing image libraries in large projects (100+ images) with:
 * - Folder management with hierarchical structure
 * - Tags and metadata management
 * - Collections/Sets for grouping related images
 * - Advanced search and filtering
 * - Bulk operations for efficiency
 * - Usage tracking across workflows and states
 * - Version history for image updates
 * - Import/export functionality
 * - localStorage persistence with S3 integration
 */

// ============================================================================
// TypeScript Types and Interfaces
// ============================================================================

/**
 * Image Folder - Hierarchical folder structure for organizing images
 */
export interface ImageFolder {
  id: string;
  name: string;
  parentId: string | null;
  color?: string; // Hex color for visual organization
  icon?: string; // Icon name or emoji
  description?: string;
  order: number; // For sorting within parent
  metadata: {
    created: string;
    updated: string;
    imageCount: number;
    descendantCount: number; // Total images in subfolders
  };
}

/**
 * Extended metadata for images
 */
export interface ImageMetadata {
  imageId: string;
  tags: string[];
  folderId: string | null;
  description?: string;
  dimensions?: {
    width: number;
    height: number;
  };
  fileType?: string;
  originalFileName?: string;
  uploadedBy?: string;
  lastModified: string;
  customFields?: Record<string, unknown>; // Extensible custom metadata
}

/**
 * Image Collection - Named sets of images for organizing related items
 */
export interface ImageCollection {
  id: string;
  name: string;
  description?: string;
  imageIds: string[];
  color?: string;
  icon?: string;
  created: string;
  updated: string;
  metadata?: Record<string, unknown>;
}

/**
 * Search filters for finding images
 */
export interface ImageSearchFilter {
  query?: string; // Text search in name, description, tags
  folderIds?: string[]; // Filter by folders
  tags?: string[]; // Filter by tags (AND/OR based on matchMode)
  tagMatchMode?: "all" | "any"; // Default: 'any'
  dateRange?: {
    start: Date;
    end: Date;
  };
  fileTypes?: string[]; // e.g., ['png', 'jpg', 'gif']
  dimensions?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  };
  usageStatus?: "used" | "unused" | "all"; // Default: 'all'
  collectionIds?: string[]; // Filter by collections
  source?: Array<
    "uploaded" | "pattern_optimization" | "image_extraction" | "state_discovery"
  >;
}

/**
 * Usage record for tracking where images are used
 */
export interface ImageUsageRecord {
  imageId: string;
  usedIn: {
    type: "workflow" | "state" | "pattern" | "other";
    id: string;
    name: string;
    location?: string; // Additional context
  }[];
  lastUsed?: string;
  totalUsageCount: number;
}

/**
 * Image version for version history
 */
export interface ImageVersion {
  id: string;
  imageId: string; // Parent image ID
  versionNumber: number;
  url: string; // S3 URL or base64
  s3_key?: string;
  description?: string;
  created: string;
  createdBy?: string;
  fileSize: number;
  isPrimary: boolean; // True for current/active version
}

/**
 * Folder tree node for hierarchical display
 */
export interface FolderTreeNode {
  folder: ImageFolder;
  children: FolderTreeNode[];
  images: string[]; // Image IDs in this folder
  depth: number;
  path: string[]; // Array of folder names from root to this folder
}

/**
 * Search result with highlighting and context
 */
export interface ImageSearchResult {
  imageIds: string[];
  totalCount: number;
  metadata: Record<string, ImageMetadata>;
  highlightedFields?: Record<string, string[]>; // Fields that matched the query
}

/**
 * Operation result
 */
export interface OperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  warnings?: string[];
}

/**
 * Bulk operation result
 */
export interface BulkOperationResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  errors: Array<{ imageId: string; error: string }>;
  warnings?: string[];
}

/**
 * Storage data structure
 */
export interface ImageOrganizationData {
  version: number;
  folders: ImageFolder[];
  metadata: ImageMetadata[];
  collections: ImageCollection[];
  usageRecords: ImageUsageRecord[];
  versions: ImageVersion[];
  lastUpdated: string;
}

/**
 * Import/Export data format
 */
export interface ImportExportData {
  version: number;
  exportDate: string;
  folders?: ImageFolder[];
  metadata?: ImageMetadata[];
  collections?: ImageCollection[];
  includeImages?: boolean; // If true, includes base64 image data
  images?: Array<{
    id: string;
    data: string; // base64
    metadata: ImageMetadata;
  }>;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_VERSION = 1;
const STORAGE_KEY = "qontinui_image_organization";

const MAX_FOLDER_DEPTH = 10;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS_PER_IMAGE = 50;
const MAX_COLLECTION_SIZE = 1000;

// ============================================================================
// Image Organization Service Class
// ============================================================================

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

  // ==========================================================================
  // FOLDER MANAGEMENT
  // ==========================================================================

  /**
   * Create a new image folder
   */
  createImageFolder(
    name: string,
    parentId?: string,
    color?: string,
    icon?: string
  ): OperationResult<ImageFolder> {
    try {
      // Validate folder name
      const nameValidation = this.validateFolderName(name, parentId);
      if (!nameValidation.success) {
        return nameValidation as OperationResult<ImageFolder>;
      }

      // Validate parent exists
      if (parentId && !this.folders.has(parentId)) {
        return {
          success: false,
          error: `Parent folder not found: ${parentId}`,
        };
      }

      // Validate depth
      const depth = this.calculateFolderDepth(parentId);
      if (depth >= MAX_FOLDER_DEPTH) {
        return {
          success: false,
          error: `Maximum folder depth (${MAX_FOLDER_DEPTH}) exceeded`,
        };
      }

      // Create folder
      const folder: ImageFolder = {
        id: this.generateId("folder"),
        name: name.trim(),
        parentId: parentId || null,
        color: color,
        icon: icon,
        order: this.getNextFolderOrder(parentId),
        metadata: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          imageCount: 0,
          descendantCount: 0,
        },
      };

      this.folders.set(folder.id, folder);
      this.updateFolderCounts(folder.parentId);
      this.save();

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
  updateImageFolder(
    id: string,
    updates: Partial<
      Pick<ImageFolder, "name" | "color" | "icon" | "description" | "order">
    >
  ): OperationResult<ImageFolder> {
    try {
      const folder = this.folders.get(id);
      if (!folder) {
        return {
          success: false,
          error: `Folder not found: ${id}`,
        };
      }

      // Validate name if changing
      if (updates.name && updates.name !== folder.name) {
        const nameValidation = this.validateFolderName(
          updates.name,
          folder.parentId,
          id
        );
        if (!nameValidation.success) {
          return nameValidation as OperationResult<ImageFolder>;
        }
      }

      // Update folder
      const updatedFolder: ImageFolder = {
        ...folder,
        ...updates,
        name: updates.name?.trim() || folder.name,
        metadata: {
          ...folder.metadata,
          updated: new Date().toISOString(),
        },
      };

      this.folders.set(id, updatedFolder);
      this.save();

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
  deleteImageFolder(
    id: string,
    options?: {
      moveImagesToParent?: boolean; // If true, moves images to parent folder
      recursive?: boolean; // If true, deletes subfolders too
    }
  ): OperationResult<void> {
    try {
      const folder = this.folders.get(id);
      if (!folder) {
        return {
          success: false,
          error: `Folder not found: ${id}`,
        };
      }

      // Check for subfolders
      const subfolders = this.getSubfolders(id);
      if (subfolders.length > 0 && !options?.recursive) {
        return {
          success: false,
          error: `Folder contains ${subfolders.length} subfolders. Use recursive option to delete all.`,
        };
      }

      // Handle images in folder
      const imagesInFolder = this.getImagesInFolder(id, false).data || [];
      if (imagesInFolder.length > 0) {
        if (options?.moveImagesToParent) {
          // Move images to parent folder
          imagesInFolder.forEach((imageId) => {
            const meta = this.metadata.get(imageId);
            if (meta) {
              meta.folderId = folder.parentId;
              this.metadata.set(imageId, meta);
            }
          });
        } else {
          // Unassign images from folder
          imagesInFolder.forEach((imageId) => {
            const meta = this.metadata.get(imageId);
            if (meta) {
              meta.folderId = null;
              this.metadata.set(imageId, meta);
            }
          });
        }
      }

      // Delete subfolders if recursive
      if (options?.recursive) {
        subfolders.forEach((subfolder) => {
          this.deleteImageFolder(subfolder.id, options);
        });
      }

      // Delete folder
      this.folders.delete(id);
      this.updateFolderCounts(folder.parentId);
      this.save();

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
  getImageFolder(id: string): OperationResult<ImageFolder> {
    const folder = this.folders.get(id);
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
  getAllImageFolders(): OperationResult<ImageFolder[]> {
    return {
      success: true,
      data: Array.from(this.folders.values()).sort((a, b) => a.order - b.order),
    };
  }

  /**
   * Get folder tree structure
   */
  getImageFolderTree(): OperationResult<FolderTreeNode[]> {
    try {
      const rootFolders = Array.from(this.folders.values())
        .filter((f) => f.parentId === null)
        .sort((a, b) => a.order - b.order);

      const buildTree = (
        folder: ImageFolder,
        depth: number,
        path: string[]
      ): FolderTreeNode => {
        const images = Array.from(this.metadata.values())
          .filter((m) => m.folderId === folder.id)
          .map((m) => m.imageId);

        const children = Array.from(this.folders.values())
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
  moveImageToFolder(
    imageId: string,
    folderId: string | null
  ): OperationResult<void> {
    try {
      // Validate folder exists if not null
      if (folderId !== null && !this.folders.has(folderId)) {
        return {
          success: false,
          error: `Folder not found: ${folderId}`,
        };
      }

      // Get or create metadata
      let meta = this.metadata.get(imageId);
      if (!meta) {
        // Create default metadata if doesn't exist
        meta = this.createDefaultMetadata(imageId);
        this.metadata.set(imageId, meta);
      }

      const oldFolderId = meta.folderId;
      meta.folderId = folderId;
      meta.lastModified = new Date().toISOString();

      this.metadata.set(imageId, meta);

      // Update folder counts
      this.updateFolderCounts(oldFolderId);
      this.updateFolderCounts(folderId);

      this.save();

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
  getImagesInFolder(
    folderId: string,
    recursive = false
  ): OperationResult<string[]> {
    try {
      if (!this.folders.has(folderId)) {
        return {
          success: false,
          error: `Folder not found: ${folderId}`,
        };
      }

      const imageIds: string[] = [];

      // Get direct images
      const directImages = Array.from(this.metadata.values())
        .filter((m) => m.folderId === folderId)
        .map((m) => m.imageId);

      imageIds.push(...directImages);

      // Get images from subfolders if recursive
      if (recursive) {
        const subfolders = this.getSubfolders(folderId);
        subfolders.forEach((subfolder) => {
          const subImages = this.getImagesInFolder(subfolder.id, true);
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

  // ==========================================================================
  // TAGS AND METADATA
  // ==========================================================================

  /**
   * Add a tag to an image
   */
  addImageTag(imageId: string, tag: string): OperationResult<void> {
    try {
      const normalizedTag = this.normalizeTag(tag);

      if (!normalizedTag) {
        return {
          success: false,
          error: "Invalid tag",
        };
      }

      if (normalizedTag.length > MAX_TAG_LENGTH) {
        return {
          success: false,
          error: `Tag exceeds maximum length of ${MAX_TAG_LENGTH} characters`,
        };
      }

      let meta = this.metadata.get(imageId);
      if (!meta) {
        meta = this.createDefaultMetadata(imageId);
        this.metadata.set(imageId, meta);
      }

      if (meta.tags.length >= MAX_TAGS_PER_IMAGE) {
        return {
          success: false,
          error: `Maximum number of tags (${MAX_TAGS_PER_IMAGE}) reached`,
        };
      }

      if (meta.tags.includes(normalizedTag)) {
        return {
          success: true,
          warnings: ["Tag already exists on image"],
        };
      }

      meta.tags.push(normalizedTag);
      meta.lastModified = new Date().toISOString();

      this.metadata.set(imageId, meta);
      this.save();

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
  removeImageTag(imageId: string, tag: string): OperationResult<void> {
    try {
      const normalizedTag = this.normalizeTag(tag);
      const meta = this.metadata.get(imageId);

      if (!meta) {
        return {
          success: false,
          error: "Image metadata not found",
        };
      }

      const index = meta.tags.indexOf(normalizedTag);
      if (index === -1) {
        return {
          success: true,
          warnings: ["Tag not found on image"],
        };
      }

      meta.tags.splice(index, 1);
      meta.lastModified = new Date().toISOString();

      this.metadata.set(imageId, meta);
      this.save();

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
  getImagesByTag(tag: string): OperationResult<string[]> {
    try {
      const normalizedTag = this.normalizeTag(tag);
      const imageIds = Array.from(this.metadata.values())
        .filter((m) => m.tags.includes(normalizedTag))
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
  getAllImageTags(): OperationResult<string[]> {
    try {
      const tagsSet = new Set<string>();

      this.metadata.forEach((meta) => {
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
  updateImageMetadata(
    imageId: string,
    metadata: Partial<Omit<ImageMetadata, "imageId" | "lastModified">>
  ): OperationResult<ImageMetadata> {
    try {
      let meta = this.metadata.get(imageId);

      if (!meta) {
        meta = this.createDefaultMetadata(imageId);
      }

      const updatedMeta: ImageMetadata = {
        ...meta,
        ...metadata,
        imageId, // Ensure imageId doesn't change
        lastModified: new Date().toISOString(),
      };

      this.metadata.set(imageId, updatedMeta);
      this.save();

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
  getImageMetadata(imageId: string): OperationResult<ImageMetadata> {
    const meta = this.metadata.get(imageId);

    if (!meta) {
      // Return default metadata if not found
      const defaultMeta = this.createDefaultMetadata(imageId);
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

  // ==========================================================================
  // COLLECTIONS/SETS
  // ==========================================================================

  /**
   * Create a new image collection
   */
  createImageCollection(
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
        id: this.generateId("collection"),
        name: name.trim(),
        description: description?.trim(),
        imageIds: [...new Set(imageIds)], // Remove duplicates
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };

      this.collections.set(collection.id, collection);
      this.save();

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
  addToCollection(
    collectionId: string,
    imageIds: string[]
  ): OperationResult<ImageCollection> {
    try {
      const collection = this.collections.get(collectionId);

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

      this.collections.set(collectionId, updatedCollection);
      this.save();

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
  removeFromCollection(
    collectionId: string,
    imageIds: string[]
  ): OperationResult<ImageCollection> {
    try {
      const collection = this.collections.get(collectionId);

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

      this.collections.set(collectionId, updatedCollection);
      this.save();

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
  getCollection(id: string): OperationResult<ImageCollection> {
    const collection = this.collections.get(id);

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
  getAllCollections(): OperationResult<ImageCollection[]> {
    return {
      success: true,
      data: Array.from(this.collections.values()),
    };
  }

  /**
   * Delete a collection
   */
  deleteCollection(id: string): OperationResult<void> {
    try {
      if (!this.collections.has(id)) {
        return {
          success: false,
          error: `Collection not found: ${id}`,
        };
      }

      this.collections.delete(id);
      this.save();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete collection: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // SEARCH AND FILTER
  // ==========================================================================

  /**
   * Search images with advanced filters
   */
  searchImages(
    query?: string,
    filters?: ImageSearchFilter
  ): OperationResult<ImageSearchResult> {
    try {
      let results = Array.from(this.metadata.values());
      const highlightedFields: Record<string, string[]> = {};

      // Text search
      if (query && query.trim().length > 0) {
        const searchTerm = query.toLowerCase().trim();
        results = results.filter((meta) => {
          const matches: string[] = [];

          // Search in tags
          if (meta.tags.some((tag) => tag.toLowerCase().includes(searchTerm))) {
            matches.push("tags");
          }

          // Search in description
          if (meta.description?.toLowerCase().includes(searchTerm)) {
            matches.push("description");
          }

          // Search in original filename
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
              meta.tags.includes(this.normalizeTag(tag))
            );
          } else {
            return filters.tags!.some((tag) =>
              meta.tags.includes(this.normalizeTag(tag))
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
          const usage = this.usageRecords.get(meta.imageId);
          const isUsed = usage && usage.totalUsageCount > 0;

          return filters.usageStatus === "used" ? isUsed : !isUsed;
        });
      }

      // Collection filter
      if (filters?.collectionIds && filters.collectionIds.length > 0) {
        const imageIdsInCollections = new Set<string>();
        filters.collectionIds.forEach((collId) => {
          const collection = this.collections.get(collId);
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
          // Get image source from customFields if available
          const source = meta.customFields?.source;
          return source && sourceSet.has(source);
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
  filterByUsage(
    workflowIds?: string[],
    stateIds?: string[]
  ): OperationResult<string[]> {
    try {
      const results: string[] = [];

      this.usageRecords.forEach((record, imageId) => {
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

  // ==========================================================================
  // BULK OPERATIONS
  // ==========================================================================

  /**
   * Add tags to multiple images
   */
  bulkTag(imageIds: string[], tags: string[]): BulkOperationResult {
    const errors: Array<{ imageId: string; error: string }> = [];
    let successCount = 0;

    imageIds.forEach((imageId) => {
      let allTagsAdded = true;

      tags.forEach((tag) => {
        const result = this.addImageTag(imageId, tag);
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
  bulkMove(imageIds: string[], folderId: string | null): BulkOperationResult {
    const errors: Array<{ imageId: string; error: string }> = [];
    let successCount = 0;

    imageIds.forEach((imageId) => {
      const result = this.moveImageToFolder(imageId, folderId);
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
  bulkDelete(imageIds: string[]): BulkOperationResult {
    const errors: Array<{ imageId: string; error: string }> = [];
    let successCount = 0;

    imageIds.forEach((imageId) => {
      try {
        // Remove from metadata
        this.metadata.delete(imageId);

        // Remove from collections
        this.collections.forEach((collection) => {
          collection.imageIds = collection.imageIds.filter(
            (id) => id !== imageId
          );
        });

        // Remove usage records
        this.usageRecords.delete(imageId);

        // Remove versions
        this.versions.delete(imageId);

        successCount++;
      } catch (error) {
        errors.push({
          imageId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.save();

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
  bulkDownload(imageIds: string[]): OperationResult<{
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
        const meta = this.metadata.get(imageId);
        if (meta) {
          const filename = meta.originalFileName || `image-${imageId}.png`;
          manifest.push({
            imageId,
            metadata: meta,
            filename,
          });

          // Estimate size from metadata if available
          if (meta.customFields?.fileSize) {
            totalSize += meta.customFields.fileSize;
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

  // ==========================================================================
  // USAGE TRACKING
  // ==========================================================================

  /**
   * Track image usage
   */
  trackImageUsage(
    imageId: string,
    usedIn: {
      type: "workflow" | "state" | "pattern" | "other";
      id: string;
      name: string;
      location?: string;
    }
  ): OperationResult<void> {
    try {
      let record = this.usageRecords.get(imageId);

      if (!record) {
        record = {
          imageId,
          usedIn: [],
          totalUsageCount: 0,
        };
      }

      // Check if already tracked
      const existingIndex = record.usedIn.findIndex(
        (u) => u.type === usedIn.type && u.id === usedIn.id
      );

      if (existingIndex >= 0) {
        // Update existing usage
        record.usedIn[existingIndex] = usedIn;
      } else {
        // Add new usage
        record.usedIn.push(usedIn);
      }

      record.totalUsageCount = record.usedIn.length;
      record.lastUsed = new Date().toISOString();

      this.usageRecords.set(imageId, record);
      this.save();

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
  removeImageUsage(imageId: string, usageId: string): OperationResult<void> {
    try {
      const record = this.usageRecords.get(imageId);

      if (!record) {
        return {
          success: true,
          warnings: ["No usage record found for image"],
        };
      }

      record.usedIn = record.usedIn.filter((u) => u.id !== usageId);
      record.totalUsageCount = record.usedIn.length;

      if (record.usedIn.length === 0) {
        this.usageRecords.delete(imageId);
      } else {
        this.usageRecords.set(imageId, record);
      }

      this.save();

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
  getImageUsage(imageId: string): OperationResult<ImageUsageRecord> {
    const record = this.usageRecords.get(imageId);

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
  findUnusedImages(): OperationResult<string[]> {
    try {
      const allImageIds = Array.from(this.metadata.keys());
      const unusedIds = allImageIds.filter((imageId) => {
        const record = this.usageRecords.get(imageId);
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
  findMostUsedImages(limit = 10): OperationResult<
    Array<{
      imageId: string;
      usageCount: number;
      metadata?: ImageMetadata;
    }>
  > {
    try {
      const usageArray = Array.from(this.usageRecords.values())
        .map((record) => ({
          imageId: record.imageId,
          usageCount: record.totalUsageCount,
          metadata: this.metadata.get(record.imageId),
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

  // ==========================================================================
  // VERSION HISTORY
  // ==========================================================================

  /**
   * Create a new version of an image
   */
  createImageVersion(
    imageId: string,
    url: string,
    description?: string,
    fileSize?: number,
    s3_key?: string
  ): OperationResult<ImageVersion> {
    try {
      const versions = this.versions.get(imageId) || [];

      // Set all existing versions to non-primary
      versions.forEach((v) => {
        v.isPrimary = false;
      });

      const newVersion: ImageVersion = {
        id: this.generateId("version"),
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
      this.versions.set(imageId, versions);
      this.save();

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
  getImageVersions(imageId: string): OperationResult<ImageVersion[]> {
    const versions = this.versions.get(imageId) || [];

    return {
      success: true,
      data: versions.sort((a, b) => b.versionNumber - a.versionNumber),
    };
  }

  /**
   * Rollback to a specific version
   */
  rollbackToVersion(
    imageId: string,
    versionId: string
  ): OperationResult<ImageVersion> {
    try {
      const versions = this.versions.get(imageId);

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

      // Set all versions to non-primary
      versions.forEach((v) => {
        v.isPrimary = false;
      });

      // Set target version as primary
      targetVersion.isPrimary = true;

      this.versions.set(imageId, versions);
      this.save();

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
  deleteImageVersion(
    imageId: string,
    versionId: string
  ): OperationResult<void> {
    try {
      const versions = this.versions.get(imageId);

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
        this.versions.delete(imageId);
      } else {
        this.versions.set(imageId, versions);
      }

      this.save();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete version: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // IMPORT/EXPORT
  // ==========================================================================

  /**
   * Export images and organization data
   */
  exportImages(
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
        const meta = this.metadata.get(imageId);
        if (meta) {
          exportData.metadata!.push(meta);
        }
      });

      // Export folders if requested
      if (includeFolders) {
        const folderIds = new Set<string>();

        // Collect all folders used by the images
        exportData.metadata!.forEach((meta) => {
          if (meta.folderId) {
            folderIds.add(meta.folderId);

            // Add parent folders
            let currentFolder = this.folders.get(meta.folderId);
            while (currentFolder?.parentId) {
              folderIds.add(currentFolder.parentId);
              currentFolder = this.folders.get(currentFolder.parentId);
            }
          }
        });

        exportData.folders = Array.from(folderIds)
          .map((id) => this.folders.get(id))
          .filter((f): f is ImageFolder => f !== undefined);
      }

      // Export collections that contain any of the selected images
      const imageIdSet = new Set(imageIds);
      this.collections.forEach((collection) => {
        const hasImages = collection.imageIds.some((id) => imageIdSet.has(id));
        if (hasImages) {
          // Only include images that are in the export
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
  importImages(data: ImportExportData): OperationResult<{
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
        const folderIdMap = new Map<string, string>(); // old ID -> new ID

        // Sort folders by depth (parents first)
        const sortedFolders = [...data.folders].sort((a, b) => {
          const depthA = this.calculateFolderDepthFromFolder(a, data.folders!);
          const depthB = this.calculateFolderDepthFromFolder(b, data.folders!);
          return depthA - depthB;
        });

        sortedFolders.forEach((folder) => {
          const oldId = folder.id;
          const newFolder = {
            ...folder,
            id: this.generateId("folder"),
            parentId: folder.parentId
              ? folderIdMap.get(folder.parentId) || null
              : null,
          };

          this.folders.set(newFolder.id, newFolder);
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
          // Generate new ID if already exists
          let newId = meta.imageId;
          if (this.metadata.has(newId)) {
            newId = this.generateId("image");
          }

          const newMeta = {
            ...meta,
            imageId: newId,
            lastModified: new Date().toISOString(),
          };

          this.metadata.set(newId, newMeta);
          importedImages++;
        });
      }

      // Import collections
      if (data.collections) {
        data.collections.forEach((collection) => {
          const newCollection = {
            ...collection,
            id: this.generateId("collection"),
            updated: new Date().toISOString(),
          };

          this.collections.set(newCollection.id, newCollection);
          importedCollections++;
        });
      }

      this.save();

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
  exportAllData(): OperationResult<ImageOrganizationData> {
    try {
      const data: ImageOrganizationData = {
        version: STORAGE_VERSION,
        folders: Array.from(this.folders.values()),
        metadata: Array.from(this.metadata.values()),
        collections: Array.from(this.collections.values()),
        usageRecords: Array.from(this.usageRecords.values()),
        versions: Array.from(this.versions.entries()).flatMap(
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
  importAllData(data: ImageOrganizationData): OperationResult<void> {
    try {
      // Clear existing data
      this.folders.clear();
      this.metadata.clear();
      this.collections.clear();
      this.usageRecords.clear();
      this.versions.clear();

      // Import folders
      data.folders.forEach((folder) => {
        this.folders.set(folder.id, folder);
      });

      // Import metadata
      data.metadata.forEach((meta) => {
        this.metadata.set(meta.imageId, meta);
      });

      // Import collections
      data.collections.forEach((collection) => {
        this.collections.set(collection.id, collection);
      });

      // Import usage records
      data.usageRecords.forEach((record) => {
        this.usageRecords.set(record.imageId, record);
      });

      // Import versions
      data.versions.forEach((version) => {
        const imageVersions = this.versions.get(version.imageId) || [];
        imageVersions.push(version);
        this.versions.set(version.imageId, imageVersions);
      });

      this.save();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Import all failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // UTILITY AND HELPER METHODS
  // ==========================================================================

  /**
   * Generate unique ID with prefix
   */
  private generateId(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Normalize tag for consistent storage
   */
  private normalizeTag(tag: string): string {
    return tag.trim().toLowerCase();
  }

  /**
   * Create default metadata for an image
   */
  private createDefaultMetadata(imageId: string): ImageMetadata {
    return {
      imageId,
      tags: [],
      folderId: null,
      lastModified: new Date().toISOString(),
    };
  }

  /**
   * Validate folder name
   */
  private validateFolderName(
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

    // Check for duplicate names in same parent
    const siblings = Array.from(this.folders.values()).filter(
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
  private calculateFolderDepth(folderId?: string | null): number {
    if (!folderId) return 0;

    let depth = 0;
    let currentId: string | null = folderId;

    while (currentId) {
      depth++;
      const folder = this.folders.get(currentId);
      currentId = folder?.parentId || null;

      // Prevent infinite loops
      if (depth > MAX_FOLDER_DEPTH) break;
    }

    return depth;
  }

  /**
   * Calculate folder depth from folder object (for import)
   */
  private calculateFolderDepthFromFolder(
    folder: ImageFolder,
    allFolders: ImageFolder[]
  ): number {
    let depth = 0;
    let currentFolder: ImageFolder | undefined = folder;

    while (currentFolder?.parentId) {
      depth++;
      currentFolder = allFolders.find((f) => f.id === currentFolder!.parentId);

      // Prevent infinite loops
      if (depth > MAX_FOLDER_DEPTH) break;
    }

    return depth;
  }

  /**
   * Get next order number for folders
   */
  private getNextFolderOrder(parentId?: string | null): number {
    const siblings = Array.from(this.folders.values()).filter(
      (f) => f.parentId === (parentId || null)
    );

    if (siblings.length === 0) return 0;

    return Math.max(...siblings.map((f) => f.order)) + 1;
  }

  /**
   * Get subfolders of a folder
   */
  private getSubfolders(folderId: string): ImageFolder[] {
    return Array.from(this.folders.values()).filter(
      (f) => f.parentId === folderId
    );
  }

  /**
   * Update folder image counts recursively
   */
  private updateFolderCounts(folderId: string | null): void {
    if (!folderId) return;

    const folder = this.folders.get(folderId);
    if (!folder) return;

    // Count direct images
    const imageCount = Array.from(this.metadata.values()).filter(
      (m) => m.folderId === folderId
    ).length;

    // Count descendant images
    const subfolders = this.getSubfolders(folderId);
    let descendantCount = imageCount;

    subfolders.forEach((subfolder) => {
      this.updateFolderCounts(subfolder.id);
      const sub = this.folders.get(subfolder.id);
      if (sub) {
        descendantCount += sub.metadata.descendantCount;
      }
    });

    folder.metadata.imageCount = imageCount;
    folder.metadata.descendantCount = descendantCount;
    folder.metadata.updated = new Date().toISOString();

    this.folders.set(folderId, folder);

    // Update parent recursively
    if (folder.parentId) {
      this.updateFolderCounts(folder.parentId);
    }
  }

  /**
   * Debounced save to localStorage
   */
  private save(): void {
    if (!this.autoSaveEnabled) return;

    if (this.saveTimeoutId) {
      clearTimeout(this.saveTimeoutId);
    }

    this.saveTimeoutId = setTimeout(() => {
      this.saveToStorage();
    }, 500); // 500ms debounce
  }

  /**
   * Save to localStorage
   */
  private saveToStorage(): void {
    try {
      if (typeof window === "undefined") return;

      const data: ImageOrganizationData = {
        version: STORAGE_VERSION,
        folders: Array.from(this.folders.values()),
        metadata: Array.from(this.metadata.values()),
        collections: Array.from(this.collections.values()),
        usageRecords: Array.from(this.usageRecords.values()),
        versions: Array.from(this.versions.entries()).flatMap(
          ([_, versions]) => versions
        ),
        lastUpdated: new Date().toISOString(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save image organization data:", error);
    }
  }

  /**
   * Load from localStorage
   */
  private loadFromStorage(): void {
    try {
      if (typeof window === "undefined") return;

      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const data: ImageOrganizationData = JSON.parse(stored);

      // Load folders
      this.folders.clear();
      data.folders.forEach((folder) => {
        this.folders.set(folder.id, folder);
      });

      // Load metadata
      this.metadata.clear();
      data.metadata.forEach((meta) => {
        this.metadata.set(meta.imageId, meta);
      });

      // Load collections
      this.collections.clear();
      data.collections.forEach((collection) => {
        this.collections.set(collection.id, collection);
      });

      // Load usage records
      this.usageRecords.clear();
      data.usageRecords.forEach((record) => {
        this.usageRecords.set(record.imageId, record);
      });

      // Load versions
      this.versions.clear();
      data.versions.forEach((version) => {
        const imageVersions = this.versions.get(version.imageId) || [];
        imageVersions.push(version);
        this.versions.set(version.imageId, imageVersions);
      });
    } catch (error) {
      console.error("Failed to load image organization data:", error);
    }
  }

  /**
   * Clear all data
   */
  clearAllData(): OperationResult<void> {
    try {
      this.folders.clear();
      this.metadata.clear();
      this.collections.clear();
      this.usageRecords.clear();
      this.versions.clear();

      this.saveToStorage();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to clear data: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get statistics about the image library
   */
  getStatistics(): OperationResult<{
    totalImages: number;
    totalFolders: number;
    totalCollections: number;
    totalTags: number;
    usedImages: number;
    unusedImages: number;
    totalVersions: number;
  }> {
    try {
      const allTags = this.getAllImageTags();
      const unusedImages = this.findUnusedImages();

      const totalVersions = Array.from(this.versions.values()).reduce(
        (sum, versions) => sum + versions.length,
        0
      );

      return {
        success: true,
        data: {
          totalImages: this.metadata.size,
          totalFolders: this.folders.size,
          totalCollections: this.collections.size,
          totalTags: allTags.data?.length || 0,
          usedImages: this.usageRecords.size,
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

  /**
   * Enable or disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }

  /**
   * Force immediate save
   */
  forceSave(): void {
    if (this.saveTimeoutId) {
      clearTimeout(this.saveTimeoutId);
    }
    this.saveToStorage();
  }
}

// ==========================================================================
// SINGLETON EXPORT
// ==========================================================================

/**
 * Get the singleton instance of ImageOrganizationService
 */
export const getImageOrganizationService = (): ImageOrganizationService => {
  return ImageOrganizationService.getInstance();
};

/**
 * Default export
 */
export default ImageOrganizationService;
