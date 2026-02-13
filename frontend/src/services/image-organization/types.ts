/**
 * Image Organization Types
 *
 * All interfaces, types, and enums for the image organization system.
 */

// ============================================================================
// Interfaces
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

export const STORAGE_VERSION = 1;
export const STORAGE_KEY = "qontinui_image_organization";

export const MAX_FOLDER_DEPTH = 10;
export const MAX_FOLDER_NAME_LENGTH = 100;
export const MAX_TAG_LENGTH = 50;
export const MAX_TAGS_PER_IMAGE = 50;
export const MAX_COLLECTION_SIZE = 1000;
