import { useState, useMemo } from "react";
import { Workflow, Action } from "@/lib/action-schema/action-types";
import { ActionComment } from "@/services/workflow-documentation-service";
import {
  CommentViewMode,
  ActionWithComment,
  UseActionCommentsReturn,
} from "../types";

interface UseActionCommentsParams {
  workflow: Workflow;
  comments: ActionComment[];
  selectedActionId?: string;
  onAddComment: (actionId: string, comment: string) => void;
  onUpdateComment: (commentId: string, comment: string) => void;
  onDeleteComment: (commentId: string) => void;
}

export function useActionComments({
  workflow,
  comments,
  selectedActionId,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: UseActionCommentsParams): UseActionCommentsReturn {
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [newCommentText, setNewCommentText] = useState("");
  const [showNewCommentForm, setShowNewCommentForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CommentViewMode>("selected");

  const getAction = (actionId: string): Action | undefined => {
    return workflow.actions.find((a) => a.id === actionId);
  };

  const selectedActionComment = useMemo(() => {
    if (!selectedActionId) return null;
    return comments.find((c) => c.actionId === selectedActionId) ?? null;
  }, [comments, selectedActionId]);

  const actionsWithComments = useMemo(() => {
    const commentMap = new Map<string, ActionComment>();
    comments.forEach((comment) => {
      commentMap.set(comment.actionId, comment);
    });

    return workflow.actions
      .filter((action) => commentMap.has(action.id))
      .map((action) => ({
        action,
        comment: commentMap.get(action.id)!,
      }));
  }, [workflow.actions, comments]);

  const filteredActions = useMemo<ActionWithComment[]>(() => {
    if (!searchQuery) return actionsWithComments;

    const query = searchQuery.toLowerCase();
    return actionsWithComments.filter(
      ({ action, comment }) =>
        action.name?.toLowerCase().includes(query) ||
        action.id.toLowerCase().includes(query) ||
        action.type.toLowerCase().includes(query) ||
        comment.comment.toLowerCase().includes(query)
    );
  }, [actionsWithComments, searchQuery]);

  const handleAddComment = () => {
    if (!selectedActionId || !newCommentText.trim()) return;
    onAddComment(selectedActionId, newCommentText);
    setNewCommentText("");
    setShowNewCommentForm(false);
  };

  const handleStartEdit = (comment: ActionComment) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.comment);
  };

  const handleSaveEdit = () => {
    if (!editingCommentId || !editingText.trim()) return;
    onUpdateComment(editingCommentId, editingText);
    setEditingCommentId(null);
    setEditingText("");
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingText("");
  };

  const handleDelete = (commentId: string) => {
    setDeleteConfirmId(commentId);
  };

  const confirmDelete = () => {
    if (deleteConfirmId) {
      onDeleteComment(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const dismissDelete = () => {
    setDeleteConfirmId(null);
  };

  const handleExportComments = () => {
    const exportData = actionsWithComments.map(({ action, comment }) => ({
      actionId: action.id,
      actionName: action.name || action.id,
      actionType: action.type,
      comment: comment.comment,
      created: comment.created,
      updated: comment.updated,
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.name}-comments.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cancelNewComment = () => {
    setShowNewCommentForm(false);
    setNewCommentText("");
  };

  return {
    editingCommentId,
    editingText,
    newCommentText,
    showNewCommentForm,
    searchQuery,
    deleteConfirmId,
    viewMode,
    selectedActionComment,
    filteredActions,
    setEditingText,
    setNewCommentText,
    setSearchQuery,
    setViewMode,
    setShowNewCommentForm,
    getAction,
    handleAddComment,
    handleStartEdit,
    handleSaveEdit,
    handleCancelEdit,
    handleDelete,
    confirmDelete,
    dismissDelete,
    handleExportComments,
    cancelNewComment,
  };
}
