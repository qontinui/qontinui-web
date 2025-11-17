/**
 * Comment Service
 *
 * Manages comments and discussions:
 * - Creating and updating comments
 * - Threaded replies
 * - Resolving comments
 */

import type {
  Comment,
  CreateCommentRequest,
  UpdateCommentRequest,
  CommentStatus,
} from '@/types/collaboration';
import { httpClient } from './http-client';

const API_BASE = '/api/comments';

// ============================================================================
// Comment Service
// ============================================================================

class CommentService {
  /**
   * Get comments for a project
   */
  async getComments(projectId: string, workflowId?: string): Promise<Comment[]> {
    const params = new URLSearchParams({ project_id: projectId });
    if (workflowId) {
      params.append('workflow_id', workflowId);
    }

    const comments = await httpClient.get<Comment[]>(`${API_BASE}?${params}`);
    return this.buildCommentTree(comments);
  }

  /**
   * Get a single comment
   */
  async getComment(commentId: string): Promise<Comment> {
    const comment = await httpClient.get<Comment>(`${API_BASE}/${commentId}`);
    return comment;
  }

  /**
   * Add a new comment
   */
  async addComment(
    projectId: string,
    workflowId: string | undefined,
    content: string,
    position?: { x: number; y: number },
    parentId?: string
  ): Promise<Comment> {
    const data: CreateCommentRequest = {
      project_id: projectId,
      workflow_id: workflowId,
      content,
      position,
      parent_id: parentId,
    };

    const comment = await httpClient.post<Comment>(API_BASE, data);
    return comment;
  }

  /**
   * Update a comment
   */
  async updateComment(
    commentId: string,
    data: UpdateCommentRequest
  ): Promise<Comment> {
    const comment = await httpClient.patch<Comment>(`${API_BASE}/${commentId}`, data);
    return comment;
  }

  /**
   * Delete a comment
   */
  async deleteComment(commentId: string): Promise<void> {
    await httpClient.delete(`${API_BASE}/${commentId}`);
  }

  /**
   * Resolve a comment
   */
  async resolveComment(commentId: string): Promise<Comment> {
    return this.updateComment(commentId, { status: 'resolved' });
  }

  /**
   * Reopen a comment
   */
  async reopenComment(commentId: string): Promise<Comment> {
    return this.updateComment(commentId, { status: 'open' });
  }

  /**
   * Reply to a comment
   */
  async replyToComment(
    commentId: string,
    projectId: string,
    content: string
  ): Promise<Comment> {
    const parentComment = await this.getComment(commentId);
    return this.addComment(
      projectId,
      parentComment.workflow_id,
      content,
      undefined,
      commentId
    );
  }

  /**
   * Get comments by status
   */
  async getCommentsByStatus(
    projectId: string,
    status: CommentStatus
  ): Promise<Comment[]> {
    const params = new URLSearchParams({
      project_id: projectId,
      status,
    });

    const comments = await httpClient.get<Comment[]>(`${API_BASE}?${params}`);
    return this.buildCommentTree(comments);
  }

  /**
   * Get comment count for a workflow
   */
  async getCommentCount(
    projectId: string,
    workflowId?: string
  ): Promise<{ total: number; open: number; resolved: number }> {
    const params = new URLSearchParams({ project_id: projectId });
    if (workflowId) {
      params.append('workflow_id', workflowId);
    }

    const count = await httpClient.get<{
      total: number;
      open: number;
      resolved: number;
    }>(`${API_BASE}/count?${params}`);
    return count;
  }

  /**
   * Build comment tree structure from flat list
   */
  private buildCommentTree(comments: Comment[]): Comment[] {
    const commentMap = new Map<string, Comment>();
    const rootComments: Comment[] = [];

    // First pass: create map and initialize replies
    for (const comment of comments) {
      commentMap.set(comment.id, { ...comment, replies: [] });
    }

    // Second pass: build tree structure
    for (const comment of comments) {
      const commentWithReplies = commentMap.get(comment.id)!;

      if (comment.parent_id) {
        const parent = commentMap.get(comment.parent_id);
        if (parent) {
          parent.replies!.push(commentWithReplies);
        } else {
          // Parent not found, treat as root
          rootComments.push(commentWithReplies);
        }
      } else {
        rootComments.push(commentWithReplies);
      }
    }

    return rootComments;
  }
}

// Export singleton instance
export const commentService = new CommentService();
