/**
 * Collaboration Services
 *
 * Central export for all collaboration-related services
 */

export { OrganizationService } from "./organization-service";
export { ProjectCollaborationService } from "./project-collaboration-service";
export { LockService } from "./lock-service";
export { CommentService } from "./comment-service";
export { ActivityService } from "./activity-service";
export {
  WebSocketCollaborationService,
  type WebSocketCollaborationConfig,
  type CollaborationCallbacks,
  type ConnectionState,
} from "./websocket-collaboration-service";
export {
  ConflictDetector,
  ConflictResolutionService,
  conflictResolutionService,
} from "./conflict-resolution-service";
export {
  OperationalTransformService,
  operationalTransformService,
} from "./operational-transform-service";
export { SyncService, syncService } from "./sync-service";

// Re-export types for convenience
export type {
  Organization,
  OrganizationCreate,
  OrganizationUpdate,
  TeamMember,
  Invitation,
  InvitationCreate,
  MemberRole,
  Collaborator,
  ProjectShare,
  PermissionLevel,
  ProjectAction,
  Lock,
  LockAcquireRequest,
  ResourceType,
  Comment,
  CommentCreate,
  CommentUpdate,
  CommentPosition,
  Activity,
  ActivityCreate,
  ActivityFeedOptions,
  ActivityActionType,
  PresenceStatus,
  UserPresence,
  CursorPosition,
  Subscription,
} from "@/types/collaboration";
