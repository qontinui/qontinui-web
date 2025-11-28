/**
 * Collaboration Types
 *
 * Comprehensive type definitions for collaboration features including
 * organizations, permissions, locks, comments, and activity tracking.
 */

// ============================================================================
// Organization Types
// ============================================================================

export interface Organization {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  owner_id: string;
  member_count: number;
  project_count: number;
}

export interface OrganizationCreate {
  name: string;
  description?: string;
}

export interface OrganizationUpdate {
  name?: string;
  description?: string;
}

export type MemberRole = "owner" | "admin" | "member" | "viewer";

export interface TeamMember {
  id: string;
  user_id: string;
  organization_id: string;
  email: string;
  name: string | null;
  role: MemberRole;
  joined_at: string;
  last_active: string | null;
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  invited_by: string;
  invited_at: string;
  expires_at: string;
  token: string;
  status: "pending" | "accepted" | "expired" | "revoked";
}

export interface InvitationCreate {
  email: string;
  role: MemberRole;
}

// ============================================================================
// Permission Types
// ============================================================================

export type PermissionLevel =
  | "none"
  | "view"
  | "comment"
  | "edit"
  | "admin"
  | "owner";

export interface Collaborator {
  id: string;
  project_id: string;
  user_id: string;
  email: string;
  name: string | null;
  permission: PermissionLevel;
  added_at: string;
  added_by: string;
}

export interface ProjectShare {
  user_id?: string;
  organization_id?: string;
  permission: PermissionLevel;
}

export type ProjectAction =
  | "view"
  | "comment"
  | "edit"
  | "delete"
  | "share"
  | "manage_permissions"
  | "export";

// ============================================================================
// Lock Types
// ============================================================================

export type ResourceType =
  | "workflow"
  | "action"
  | "state"
  | "transition"
  | "project";

export interface Lock {
  id: string;
  project_id: string;
  resource_type: ResourceType;
  resource_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string;
  acquired_at: string;
  expires_at: string;
  refreshed_at: string;
}

export interface LockAcquireRequest {
  resource_type: ResourceType;
  resource_id: string;
  timeout_seconds?: number;
}

// ============================================================================
// Comment Types
// ============================================================================

export interface Comment {
  id: string;
  project_id: string;
  workflow_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string | null;
  author_email: string;
  content: string;
  position: CommentPosition | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  mentions: string[];
  replies: Comment[];
  reaction_counts: Record<string, number>;
}

export interface CommentPosition {
  x: number;
  y: number;
  element_id?: string;
}

export interface CommentCreate {
  workflow_id?: string;
  parent_id?: string;
  content: string;
  position?: CommentPosition;
  mentions?: string[];
}

export interface CommentUpdate {
  content: string;
}

// ============================================================================
// Activity Types
// ============================================================================

export type ActivityActionType =
  | "create"
  | "update"
  | "delete"
  | "share"
  | "comment"
  | "lock"
  | "unlock"
  | "execute"
  | "export"
  | "import";

export interface Activity {
  id: string;
  project_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string;
  action_type: ActivityActionType;
  resource_type: ResourceType;
  resource_id: string;
  resource_name: string | null;
  description: string;
  changes: Record<string, any> | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

export interface ActivityCreate {
  action_type: ActivityActionType;
  resource_type: ResourceType;
  resource_id: string;
  resource_name?: string;
  description?: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface ActivityFeedOptions {
  limit?: number;
  offset?: number;
  action_types?: ActivityActionType[];
  resource_types?: ResourceType[];
  user_id?: string;
}

// ============================================================================
// Presence Types
// ============================================================================

export type PresenceStatus = "active" | "idle" | "away";

export interface UserPresence {
  user_id: string;
  user_name: string | null;
  user_email: string;
  project_id: string;
  status: PresenceStatus;
  cursor_position: CursorPosition | null;
  current_view: string | null;
  last_seen: string;
}

export interface CursorPosition {
  x: number;
  y: number;
  viewport_id?: string;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type WebSocketMessageType =
  | "presence_update"
  | "cursor_move"
  | "lock_acquired"
  | "lock_released"
  | "resource_update"
  | "comment_added"
  | "comment_updated"
  | "comment_deleted"
  | "activity_update"
  | "ping"
  | "pong";

export interface WebSocketMessage {
  type: WebSocketMessageType;
  timestamp: string;
  data: any;
}

export interface PresenceUpdateMessage {
  user_id: string;
  user_name: string | null;
  user_email: string;
  status: PresenceStatus;
  current_view: string | null;
}

export interface CursorMoveMessage {
  user_id: string;
  user_name: string | null;
  x: number;
  y: number;
  viewport_id?: string;
}

export interface LockUpdateMessage {
  lock: Lock;
  action: "acquired" | "released" | "expired";
}

export interface ResourceUpdateMessage {
  resource_type: ResourceType;
  resource_id: string;
  user_id: string;
  user_name: string | null;
  changes: Record<string, any>;
}

// ============================================================================
// Subscription Types
// ============================================================================

export interface Subscription {
  unsubscribe: () => void;
}

// ============================================================================
// Error Types
// ============================================================================

export interface CollaborationError {
  code: string;
  message: string;
  details?: any;
}
