"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import type { Comment } from "./types";
import { commentService } from "@/services/service-factory";

// ============================================================================
// Context Types
// ============================================================================

interface CommentsContextValue {
  comments: Comment[];
  addComment: (
    content: string,
    position?: { x: number; y: number }
  ) => Promise<void>;
  updateComment: (commentId: string, content: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  refreshComments: () => Promise<void>;
}

const CommentsContext = createContext<CommentsContextValue | undefined>(
  undefined
);

// ============================================================================
// Provider Props
// ============================================================================

interface CommentsProviderProps {
  children: ReactNode;
  projectId: string;
  workflowId?: string;
}

// ============================================================================
// Provider Component
// ============================================================================

export function CommentsProvider({
  children,
  projectId,
  workflowId,
}: CommentsProviderProps) {
  const [comments, setComments] = useState<Comment[]>([]);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Load comments when workflow changes
   */
  useEffect(() => {
    if (projectId) {
      loadComments();
    }
  }, [projectId, workflowId]);

  // ============================================================================
  // Methods
  // ============================================================================

  const loadComments = async () => {
    try {
      const loadedComments = await commentService.getComments(
        projectId,
        workflowId
      );
      setComments(loadedComments);
    } catch (error) {
      console.error("[Comments] Failed to load comments:", error);
    }
  };

  const addComment = async (
    content: string,
    position?: { x: number; y: number }
  ) => {
    try {
      const newComment = await commentService.addComment(
        projectId,
        workflowId,
        content,
        position
      );
      setComments((prev) => [...prev, newComment]);
    } catch (error) {
      console.error("[Comments] Failed to add comment:", error);
      throw error;
    }
  };

  const updateComment = async (commentId: string, content: string) => {
    try {
      const updatedComment = await commentService.updateComment(
        commentId,
        content
      );
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? updatedComment : c))
      );
    } catch (error) {
      console.error("[Comments] Failed to update comment:", error);
      throw error;
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      await commentService.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (error) {
      console.error("[Comments] Failed to delete comment:", error);
      throw error;
    }
  };

  const refreshComments = async () => {
    await loadComments();
  };

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: CommentsContextValue = {
    comments,
    addComment,
    updateComment,
    deleteComment,
    refreshComments,
  };

  return (
    <CommentsContext.Provider value={value}>
      {children}
    </CommentsContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useComments() {
  const context = useContext(CommentsContext);
  if (context === undefined) {
    throw new Error("useComments must be used within a CommentsProvider");
  }
  return context;
}
