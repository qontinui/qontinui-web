import { Workflow, Action } from "@/lib/action-schema/action-types";
import { ActionComment } from "@/services/workflow-documentation-service";

export interface ViewerTOCItem {
  level: number;
  text: string;
  id: string;
  children: ViewerTOCItem[];
}

export interface Section {
  id: string;
  title: string;
  content: string;
  level: number;
}

// ============================================================================
// ActionCommentsPanel types
// ============================================================================

export type CommentViewMode = "selected" | "all";

export interface ActionWithComment {
  action: Action;
  comment: ActionComment;
}

export interface ActionCommentsPanelProps {
  workflow: Workflow;
  comments: ActionComment[];
  selectedActionId?: string;
  onAddComment: (actionId: string, comment: string) => void;
  onUpdateComment: (commentId: string, comment: string) => void;
  onDeleteComment: (commentId: string) => void;
  className?: string;
}

export interface UseActionCommentsReturn {
  // State
  editingCommentId: string | null;
  editingText: string;
  newCommentText: string;
  showNewCommentForm: boolean;
  searchQuery: string;
  deleteConfirmId: string | null;
  viewMode: CommentViewMode;

  // Derived data
  selectedActionComment: ActionComment | null;
  filteredActions: ActionWithComment[];

  // Handlers
  setEditingText: (text: string) => void;
  setNewCommentText: (text: string) => void;
  setSearchQuery: (query: string) => void;
  setViewMode: (mode: CommentViewMode) => void;
  setShowNewCommentForm: (show: boolean) => void;
  getAction: (actionId: string) => Action | undefined;
  handleAddComment: () => void;
  handleStartEdit: (comment: ActionComment) => void;
  handleSaveEdit: () => void;
  handleCancelEdit: () => void;
  handleDelete: (commentId: string) => void;
  confirmDelete: () => void;
  dismissDelete: () => void;
  handleExportComments: () => void;
  cancelNewComment: () => void;
}
