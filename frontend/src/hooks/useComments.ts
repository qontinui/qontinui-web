/**
 * useComments Hook
 *
 * React hook for comments functionality including:
 * - Loading and displaying comments
 * - Adding new comments
 * - Threaded replies
 * - Resolving comments
 * - Real-time updates via WebSocket
 */

import { useState, useEffect, useCallback } from 'react';
import type { Comment, CommentPosition } from '@/types/collaboration';
import { commentService } from '@/services/comment-service';
import { websocketCollaborationService } from '@/services/websocket-collaboration-service';

// ============================================================================
// Hook Return Type
// ============================================================================

interface UseCommentsReturn {
  // State
  comments: Comment[];
  loading: boolean;
  error: Error | null;

  // Computed
  openComments: Comment[];
  resolvedComments: Comment[];
  commentCount: { total: number; open: number; resolved: number };

  // Methods
  addComment: (
    content: string,
    position?: CommentPosition,
    parentId?: string
  ) => Promise<Comment>;
  updateComment: (commentId: string, content: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  resolveComment: (commentId: string) => Promise<void>;
  reopenComment: (commentId: string) => Promise<void>;
  replyToComment: (commentId: string, content: string) => Promise<Comment>;
  refresh: () => Promise<void>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useComments(
  projectId: string,
  workflowId?: string
): UseCommentsReturn {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Load comments on mount and when dependencies change
   */
  useEffect(() => {
    loadComments();
  }, [projectId, workflowId]);

  /**
   * Setup WebSocket listeners for real-time comment updates
   */
  useEffect(() => {
    const unsubscribeAdded = websocketCollaborationService.onCommentAdded(
      (comment) => {
        // Only add if it belongs to current workflow (or no workflow filter)
        if (!workflowId || comment.workflow_id === workflowId) {
          setComments((prev) => {
            // Avoid duplicates
            if (prev.some((c) => c.id === comment.id)) {
              return prev;
            }
            return [...prev, comment];
          });
        }
      }
    );

    const unsubscribeUpdated = websocketCollaborationService.onCommentUpdated(
      (comment) => {
        setComments((prev) =>
          prev.map((c) => (c.id === comment.id ? comment : c))
        );
      }
    );

    const unsubscribeDeleted = websocketCollaborationService.onCommentDeleted(
      (commentId) => {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      }
    );

    return () => {
      unsubscribeAdded();
      unsubscribeUpdated();
      unsubscribeDeleted();
    };
  }, [workflowId]);

  /**
   * Load comments from server
   */
  const loadComments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const loadedComments = await commentService.getComments(projectId, workflowId);
      setComments(loadedComments);
    } catch (err) {
      console.error('[useComments] Failed to load comments:', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [projectId, workflowId]);

  /**
   * Add a new comment
   */
  const addComment = useCallback(
    async (
      content: string,
      position?: CommentPosition,
      parentId?: string
    ): Promise<Comment> => {
      setError(null);

      try {
        const newComment = await commentService.addComment(
          projectId,
          workflowId,
          content,
          position,
          parentId
        );

        // Add to local state
        setComments((prev) => [...prev, newComment]);

        return newComment;
      } catch (err) {
        console.error('[useComments] Failed to add comment:', err);
        setError(err as Error);
        throw err;
      }
    },
    [projectId, workflowId]
  );

  /**
   * Update a comment
   */
  const updateComment = useCallback(
    async (commentId: string, content: string): Promise<void> => {
      setError(null);

      try {
        const updatedComment = await commentService.updateComment(commentId, {
          content,
        });

        // Update in local state
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? updatedComment : c))
        );
      } catch (err) {
        console.error('[useComments] Failed to update comment:', err);
        setError(err as Error);
        throw err;
      }
    },
    []
  );

  /**
   * Delete a comment
   */
  const deleteComment = useCallback(async (commentId: string): Promise<void> => {
    setError(null);

    try {
      await commentService.deleteComment(commentId);

      // Remove from local state
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      console.error('[useComments] Failed to delete comment:', err);
      setError(err as Error);
      throw err;
    }
  }, []);

  /**
   * Resolve a comment
   */
  const resolveComment = useCallback(async (commentId: string): Promise<void> => {
    setError(null);

    try {
      const resolvedComment = await commentService.resolveComment(commentId);

      // Update in local state
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? resolvedComment : c))
      );
    } catch (err) {
      console.error('[useComments] Failed to resolve comment:', err);
      setError(err as Error);
      throw err;
    }
  }, []);

  /**
   * Reopen a resolved comment
   */
  const reopenComment = useCallback(async (commentId: string): Promise<void> => {
    setError(null);

    try {
      const reopenedComment = await commentService.reopenComment(commentId);

      // Update in local state
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? reopenedComment : c))
      );
    } catch (err) {
      console.error('[useComments] Failed to reopen comment:', err);
      setError(err as Error);
      throw err;
    }
  }, []);

  /**
   * Reply to a comment
   */
  const replyToComment = useCallback(
    async (commentId: string, content: string): Promise<Comment> => {
      setError(null);

      try {
        const reply = await commentService.replyToComment(
          commentId,
          projectId,
          content
        );

        // Add to local state
        setComments((prev) => [...prev, reply]);

        return reply;
      } catch (err) {
        console.error('[useComments] Failed to reply to comment:', err);
        setError(err as Error);
        throw err;
      }
    },
    [projectId]
  );

  /**
   * Refresh comments
   */
  const refresh = useCallback(async (): Promise<void> => {
    await loadComments();
  }, [loadComments]);

  // Computed properties
  const openComments = comments.filter((c) => !c.resolved);
  const resolvedComments = comments.filter((c) => c.resolved);
  const commentCount = {
    total: comments.length,
    open: openComments.length,
    resolved: resolvedComments.length,
  };

  return {
    comments,
    loading,
    error,
    openComments,
    resolvedComments,
    commentCount,
    addComment,
    updateComment,
    deleteComment,
    resolveComment,
    reopenComment,
    replyToComment,
    refresh,
  };
}
