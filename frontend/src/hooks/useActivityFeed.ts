/**
 * useActivityFeed Hook
 *
 * React hook for activity feed functionality including:
 * - Loading activity history
 * - Filtering activities
 * - Pagination
 * - Real-time updates via WebSocket
 */

import { useState, useEffect, useCallback } from 'react';
import type {
  Activity,
  ActivityFeedOptions,
  ActivityActionType,
  ResourceType,
} from '@/types/collaboration';
import { activityService } from '@/services/activity-service';
import { websocketCollaborationService } from '@/services/websocket-collaboration-service';

// ============================================================================
// Hook Return Type
// ============================================================================

interface UseActivityFeedReturn {
  // State
  activities: Activity[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;

  // Computed
  total: number;

  // Methods
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  filterByActionType: (types: ActivityActionType[]) => void;
  filterByResourceType: (types: ResourceType[]) => void;
  filterByUser: (userId: string | null) => void;
  clearFilters: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useActivityFeed(
  projectId: string,
  limit: number = 20
): UseActivityFeedReturn {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);

  // Filter state
  const [filters, setFilters] = useState<ActivityFeedOptions>({
    limit,
    offset: 0,
  });

  /**
   * Load activities on mount and when filters change
   */
  useEffect(() => {
    loadActivities(true);
  }, [projectId, filters.action_types, filters.resource_types, filters.user_id]);

  /**
   * Setup WebSocket listeners for real-time activity updates
   */
  useEffect(() => {
    const unsubscribe = websocketCollaborationService.onActivityUpdate((activity) => {
      // Check if activity matches current filters
      const matchesFilters = isActivityMatchingFilters(activity);

      if (matchesFilters) {
        setActivities((prev) => {
          // Avoid duplicates
          if (prev.some((a) => a.id === activity.id)) {
            return prev;
          }
          // Add to the beginning of the list
          return [activity, ...prev];
        });
        setTotal((prev) => prev + 1);
      }
    });

    return unsubscribe;
  }, [filters]);

  /**
   * Check if activity matches current filters
   */
  const isActivityMatchingFilters = (activity: Activity): boolean => {
    if (filters.action_types && filters.action_types.length > 0) {
      if (!filters.action_types.includes(activity.action_type)) {
        return false;
      }
    }

    if (filters.resource_types && filters.resource_types.length > 0) {
      if (!filters.resource_types.includes(activity.resource_type)) {
        return false;
      }
    }

    if (filters.user_id) {
      if (activity.user_id !== filters.user_id) {
        return false;
      }
    }

    return true;
  };

  /**
   * Load activities from server
   */
  const loadActivities = useCallback(
    async (reset: boolean = false) => {
      setLoading(true);
      setError(null);

      try {
        const options: ActivityFeedOptions = {
          ...filters,
          offset: reset ? 0 : filters.offset,
        };

        const response = await activityService.getActivities(projectId, options);

        if (reset) {
          setActivities(response.activities);
        } else {
          setActivities((prev) => [...prev, ...response.activities]);
        }

        setTotal(response.total);
        setHasMore(response.has_more);

        // Update offset for next load
        setFilters((prev) => ({
          ...prev,
          offset: reset ? response.activities.length : prev.offset! + response.activities.length,
        }));
      } catch (err) {
        console.error('[useActivityFeed] Failed to load activities:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    },
    [projectId, filters]
  );

  /**
   * Load more activities (pagination)
   */
  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading) {
      return;
    }

    await loadActivities(false);
  }, [hasMore, loading, loadActivities]);

  /**
   * Refresh activities (reset to first page)
   */
  const refresh = useCallback(async (): Promise<void> => {
    setFilters((prev) => ({ ...prev, offset: 0 }));
    await loadActivities(true);
  }, [loadActivities]);

  /**
   * Filter by action type
   */
  const filterByActionType = useCallback((types: ActivityActionType[]): void => {
    setFilters((prev) => ({
      ...prev,
      action_types: types.length > 0 ? types : undefined,
      offset: 0,
    }));
  }, []);

  /**
   * Filter by resource type
   */
  const filterByResourceType = useCallback((types: ResourceType[]): void => {
    setFilters((prev) => ({
      ...prev,
      resource_types: types.length > 0 ? types : undefined,
      offset: 0,
    }));
  }, []);

  /**
   * Filter by user
   */
  const filterByUser = useCallback((userId: string | null): void => {
    setFilters((prev) => ({
      ...prev,
      user_id: userId || undefined,
      offset: 0,
    }));
  }, []);

  /**
   * Clear all filters
   */
  const clearFilters = useCallback((): void => {
    setFilters({
      limit,
      offset: 0,
    });
  }, [limit]);

  return {
    activities,
    loading,
    error,
    hasMore,
    total,
    loadMore,
    refresh,
    filterByActionType,
    filterByResourceType,
    filterByUser,
    clearFilters,
  };
}
