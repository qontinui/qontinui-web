/**
 * Activity Service
 *
 * Handles activity tracking and audit logging:
 * - Tracking user actions on projects and resources
 * - Activity feed for projects
 * - Resource-specific activity history
 * - Real-time activity subscriptions
 */

import { HttpClient } from '../http-client';
import { ApiConfig } from '../api-config';
import type {
  Activity,
  ActivityCreate,
  ActivityFeedOptions,
  ActivityActionType,
  ResourceType,
  Subscription,
} from '@/types/collaboration';

export class ActivityService {
  private httpClient: HttpClient;
  private apiUrl: string;
  private subscriptions: Map<string, Set<(activity: Activity) => void>> = new Map();

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  // ============================================================================
  // Activity Tracking
  // ============================================================================

  /**
   * Track an activity/action
   */
  async trackActivity(
    projectId: string,
    actionType: ActivityActionType,
    resourceType: ResourceType,
    resourceId: string,
    changes?: Record<string, any>,
    resourceName?: string,
    description?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const data: ActivityCreate = {
      action_type: actionType,
      resource_type: resourceType,
      resource_id: resourceId,
      resource_name: resourceName,
      description,
      changes,
      metadata,
    };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/activity`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[ActivityService] Failed to track activity:', error);
      // Don't throw - activity tracking should be best-effort
    }
  }

  // ============================================================================
  // Activity Retrieval
  // ============================================================================

  /**
   * Get activity feed for a project
   */
  async getActivityFeed(
    projectId: string,
    options?: ActivityFeedOptions
  ): Promise<Activity[]> {
    const url = new URL(`${this.apiUrl}/api/v1/projects/${projectId}/activity`);

    if (options?.limit) {
      url.searchParams.set('limit', options.limit.toString());
    }
    if (options?.offset) {
      url.searchParams.set('offset', options.offset.toString());
    }
    if (options?.action_types?.length) {
      url.searchParams.set('action_types', options.action_types.join(','));
    }
    if (options?.resource_types?.length) {
      url.searchParams.set('resource_types', options.resource_types.join(','));
    }
    if (options?.user_id) {
      url.searchParams.set('user_id', options.user_id);
    }

    const response = await this.httpClient.fetch(url.toString());

    if (!response.ok) {
      throw new Error('Failed to fetch activity feed');
    }

    return response.json();
  }

  /**
   * Get activity for a specific resource
   */
  async getResourceActivity(
    projectId: string,
    resourceType: ResourceType,
    resourceId: string,
    limit?: number
  ): Promise<Activity[]> {
    const url = new URL(
      `${this.apiUrl}/api/v1/projects/${projectId}/activity/${resourceType}/${resourceId}`
    );

    if (limit) {
      url.searchParams.set('limit', limit.toString());
    }

    const response = await this.httpClient.fetch(url.toString());

    if (!response.ok) {
      throw new Error('Failed to fetch resource activity');
    }

    return response.json();
  }

  /**
   * Get user's recent activity across all projects
   */
  async getUserActivity(userId: string, limit?: number): Promise<Activity[]> {
    const url = new URL(`${this.apiUrl}/api/v1/users/${userId}/activity`);

    if (limit) {
      url.searchParams.set('limit', limit.toString());
    }

    const response = await this.httpClient.fetch(url.toString());

    if (!response.ok) {
      throw new Error('Failed to fetch user activity');
    }

    return response.json();
  }

  /**
   * Get activity statistics for a project
   */
  async getActivityStats(
    projectId: string,
    timeRange?: 'day' | 'week' | 'month'
  ): Promise<{
    total_activities: number;
    by_action_type: Record<ActivityActionType, number>;
    by_user: Record<string, number>;
    most_active_resources: Array<{
      resource_type: ResourceType;
      resource_id: string;
      resource_name: string;
      activity_count: number;
    }>;
  }> {
    const url = new URL(`${this.apiUrl}/api/v1/projects/${projectId}/activity/stats`);

    if (timeRange) {
      url.searchParams.set('range', timeRange);
    }

    const response = await this.httpClient.fetch(url.toString());

    if (!response.ok) {
      throw new Error('Failed to fetch activity statistics');
    }

    return response.json();
  }

  // ============================================================================
  // Real-time Subscriptions
  // ============================================================================

  /**
   * Subscribe to activity updates for a project
   */
  subscribeToActivity(
    projectId: string,
    callback: (activity: Activity) => void
  ): Subscription {
    // Get or create subscription set for this project
    let callbacks = this.subscriptions.get(projectId);
    if (!callbacks) {
      callbacks = new Set();
      this.subscriptions.set(projectId, callbacks);
    }

    // Add callback
    callbacks.add(callback);

    // Return unsubscribe function
    return {
      unsubscribe: () => {
        const projectCallbacks = this.subscriptions.get(projectId);
        if (projectCallbacks) {
          projectCallbacks.delete(callback);
          if (projectCallbacks.size === 0) {
            this.subscriptions.delete(projectId);
          }
        }
      },
    };
  }

  /**
   * Notify subscribers of new activity
   * This is called by the WebSocket service when activity updates are received
   */
  notifySubscribers(projectId: string, activity: Activity): void {
    const callbacks = this.subscriptions.get(projectId);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(activity);
        } catch (error) {
          console.error('[ActivityService] Subscriber callback error:', error);
        }
      });
    }
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Track a create action
   */
  async trackCreate(
    projectId: string,
    resourceType: ResourceType,
    resourceId: string,
    resourceName?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    return this.trackActivity(
      projectId,
      'create',
      resourceType,
      resourceId,
      undefined,
      resourceName,
      `Created ${resourceType} ${resourceName || resourceId}`,
      metadata
    );
  }

  /**
   * Track an update action
   */
  async trackUpdate(
    projectId: string,
    resourceType: ResourceType,
    resourceId: string,
    changes: Record<string, any>,
    resourceName?: string
  ): Promise<void> {
    return this.trackActivity(
      projectId,
      'update',
      resourceType,
      resourceId,
      changes,
      resourceName,
      `Updated ${resourceType} ${resourceName || resourceId}`
    );
  }

  /**
   * Track a delete action
   */
  async trackDelete(
    projectId: string,
    resourceType: ResourceType,
    resourceId: string,
    resourceName?: string
  ): Promise<void> {
    return this.trackActivity(
      projectId,
      'delete',
      resourceType,
      resourceId,
      undefined,
      resourceName,
      `Deleted ${resourceType} ${resourceName || resourceId}`
    );
  }

  /**
   * Track a share action
   */
  async trackShare(
    projectId: string,
    resourceType: ResourceType,
    resourceId: string,
    sharedWith: string,
    resourceName?: string
  ): Promise<void> {
    return this.trackActivity(
      projectId,
      'share',
      resourceType,
      resourceId,
      undefined,
      resourceName,
      `Shared ${resourceType} ${resourceName || resourceId} with ${sharedWith}`,
      { shared_with: sharedWith }
    );
  }

  /**
   * Track an execution action
   */
  async trackExecution(
    projectId: string,
    workflowId: string,
    workflowName?: string,
    executionResult?: 'success' | 'failure'
  ): Promise<void> {
    return this.trackActivity(
      projectId,
      'execute',
      'workflow',
      workflowId,
      undefined,
      workflowName,
      `Executed workflow ${workflowName || workflowId}`,
      { result: executionResult }
    );
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear all subscriptions
   */
  clearAllSubscriptions(): void {
    this.subscriptions.clear();
  }

  /**
   * Clear subscriptions for a specific project
   */
  clearProjectSubscriptions(projectId: string): void {
    this.subscriptions.delete(projectId);
  }
}
