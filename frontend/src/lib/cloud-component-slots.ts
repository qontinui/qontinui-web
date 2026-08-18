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
 * - `betaBanner` — the cloud deployment's beta announcement banner,
 *   rendered above the main content area of every authenticated page.
 *   Dismissible (persisted to `localStorage`) and links to the feedback
 *   form. OSS self-host installs have no "beta" status to announce, so
 *   the slot stays empty there.
 * - `subscriptionBadge` — badge showing the signed-in user's real
 *   subscription tier, read from the cloud billing service. Rendered in
 *   the profile page's account-status badge row. OSS self-host installs
 *   have no subscription to report, so the slot stays empty and the row
 *   renders nothing in its place.
 *
 * Adding a new slot: declare the props interface here, document the
 * slot name in the list above, and adopt `useSlotComponent<T>(slotName)`
 * at the consumer site — NOT `getComponent`, which is an unsubscribed
 * read and leaves the slot permanently empty when the cloud-control
 * bundle finishes loading after the consumer's first render. See
 * `lib/extension-slots.ts`.
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

/**
 * The beta banner takes no props — it owns its dismissal state
 * (`localStorage`) and its feedback-dialog state internally.
 *
 * `Record<string, never>` rather than `{}` or an empty `interface`: the
 * latter two are the "any non-nullish value" type and trip
 * `@typescript-eslint/no-empty-object-type`.
 */
export type BetaBannerProps = Record<string, never>;

/**
 * The subscription badge takes no props — it fetches the signed-in user's
 * subscription from the cloud billing service itself and owns its own
 * loading/error state.
 *
 * `Record<string, never>` for the same reason as `BetaBannerProps` above.
 */
export type SubscriptionBadgeProps = Record<string, never>;
