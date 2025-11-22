/**
 * Comment Service
 *
 * Handles comments and discussions on projects and workflows:
 * - Creating, updating, and deleting comments
 * - Threading with replies
 * - Resolving/unresolving comments
 * - User mentions
 * - Comment positioning on canvas
 */

import { HttpClient } from '../http-client';
import { ApiConfig } from '../api-config';
import type {
  Comment,
  CommentCreate,
  CommentUpdate,
  CommentPosition,
} from '@/types/collaboration';

export class CommentService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  // ============================================================================
  // Comment Management
  // ============================================================================

  /**
   * Add a new comment
   */
  async addComment(
    projectId: string,
    workflowId: string | undefined,
    content: string,
    position?: CommentPosition,
    mentions?: string[]
  ): Promise<Comment> {
    const data: CommentCreate = {
      workflow_id: workflowId,
      content,
      position,
      mentions,
    };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to add comment');
    }

    return response.json();
  }

  /**
   * Get all comments for a project
   */
  async getComments(projectId: string, workflowId?: string): Promise<Comment[]> {
    const url = new URL(`${this.apiUrl}/api/v1/projects/${projectId}/comments`);

    if (workflowId) {
      url.searchParams.set('workflow_id', workflowId);
    }

    const response = await this.httpClient.fetch(url.toString());

    if (!response.ok) {
      throw new Error('Failed to fetch comments');
    }

    return response.json();
  }

  /**
   * Get a specific comment by ID
   */
  async getComment(commentId: string): Promise<Comment> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch comment');
    }

    return response.json();
  }

  /**
   * Update a comment's content
   */
  async updateComment(commentId: string, content: string): Promise<Comment> {
    const data: CommentUpdate = { content };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to update comment');
    }

    return response.json();
  }

  /**
   * Delete a comment
   */
  async deleteComment(commentId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to delete comment');
    }
  }

  // ============================================================================
  // Comment Resolution
  // ============================================================================

  /**
   * Mark a comment as resolved
   */
  async resolveComment(commentId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}/resolve`,
      {
        method: 'POST',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to resolve comment');
    }
  }

  /**
   * Mark a comment as unresolved
   */
  async unresolveComment(commentId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}/unresolve`,
      {
        method: 'POST',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to unresolve comment');
    }
  }

  // ============================================================================
  // Replies
  // ============================================================================

  /**
   * Reply to a comment
   */
  async replyToComment(
    commentId: string,
    content: string,
    mentions?: string[]
  ): Promise<Comment> {
    const comment = await this.getComment(commentId);

    const data: CommentCreate = {
      workflow_id: comment.workflow_id || undefined,
      parent_id: commentId,
      content,
      mentions,
    };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${comment.project_id}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to reply to comment');
    }

    return response.json();
  }

  /**
   * Get all replies to a comment
   */
  async getReplies(commentId: string): Promise<Comment[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}/replies`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch replies');
    }

    return response.json();
  }

  // ============================================================================
  // Mentions
  // ============================================================================

  /**
   * Mention a user in a comment
   * This is typically called when creating/updating a comment with @mentions
   */
  async mentionUser(commentId: string, userId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}/mentions`,
      {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to add mention');
    }
  }

  /**
   * Get comments where the current user is mentioned
   */
  async getMentions(projectId?: string): Promise<Comment[]> {
    const url = projectId
      ? `${this.apiUrl}/api/v1/projects/${projectId}/comments/mentions`
      : `${this.apiUrl}/api/v1/comments/mentions`;

    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch mentions');
    }

    return response.json();
  }

  // ============================================================================
  // Reactions
  // ============================================================================

  /**
   * Add a reaction to a comment
   */
  async addReaction(commentId: string, emoji: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to add reaction');
    }
  }

  /**
   * Remove a reaction from a comment
   */
  async removeReaction(commentId: string, emoji: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/comments/${commentId}/reactions/${emoji}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to remove reaction');
    }
  }

  // ============================================================================
  // Filters
  // ============================================================================

  /**
   * Get unresolved comments for a project
   */
  async getUnresolvedComments(projectId: string, workflowId?: string): Promise<Comment[]> {
    const url = new URL(`${this.apiUrl}/api/v1/projects/${projectId}/comments/unresolved`);

    if (workflowId) {
      url.searchParams.set('workflow_id', workflowId);
    }

    const response = await this.httpClient.fetch(url.toString());

    if (!response.ok) {
      throw new Error('Failed to fetch unresolved comments');
    }

    return response.json();
  }

  /**
   * Get comments by position (for canvas elements)
   */
  async getCommentsByPosition(
    projectId: string,
    elementId: string
  ): Promise<Comment[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/comments?element_id=${elementId}`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch comments by position');
    }

    return response.json();
  }
}
