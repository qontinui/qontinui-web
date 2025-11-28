/**
 * Workflow Organization Types
 *
 * Types for organizing workflows in folders
 */

export interface WorkflowFolder {
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
}

export interface FolderTreeNode extends WorkflowFolder {
  /** Child folders */
  children: FolderTreeNode[];

  /** Number of workflows in this folder */
  workflowCount: number;

  /** Total workflows including subfolders */
  totalWorkflowCount: number;

  /** Depth in tree (0 for root) */
  depth: number;
}

export type ContextMenuAction =
  | "new-subfolder"
  | "rename"
  | "change-color"
  | "change-icon"
  | "delete"
  | "move";

export interface DragItem {
  type: "folder" | "workflow";
  id: string;
  parentId: string | null;
}

// ============================================================================
// Search & Filter Types
// ============================================================================

export type ComplexityLevel = "low" | "medium" | "high" | "very-high";

export type SearchOperator = "AND" | "OR" | "NOT";

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface SearchFilter {
  /** Text search query */
  query?: string;

  /** Selected folder IDs */
  folderIds?: string[];

  /** Selected tags */
  tags?: string[];

  /** Tag matching mode */
  tagOperator?: "AND" | "OR";

  /** Created date range */
  createdDateRange?: DateRange;

  /** Modified date range */
  modifiedDateRange?: DateRange;

  /** Action types used in workflow */
  actionTypes?: string[];

  /** Complexity level */
  complexityLevel?: ComplexityLevel[];

  /** Category filter */
  category?: string;

  /** Has tests filter */
  hasTests?: boolean | null;

  /** Has documentation filter */
  hasDocumentation?: boolean | null;

  /** Minimum success rate (0-100) */
  minSuccessRate?: number;
}

export interface SavedFilter {
  /** Filter ID */
  id: string;

  /** Filter name */
  name: string;

  /** The saved filter */
  filter: SearchFilter;

  /** Created timestamp */
  createdAt: Date;
}
