// Organization and Team Management
export { OrganizationSwitcher } from "./OrganizationSwitcher";
export type { Organization } from "./OrganizationSwitcher";

export { TeamMemberList } from "./TeamMemberList";
export type { TeamMember, MemberRole } from "./TeamMemberList";

export { InviteMemberDialog } from "./InviteMemberDialog";
export type { PendingInvitation } from "./InviteMemberDialog";

// Project Sharing and Permissions
export { ProjectSharingDialog } from "./ProjectSharingDialog";
export type { PermissionLevel, Collaborator } from "./ProjectSharingDialog";

export {
  PermissionGate,
  usePermission,
  PermissionBoundary,
} from "./PermissionGate";
export type {
  Permission,
  PermissionLevel as UserPermissionLevel,
} from "./PermissionGate";

// Real-time Collaboration
export { CollaboratorAvatars } from "./CollaboratorAvatars";
export type { Collaborator as AvatarCollaborator } from "./CollaboratorAvatars";

export { PresenceIndicator } from "./PresenceIndicator";
export type { UserPresence, PresenceStatus } from "./PresenceIndicator";

export { EditLockBanner } from "./EditLockBanner";
export type { EditLock } from "./EditLockBanner";

// Communication
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

// Conflict Resolution and Reviews
export { ConflictResolutionDialog } from "./ConflictResolutionDialog";
export type { Conflict, ConflictChange } from "./ConflictResolutionDialog";

export { ReviewRequestPanel } from "./ReviewRequestPanel";
export type {
  ReviewRequest,
  ReviewComment,
  Reviewer,
  ReviewStatus,
} from "./ReviewRequestPanel";
