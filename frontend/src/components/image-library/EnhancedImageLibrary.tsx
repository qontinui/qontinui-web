/**
 * Enhanced Image Library
 *
 * This file has been split into sub-components for SRP.
 * The orchestrator now lives in ImageLibrary.tsx.
 *
 * Sub-components:
 * - FilterBar.tsx        -- Search, tag filters, source filters, date range, size filters
 * - FolderTree.tsx       -- Folder management sidebar (create/expand/collapse)
 * - ImageGrid.tsx        -- Grid/list view rendering of images + ImageDetailsPanel
 * - BulkActions.tsx      -- Bulk selection, tagging, moving, deleting
 * - UploadDialog.tsx     -- Collection management sidebar
 * - CollectionPanel.tsx  -- Re-export of CollectionsSidebar
 * - ImageDetailsPanel.tsx -- Re-export of ImageDetailsPanel
 * - utils.ts             -- Shared helper functions
 */

export { ImageLibrary as EnhancedImageLibrary } from "./ImageLibrary";
