"use client";

import React, { useEffect, ReactNode } from "react";
import { OrganizationProvider } from "./OrganizationContext";
import { PermissionsProvider } from "./PermissionsContext";
import { PresenceProvider, usePresence } from "./PresenceContext";
import { EditLockProvider, useEditLock } from "./EditLockContext";
import { CommentsProvider, useComments } from "./CommentsContext";
import { ActivityProvider, useActivity } from "./ActivityContext";
import { WebSocketProvider, useWebSocket } from "./WebSocketContext";
import type { CollaborationProviderProps } from "./types";

// ============================================================================
// WebSocket Integration Component
// ============================================================================

/**
 * This component connects the WebSocket handlers to the individual contexts.
 * It must be rendered inside all the context providers.
 */
function WebSocketIntegration({ workflowId }: { workflowId?: string }) {
  const { registerHandlers } = useWebSocket();
  const { setActiveUsers } = usePresence();
  const { currentLock, releaseEditLock } = useEditLock();
  const comments = useComments();
  const activity = useActivity();

  useEffect(() => {
    registerHandlers({
      onPresenceUpdate: (users) => {
        setActiveUsers(users);
      },
      onLockAcquired: (lock) => {
        console.log("[WebSocket] Lock acquired:", lock);
      },
      onLockReleased: (lock) => {
        // Update lock state if it affects current resource
        if (currentLock && currentLock.id === lock.id) {
          releaseEditLock().catch((error) => {
            console.error("[WebSocket] Failed to release lock:", error);
          });
        }
      },
      onCommentAdded: (comment) => {
        // Add new comment if it belongs to current workflow
        if (!workflowId || comment.workflow_id === workflowId) {
          // Update comments state through internal method
          comments.refreshComments();
        }
      },
      onCommentUpdated: (comment) => {
        comments.refreshComments();
      },
      onCommentDeleted: (commentId) => {
        comments.refreshComments();
      },
      onActivityUpdate: (activityItem) => {
        activity.addActivity(activityItem);
      },
    });
  }, [
    registerHandlers,
    setActiveUsers,
    currentLock,
    releaseEditLock,
    workflowId,
    comments,
    activity,
  ]);

  return null;
}

// ============================================================================
// Combined Collaboration Provider
// ============================================================================

/**
 * CollaborationProvider combines all collaboration-related contexts
 * into a single provider for convenient usage.
 *
 * This provider includes:
 * - OrganizationProvider: Organization and member management
 * - PermissionsProvider: Permission checking
 * - PresenceProvider: User presence tracking
 * - EditLockProvider: Edit lock management
 * - CommentsProvider: Comments and threads
 * - ActivityProvider: Activity feed
 * - WebSocketProvider: Real-time WebSocket connection
 *
 * Usage:
 * ```tsx
 * <CollaborationProvider projectId={projectId} workflowId={workflowId}>
 *   <YourComponent />
 * </CollaborationProvider>
 * ```
 *
 * Then use individual hooks in your components:
 * ```tsx
 * const { currentOrg } = useOrganization();
 * const { canEdit } = usePermissions();
 * const { activeUsers } = usePresence();
 * const { acquireEditLock } = useEditLock();
 * const { comments, addComment } = useComments();
 * const { activityFeed } = useActivity();
 * const { isConnected } = useWebSocket();
 * ```
 */
export function CollaborationProvider({
  children,
  projectId,
  workflowId,
}: CollaborationProviderProps) {
  return (
    <OrganizationProvider>
      <PermissionsProvider>
        <WebSocketProvider projectId={projectId}>
          <PresenceProvider>
            <EditLockProvider projectId={projectId}>
              <CommentsProvider projectId={projectId} workflowId={workflowId}>
                <ActivityProvider projectId={projectId}>
                  <WebSocketIntegration workflowId={workflowId} />
                  {children}
                </ActivityProvider>
              </CommentsProvider>
            </EditLockProvider>
          </PresenceProvider>
        </WebSocketProvider>
      </PermissionsProvider>
    </OrganizationProvider>
  );
}
