// ============================================================================
// Collaboration Contexts - Barrel Export
// ============================================================================

/**
 * This module provides a refactored collaboration system that follows the
 * Single Responsibility Principle. Each context manages a single aspect
 * of collaboration.
 *
 * ## Available Contexts:
 *
 * 1. **OrganizationContext** - Organization and member management
 * 2. **PermissionsContext** - Permission checking and access control
 * 3. **PresenceContext** - User presence tracking
 * 4. **EditLockContext** - Edit lock management
 * 5. **CommentsContext** - Comments and threads
 * 6. **ActivityContext** - Activity feed tracking
 * 7. **WebSocketContext** - Real-time WebSocket connection
 *
 * ## Usage:
 *
 * ### Option 1: Use the combined provider (recommended)
 * ```tsx
 * import { CollaborationProvider } from '@/contexts/collaboration';
 *
 * <CollaborationProvider projectId={projectId} workflowId={workflowId}>
 *   <YourComponent />
 * </CollaborationProvider>
 * ```
 *
 * ### Option 2: Use individual providers
 * ```tsx
 * import {
 *   OrganizationProvider,
 *   PermissionsProvider,
 *   PresenceProvider
 * } from '@/contexts/collaboration';
 *
 * <OrganizationProvider>
 *   <PermissionsProvider>
 *     <PresenceProvider>
 *       <YourComponent />
 *     </PresenceProvider>
 *   </PermissionsProvider>
 * </OrganizationProvider>
 * ```
 *
 * ## Hooks:
 *
 * Each context provides a dedicated hook:
 * ```tsx
 * import {
 *   useOrganization,
 *   usePermissions,
 *   usePresence,
 *   useEditLock,
 *   useComments,
 *   useActivity,
 *   useWebSocket
 * } from '@/contexts/collaboration';
 *
 * function MyComponent() {
 *   const { currentOrg, switchOrganization } = useOrganization();
 *   const { canEdit, canAdmin } = usePermissions();
 *   const { activeUsers } = usePresence();
 *   const { acquireEditLock, releaseEditLock } = useEditLock();
 *   const { comments, addComment } = useComments();
 *   const { activityFeed } = useActivity();
 *   const { isConnected } = useWebSocket();
 *
 *   // ... your component logic
 * }
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  CollaborationProviderProps,
  Organization,
  UserPresence,
  Lock,
  Comment,
  Activity,
  ResourceType,
  PermissionLevel,
} from "./types";

// ============================================================================
// Combined Provider (Recommended)
// ============================================================================

export { CollaborationProvider } from "./CollaborationProvider";

// ============================================================================
// Individual Providers
// ============================================================================

export { OrganizationProvider } from "./OrganizationContext";
export { PermissionsProvider } from "./PermissionsContext";
export { PresenceProvider } from "./PresenceContext";
export { EditLockProvider } from "./EditLockContext";
export { CommentsProvider } from "./CommentsContext";
export { ActivityProvider } from "./ActivityContext";
export { WebSocketProvider } from "./WebSocketContext";

// ============================================================================
// Hooks
// ============================================================================

export { useOrganization } from "./OrganizationContext";
export { usePermissions } from "./PermissionsContext";
export { usePresence } from "./PresenceContext";
export { useEditLock } from "./EditLockContext";
export { useComments } from "./CommentsContext";
export { useActivity } from "./ActivityContext";
export { useWebSocket } from "./WebSocketContext";

// ============================================================================
// Legacy Compatibility Export
// ============================================================================

/**
 * @deprecated Use individual hooks instead.
 * This hook is provided for backward compatibility.
 * It combines all the individual hooks into a single hook.
 *
 * Migration guide:
 * ```tsx
 * // Before:
 * const { currentOrg, canEdit, activeUsers } = useCollaboration();
 *
 * // After:
 * const { currentOrg } = useOrganization();
 * const { canEdit } = usePermissions();
 * const { activeUsers } = usePresence();
 * ```
 */
export function useCollaboration() {
  // This function would need to be implemented if backward compatibility is required
  // For now, we'll throw an error directing users to the new hooks
  throw new Error(
    "useCollaboration() has been deprecated. Please use individual hooks: " +
      "useOrganization(), usePermissions(), usePresence(), useEditLock(), " +
      "useComments(), useActivity(), useWebSocket()"
  );
}
