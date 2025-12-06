"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import type {
  Organization,
  UserPresence,
  Lock,
  Comment,
  Activity,
  ResourceType,
} from "@/types/collaboration";
import type { PermissionLevel } from "@/lib/permissions";
import {
  hasPermission,
} from "@/lib/permissions";
import {
  organizationService,
  lockService,
  commentService,
  activityService,
} from "@/services/service-factory";
import { websocketCollaborationService } from "@/services/websocket-collaboration-service";

// ============================================================================
// Context Types
// ============================================================================

interface CollaborationContextValue {
  // Organization
  currentOrg: Organization | null;
  organizations: Organization[];
  switchOrganization: (orgId: string) => Promise<void>;

  // Project access
  projectAccess: PermissionLevel | null;
  canView: boolean;
  canComment: boolean;
  canEdit: boolean;
  canAdmin: boolean;

  /**
   * Check if user has a specific permission level
   * @param required - The minimum permission level required
   */
  hasPermission: (required: PermissionLevel) => boolean;

  // Presence
  activeUsers: UserPresence[];

  // Locks
  currentLock: Lock | null;
  acquireEditLock: (
    resourceType: ResourceType,
    resourceId: string
  ) => Promise<void>;
  releaseEditLock: () => Promise<void>;

  // Comments
  comments: Comment[];
  addComment: (
    content: string,
    position?: { x: number; y: number }
  ) => Promise<void>;

  // Activity
  activityFeed: Activity[];

  // WebSocket
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const CollaborationContext = createContext<
  CollaborationContextValue | undefined
>(undefined);

// ============================================================================
// Provider Props
// ============================================================================

interface CollaborationProviderProps {
  children: ReactNode;
  projectId: string;
  workflowId?: string;
}

// ============================================================================
// Provider Component
// ============================================================================

export function CollaborationProvider({
  children,
  projectId,
  workflowId,
}: CollaborationProviderProps) {
  // Organization state
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  // Permission state
  const [projectAccess] = useState<PermissionLevel | null>(
    null
  );

  // Presence state
  const [activeUsers, setActiveUsers] = useState<UserPresence[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Lock state
  const [currentLock, setCurrentLock] = useState<Lock | null>(null);

  // Comment state
  const [comments, setComments] = useState<Comment[]>([]);

  // Activity state
  const [activityFeed, setActivityFeed] = useState<Activity[]>([]);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Load organizations on mount
   */
  useEffect(() => {
    loadOrganizations();
  }, []);

  /**
   * Connect to collaboration WebSocket when project changes
   */
  useEffect(() => {
    if (projectId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [projectId]);

  /**
   * Load comments when workflow changes
   */
  useEffect(() => {
    if (projectId) {
      loadComments();
    }
  }, [projectId, workflowId]);

  /**
   * Load activity feed when project changes
   */
  useEffect(() => {
    if (projectId) {
      loadActivityFeed();
    }
  }, [projectId]);

  // ============================================================================
  // Organization Methods
  // ============================================================================

  const loadOrganizations = async () => {
    try {
      const orgs = await organizationService.getOrganizations();
      setOrganizations(orgs);

      // Set first org as current if none selected
      if (orgs.length > 0 && !currentOrg) {
        setCurrentOrg(orgs[0] ?? null);
      }
    } catch (error) {
      console.error("[Collaboration] Failed to load organizations:", error);
    }
  };

  const switchOrganization = async (orgId: string) => {
    try {
      const org = await organizationService.getOrganization(orgId);
      setCurrentOrg(org);
    } catch (error) {
      console.error("[Collaboration] Failed to switch organization:", error);
      throw error;
    }
  };

  // ============================================================================
  // Permission Helpers
  // ============================================================================

  const canView = hasPermission("view", projectAccess || "none");
  const canComment = hasPermission("comment", projectAccess || "none");
  const canEdit = hasPermission("edit", projectAccess || "none");
  const canAdmin = hasPermission("admin", projectAccess || "none");

  /**
   * Check if user has a specific permission level
   */
  const checkPermission = (required: PermissionLevel): boolean => {
    return hasPermission(required, projectAccess || "none");
  };

  // ============================================================================
  // Lock Methods
  // ============================================================================

  const acquireEditLock = async (
    resourceType: ResourceType,
    resourceId: string
  ) => {
    try {
      const lock = await lockService.acquireLock(
        projectId,
        resourceType,
        resourceId,
        1 // auto-refresh (converted from boolean to number)
      );
      setCurrentLock(lock);
    } catch (error) {
      console.error("[Collaboration] Failed to acquire lock:", error);
      throw error;
    }
  };

  const releaseEditLock = async () => {
    if (!currentLock) return;

    try {
      await lockService.releaseLock(currentLock.id);
      setCurrentLock(null);
    } catch (error) {
      console.error("[Collaboration] Failed to release lock:", error);
      throw error;
    }
  };

  // ============================================================================
  // Comment Methods
  // ============================================================================

  const loadComments = async () => {
    try {
      const loadedComments = await commentService.getComments(
        projectId,
        workflowId
      );
      setComments(loadedComments);
    } catch (error) {
      console.error("[Collaboration] Failed to load comments:", error);
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
      console.error("[Collaboration] Failed to add comment:", error);
      throw error;
    }
  };

  // ============================================================================
  // Activity Methods
  // ============================================================================

  const loadActivityFeed = async () => {
    try {
      const activities = await activityService.getActivityFeed(projectId, {
        limit: 20,
      });
      setActivityFeed(activities);
    } catch (error) {
      console.error("[Collaboration] Failed to load activity feed:", error);
    }
  };

  // ============================================================================
  // WebSocket Methods
  // ============================================================================

  const connect = async () => {
    try {
      websocketCollaborationService.updateHandlers({
        onConnect: () => {
          setIsConnected(true);
        },
        onDisconnect: () => {
          setIsConnected(false);
        },
        onPresenceUpdate: (users) => {
          setActiveUsers(users);
        },
        onLockAcquired: (lock) => {
          // Update lock state if it affects current resource
          console.log("[Collaboration] Lock acquired:", lock);
        },
        onLockReleased: (lock) => {
          // Update lock state if it affects current resource
          if (currentLock && currentLock.id === lock.id) {
            setCurrentLock(null);
          }
        },
        onCommentAdded: (comment) => {
          // Add new comment if it belongs to current workflow
          if (!workflowId || comment.workflow_id === workflowId) {
            setComments((prev) => [...prev, comment]);
          }
        },
        onCommentUpdated: (comment) => {
          setComments((prev) =>
            prev.map((c) => (c.id === comment.id ? comment : c))
          );
        },
        onCommentDeleted: (commentId) => {
          setComments((prev) => prev.filter((c) => c.id !== commentId));
        },
        onActivityUpdate: (activity) => {
          setActivityFeed((prev) => [activity, ...prev]);
        },
      });

      websocketCollaborationService.connect(projectId);
    } catch (error) {
      console.error("[Collaboration] Failed to connect:", error);
      throw error;
    }
  };

  const disconnect = () => {
    websocketCollaborationService.disconnect();
    setIsConnected(false);
    setActiveUsers([]);
  };

  // ============================================================================
  // Cleanup
  // ============================================================================

  useEffect(() => {
    return () => {
      // Release lock on unmount
      if (currentLock) {
        releaseEditLock();
      }
      // Disconnect WebSocket
      disconnect();
    };
  }, []);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: CollaborationContextValue = {
    // Organization
    currentOrg,
    organizations,
    switchOrganization,

    // Project access
    projectAccess,
    canView,
    canComment,
    canEdit,
    canAdmin,
    hasPermission: checkPermission,

    // Presence
    activeUsers,

    // Locks
    currentLock,
    acquireEditLock,
    releaseEditLock,

    // Comments
    comments,
    addComment,

    // Activity
    activityFeed,

    // WebSocket
    isConnected,
    connect,
    disconnect,
  };

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useCollaboration() {
  const context = useContext(CollaborationContext);
  if (context === undefined) {
    throw new Error(
      "useCollaboration must be used within a CollaborationProvider"
    );
  }
  return context;
}
