/**
 * Prop contracts for cloud-control component slots.
 *
 * These interfaces are the type contracts that the OSS shell (sidebar,
 * profile panels, etc.) renders against. Cloud-control's real React
 * components are registered into the `getComponent(name)` slot via
 * `registerCloudExtensions({ components: { ... } })`; cloud-control's
 * implementations structurally satisfy the interfaces declared here.
 *
 * In OSS-only deployments these slots stay empty; the consuming JSX
 * renders nothing in their place. See `lib/extension-slots.ts` for
 * the slot registry mechanics.
 *
 * Slot names (canonical, lowerCamelCase by convention):
 *
 * - `organizationSwitcher` — sidebar header dropdown that lists the
 *   user's orgs and supports switching / creating.
 * - `createOrganizationDialog` — modal opened from the sidebar to mint
 *   a new org.
 * - `teamMemberList` — admin/settings page panel showing org members
 *   with role-management controls.
 * - `inviteMemberDialog` — modal for adding a user to an org by email.
 *
 * Adding a new slot: declare the props interface here, document the
 * slot name in the list above, and adopt `getComponent<T>(slotName)`
 * at the consumer site.
 */

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

/**
 * Lightweight org shape used by the sidebar switcher. Distinct from the
 * richer `Organization` defined in `types/collaboration.ts` — the
 * switcher only needs id/name/avatar/count/role for rendering, not the
 * full service-shape with timestamps and project_count.
 */
export interface SwitcherOrganization {
  id: string;
  name: string;
  avatar_url: undefined;
  member_count: number;
  role: OrganizationRole;
}

export interface OrganizationSwitcherProps {
  organizations: SwitcherOrganization[];
  currentOrganization: SwitcherOrganization | null;
  onOrganizationChange: (orgId: string) => void;
  onCreateOrganization: () => void;
  loading: boolean;
  className?: string;
}

export interface CreateOrganizationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (orgId: string) => void;
}

export interface TeamMemberListProps {
  members?: Array<{
    id: string;
    user_id: string;
    username?: string;
    email?: string;
    role: OrganizationRole;
  }>;
  currentUserId?: string;
  onRoleChange?: (userId: string, role: OrganizationRole) => void;
  onRemove?: (userId: string) => void;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: OrganizationRole;
  created_at: string;
}

export interface InviteMemberDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onInvited?: (invitation: PendingInvitation) => void;
}
