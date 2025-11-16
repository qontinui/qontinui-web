/**
 * Workflow Organization Components
 *
 * Export all components and utilities for workflow organization
 */

// Main Components
export { FolderTree } from './FolderTree';
export type { FolderTreeProps } from './FolderTree';

export { FolderBreadcrumb, CompactFolderBreadcrumb } from './FolderBreadcrumb';
export type {
  FolderBreadcrumbProps,
  CompactFolderBreadcrumbProps,
} from './FolderBreadcrumb';

export { FolderSelector, InlineFolderSelector } from './FolderSelector';
export type {
  FolderSelectorProps,
  InlineFolderSelectorProps,
} from './FolderSelector';

export { AdvancedSearch } from './AdvancedSearch';
export type { AdvancedSearchProps } from './AdvancedSearch';

export { BulkOperations } from './BulkOperations';
export type { BulkOperationsProps } from './BulkOperations';

// Hooks
export {
  useFolderManager,
  useFolderExpansion,
  useFolderSelection,
} from './useFolderManager';
export type {
  UseFolderManagerOptions,
  UseFolderManagerResult,
} from './useFolderManager';

// Utilities
export {
  createFolder,
  generateFolderId,
  getDescendantIds,
  wouldCreateCycle,
  getFolderPath,
  getWorkflowsInFolder,
  countWorkflowsInFolder,
  sortFolders,
  reorderFolders,
  validateFolderName,
  findFolderByPath,
  exportFolders,
  importFolders,
  getFolderStats,
} from './folder-utils';
export type { FolderStats } from './folder-utils';

// Types
export type {
  WorkflowFolder,
  FolderTreeNode,
  ContextMenuAction,
  DragItem,
  ComplexityLevel,
  SearchOperator,
  DateRange,
  SearchFilter,
  SavedFilter,
} from './types';
