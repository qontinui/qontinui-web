/**
 * Workflow Organization Types
 *
 * Type definitions for organizing workflows into folders with hierarchical structure,
 * colors, icons, and metadata.
 */

// ============================================================================
// Core Folder Types
// ============================================================================

export interface WorkflowFolder {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
  icon?: string;
  description?: string;
  metadata: FolderMetadata;
  order?: number;
}

export interface FolderMetadata {
  created: string;
  updated: string;
  workflowCount?: number;
  descendantCount?: number;
}

// ============================================================================
// Folder Tree Types
// ============================================================================

export interface FolderTreeNode extends WorkflowFolder {
  children: FolderTreeNode[];
  depth: number;
  path: string[];
  hasChildren: boolean;
}

export interface FolderPath {
  id: string;
  name: string;
}

// ============================================================================
// Workflow-Folder Association
// ============================================================================

export interface WorkflowFolderAssociation {
  workflowId: string;
  folderId: string;
  addedAt: string;
}

// ============================================================================
// Operation Result Types
// ============================================================================

export interface FolderOperationResult {
  success: boolean;
  folder?: WorkflowFolder;
  error?: string;
  warnings?: string[];
}

export interface FolderListResult {
  success: boolean;
  folders: WorkflowFolder[];
  error?: string;
}

export interface FolderTreeResult {
  success: boolean;
  tree: FolderTreeNode[];
  error?: string;
}

export interface WorkflowListResult {
  success: boolean;
  workflowIds: string[];
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface MoveResult {
  success: boolean;
  error?: string;
  warnings?: string[];
}

// ============================================================================
// CRUD Options
// ============================================================================

export interface CreateFolderOptions {
  name: string;
  parentId?: string | null;
  color?: string;
  icon?: string;
  description?: string;
  order?: number;
}

export interface UpdateFolderOptions {
  name?: string;
  parentId?: string | null;
  color?: string;
  icon?: string;
  description?: string;
  order?: number;
}

export interface DeleteFolderOptions {
  recursive?: boolean;
  moveWorkflowsTo?: string | null;
}

export interface GetWorkflowsOptions {
  recursive?: boolean;
  includeSubfolders?: boolean;
}

// ============================================================================
// Search and Filter Types
// ============================================================================

export interface FolderSearchOptions {
  query: string;
  includeDescription?: boolean;
  caseSensitive?: boolean;
  exactMatch?: boolean;
}

export interface FolderSearchResult {
  folder: WorkflowFolder;
  matches: SearchMatch[];
  score: number;
}

export interface SearchMatch {
  field: 'name' | 'description';
  value: string;
  matchedText: string;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface FolderStorageData {
  folders: Record<string, WorkflowFolder>;
  associations: WorkflowFolderAssociation[];
  version: string;
  lastModified: string;
}

export interface ImportExportData {
  folders: WorkflowFolder[];
  associations: WorkflowFolderAssociation[];
  exportedAt: string;
  exportedBy: string;
  version: string;
}

// ============================================================================
// Migration Types
// ============================================================================

export interface MigrationResult {
  success: boolean;
  migratedFolders: number;
  migratedAssociations: number;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Validation Rules
// ============================================================================

export interface FolderValidationRules {
  maxNameLength: number;
  maxDescriptionLength: number;
  maxDepth: number;
  reservedNames: string[];
  allowedColors: string[];
  allowedIcons: string[];
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_VALIDATION_RULES: FolderValidationRules = {
  maxNameLength: 100,
  maxDescriptionLength: 500,
  maxDepth: 10,
  reservedNames: ['root', 'system', 'temp', 'trash'],
  allowedColors: [
    '#ef4444', // red
    '#f59e0b', // amber
    '#10b981', // green
    '#3b82f6', // blue
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#6b7280', // gray
  ],
  allowedIcons: [
    'folder',
    'folder-open',
    'briefcase',
    'archive',
    'bookmark',
    'star',
    'tag',
    'collection',
  ],
};

export const STORAGE_VERSION = '1.0.0';
export const STORAGE_KEY = 'workflow-folders';
