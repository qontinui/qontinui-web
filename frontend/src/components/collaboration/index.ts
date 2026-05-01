/**
 * Collaboration components — OSS-only re-exports.
 *
 * Cloud-only components (org/team management — `OrganizationSwitcher`,
 * `CreateOrganizationDialog`, `TeamMemberList`, `InviteMemberDialog`)
 * are no longer re-exported here. Their stubs still live alongside this
 * file because OSS sidebar code (`navigation/sidebar/SidebarHeader.tsx`,
 * `navigation/sidebar/UnifiedSidebar.tsx`) currently imports them by
 * direct path; relocating those consumers and deleting the stubs is the
 * follow-up to this partial split.
 *
 * Cloud-only re-exports for any future centralized consumer live in
 * `./orgs/index.ts` so that the import path advertises the cloud-only
 * nature.
 */

// Project Sharing and Permissions (OSS — single-tenant project ACLs)
export { ProjectSharingDialog } from "./ProjectSharingDialog";
export type { PermissionLevel, Collaborator } from "./ProjectSharingDialog";

export {
  PermissionGate,
  usePermission,
  PermissionBoundary,
} from "./PermissionGate";
export type { Permission } from "./PermissionGate";

// Real-time Collaboration (OSS — presence/locks within a project)
export { CollaboratorAvatars } from "./CollaboratorAvatars";
export type { Collaborator as AvatarCollaborator } from "./CollaboratorAvatars";

export { PresenceIndicator } from "./PresenceIndicator";
export type { UserPresence, PresenceStatus } from "./PresenceIndicator";

export { EditLockBanner } from "./EditLockBanner";
export type { EditLock } from "./EditLockBanner";

// Communication (OSS — comments and activity feed within a project)
export { CommentThread } from "./CommentThread";
export type {
  Comment,
  CommentThread as CommentThreadType,
} from "./CommentThread";

export { ActivityFeed } from "./ActivityFeed";
export type {
  ActivityItem,
  ActivityAction,
  ResourceType,
} from "./ActivityFeed";

// Conflict Resolution and Reviews (OSS — review/conflict UI for projects)
export { ConflictResolutionDialog } from "./ConflictResolutionDialog";
export type { Conflict, ConflictChange } from "./_types/conflict";

export { ReviewRequestPanel } from "./ReviewRequestPanel";
export type {
  ReviewRequest,
  ReviewComment,
  Reviewer,
  ReviewStatus,
} from "./ReviewRequestPanel";
