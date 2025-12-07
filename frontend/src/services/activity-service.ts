/**
 * Activity Service
 *
 * Manages activity tracking and feed:
 * - Recording user actions
 * - Fetching activity history
 * - Filtering activities
 */

import type {
  Activity,
  ActivityCreate,
  ActivityFeedOptions,
  ActivityActionType,
  ResourceType,
} from "@/types/collaboration";
import { httpClient } from "./service-factory";

const API_BASE = "/api/activities";

// ============================================================================
// Activity Service
// ============================================================================

class ActivityService {
  /**
   * Get activity feed for a project
   */
  async getActivities(
    projectId: string,
    options: ActivityFeedOptions = {}
  ): Promise<{ activities: Activity[]; total: number; has_more: boolean }> {
    const params = new URLSearchParams({ project_id: projectId });

    if (options.limit) params.append("limit", options.limit.toString());
    if (options.offset) params.append("offset", options.offset.toString());
    if (options.user_id) params.append("user_id", options.user_id);

    if (options.action_types && options.action_types.length > 0) {
      options.action_types.forEach((type) =>
        params.append("action_types", type)
      );
    }

    if (options.resource_types && options.resource_types.length > 0) {
      options.resource_types.forEach((type) =>
        params.append("resource_types", type)
      );
    }

    const response = await httpClient.get<{
      activities: Activity[];
      total: number;
      has_more: boolean;
    }>(`${API_BASE}?${params}`);

    return response;
  }

  /**
   * Get a single activity
   */
  async getActivity(activityId: string): Promise<Activity> {
    const activity = await httpClient.get<Activity>(
      `${API_BASE}/${activityId}`
    );
    return activity;
  }

  /**
   * Create a new activity record
   */
  async createActivity(
    projectId: string,
    data: ActivityCreate
  ): Promise<Activity> {
    const activity = await httpClient.post<Activity>(API_BASE, {
      project_id: projectId,
      ...data,
    });
    return activity;
  }

  /**
   * Get activity summary for a project
   */
  async getActivitySummary(
    projectId: string,
    days: number = 7
  ): Promise<{
    total_activities: number;
    active_users: number;
    top_actions: Array<{ action_type: ActivityActionType; count: number }>;
    recent_contributors: Array<{
      user_id: string;
      user_name: string;
      count: number;
    }>;
  }> {
    const params = new URLSearchParams({
      project_id: projectId,
      days: days.toString(),
    });

    const summary = await httpClient.get<{
      total_activities: number;
      active_users: number;
      top_actions: { action_type: ActivityActionType; count: number }[];
      recent_contributors: {
        user_id: string;
        user_name: string;
        count: number;
      }[];
    }>(`${API_BASE}/summary?${params}`);
    return summary;
  }

  /**
   * Get activities for a specific resource
   */
  async getResourceActivities(
    projectId: string,
    resourceType: ResourceType,
    resourceId: string
  ): Promise<Activity[]> {
    const params = new URLSearchParams({
      project_id: projectId,
      resource_type: resourceType,
      resource_id: resourceId,
    });

    const activities = await httpClient.get<Activity[]>(
      `${API_BASE}/resource?${params}`
    );
    return activities;
  }

  /**
   * Get user's recent activities
   */
  async getUserActivities(
    userId: string,
    limit: number = 20
  ): Promise<Activity[]> {
    const params = new URLSearchParams({
      user_id: userId,
      limit: limit.toString(),
    });

    const activities = await httpClient.get<Activity[]>(
      `${API_BASE}/user?${params}`
    );
    return activities;
  }

  /**
   * Clear old activities (admin only)
   */
  async clearOldActivities(projectId: string, days: number): Promise<void> {
    await httpClient.delete(
      `${API_BASE}/cleanup?project_id=${projectId}&older_than_days=${days}`
    );
  }
}

// Export singleton instance
export const activityService = new ActivityService();
