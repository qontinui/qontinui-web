/**
 * Image Library Components
 *
 * The monolithic EnhancedImageLibrary has been split into sub-components:
 * - ImageLibrary (main orchestrator, aliased as EnhancedImageLibrary)
 * - FilterBar (search, tag, source, date range, size filters)
 * - FolderTree (folder management sidebar)
 * - ImageGrid / ImageList (grid and list view rendering)
 * - ImageDetailsPanel (right sidebar image details)
 * - BulkActions (bulk selection toolbar)
 * - CollectionPanel (collection management UI)
 * - UploadDialog (collections sidebar; upload logic lives in orchestrator)
 */

export { ImageLibrary, EnhancedImageLibrary } from "./ImageLibrary";
export { useImageOrganization } from "./useImageOrganization";

// Sub-components (exported for individual use)
export { FilterBar } from "./FilterBar";
export { FolderTreeSidebar } from "./FolderTree";
export { ImageGrid, ImageList, ImageDetailsPanel } from "./ImageGrid";
export { BulkActions } from "./BulkActions";
export { CollectionsSidebar } from "./UploadDialog";

export type {
  ImageFolder,
  ImageFolderTreeNode,
  ImageCollection,
  ImageFilter,
  ImageViewMode,
  ImageGridSize,
  ImageSortBy,
  ImageSortOrder,
  ImageTag,
  ImageWithMetadata,
  BulkOperation,
  SavedImageFilter,
  DateRange,
} from "./types";
