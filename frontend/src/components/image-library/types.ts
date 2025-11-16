/**
 * Image Library Organization Types
 *
 * Types for organizing images in folders and collections
 */

import { ImageAsset } from '@/contexts/automation-context/types';

export interface ImageFolder {
  /** Unique folder identifier */
  id: string;

  /** Folder name */
  name: string;

  /** Parent folder ID (null for root folders) */
  parentId: string | null;

  /** Folder color (hex color code) */
  color?: string;

  /** Icon name from lucide-react */
  icon?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last modified timestamp */
  updatedAt: Date;

  /** Sort order within parent */
  order: number;

  /** Whether folder is expanded in UI */
  expanded?: boolean;

  /** Description */
  description?: string;
}

export interface ImageFolderTreeNode extends ImageFolder {
  /** Child folders */
  children: ImageFolderTreeNode[];

  /** Number of images in this folder */
  imageCount: number;

  /** Total images including subfolders */
  totalImageCount: number;

  /** Depth in tree (0 for root) */
  depth: number;
}

export interface ImageCollection {
  /** Unique collection identifier */
  id: string;

  /** Collection name */
  name: string;

  /** Description */
  description?: string;

  /** Image IDs in collection */
  imageIds: string[];

  /** Thumbnail image IDs (first 4) */
  thumbnailIds: string[];

  /** Color theme */
  color?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last modified timestamp */
  updatedAt: Date;
}

export type ImageViewMode = 'grid' | 'list' | 'slideshow';
export type ImageGridSize = 'small' | 'medium' | 'large';
export type ImageSortBy = 'name' | 'date' | 'size' | 'usage';
export type ImageSortOrder = 'asc' | 'desc';

export interface ImageFilter {
  /** Text search query */
  query?: string;

  /** Selected folder IDs */
  folderIds?: string[];

  /** Selected tags */
  tags?: string[];

  /** Tag matching mode */
  tagOperator?: 'AND' | 'OR';

  /** File types */
  fileTypes?: ('png' | 'jpg' | 'jpeg' | 'gif' | 'webp')[];

  /** Source filter */
  sources?: ('uploaded' | 'pattern_optimization' | 'image_extraction' | 'state_discovery')[];

  /** Uploaded date range */
  dateRange?: DateRange;

  /** Dimension filter */
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  /** Usage filter */
  usageFilter?: 'all' | 'used' | 'unused';

  /** Size range (bytes) */
  minSize?: number;
  maxSize?: number;
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface SavedImageFilter {
  /** Filter ID */
  id: string;

  /** Filter name */
  name: string;

  /** The saved filter */
  filter: ImageFilter;

  /** Created timestamp */
  createdAt: Date;
}

export interface ImageTag {
  id: string;
  name: string;
  color?: string;
  count: number;
}

export interface ImageWithMetadata extends ImageAsset {
  /** Folder ID */
  folderId?: string | null;

  /** Tags */
  tags?: string[];

  /** Dimensions */
  width?: number;
  height?: number;

  /** File type */
  fileType?: string;

  /** Is selected */
  selected?: boolean;
}

export interface BulkOperation {
  type: 'move' | 'tag' | 'collection' | 'delete' | 'download';
  imageIds: string[];
  data?: any;
}

export interface ImageUsageDetail {
  workflowId: string;
  workflowName: string;
  stateId?: string;
  stateName?: string;
  usageType: 'pattern' | 'action' | 'state';
}
