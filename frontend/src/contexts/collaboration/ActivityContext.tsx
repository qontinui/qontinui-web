"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import type { Activity } from "./types";
import { activityService } from "@/services/service-factory";

// ============================================================================
// Context Types
// ============================================================================

interface ActivityContextValue {
  activityFeed: Activity[];
  refreshActivity: () => Promise<void>;
  addActivity: (activity: Activity) => void;
}

const ActivityContext = createContext<ActivityContextValue | undefined>(
  undefined
);

// ============================================================================
// Provider Props
// ============================================================================

interface ActivityProviderProps {
  children: ReactNode;
  projectId: string;
  limit?: number;
}

// ============================================================================
// Provider Component
// ============================================================================

export function ActivityProvider({
  children,
  projectId,
  limit = 20,
}: ActivityProviderProps) {
  const [activityFeed, setActivityFeed] = useState<Activity[]>([]);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Load activity feed when project changes
   */
  useEffect(() => {
    if (projectId) {
      loadActivityFeed();
    }
  }, [projectId, limit]);

  // ============================================================================
  // Methods
  // ============================================================================

  const loadActivityFeed = async () => {
    try {
      const activities = await activityService.getActivityFeed(projectId, {
        limit,
      });
      setActivityFeed(activities);
    } catch (error) {
      console.error("[Activity] Failed to load activity feed:", error);
    }
  };

  const refreshActivity = async () => {
    await loadActivityFeed();
  };

  const addActivity = (activity: Activity) => {
    setActivityFeed((prev) => [activity, ...prev]);
  };

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: ActivityContextValue = {
    activityFeed,
    refreshActivity,
    addActivity,
  };

  return (
    <ActivityContext.Provider value={value}>
      {children}
    </ActivityContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useActivity() {
  const context = useContext(ActivityContext);
  if (context === undefined) {
    throw new Error("useActivity must be used within an ActivityProvider");
  }
  return context;
}
