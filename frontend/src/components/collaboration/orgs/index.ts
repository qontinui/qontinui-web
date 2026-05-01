/**
 * Cloud-only collaboration components — org / team management surface.
 *
 * Re-exports the four components whose actual implementations live in
 * `@qontinui/cloud-control/components/collaboration/`. The stubs still
 * sitting under `../OrganizationSwitcher.tsx`, `../CreateOrganizationDialog.tsx`,
 * `../TeamMemberList.tsx`, `../InviteMemberDialog.tsx` are render-null
 * placeholders that satisfy `tsc --noEmit` for the few OSS sidebar
 * consumers that still reference them by direct path; in OSS-only
 * deployments these render nothing.
 *
 * The follow-up for this split (deferred from M2.5) is:
 *   1. relocate `navigation/sidebar/SidebarHeader.tsx` and
 *      `navigation/sidebar/UnifiedSidebar.tsx` references to use the
 *      registerCloudExtensions component-slot pattern (which doesn't
 *      exist yet — needs to be added alongside services/routes/navItems);
 *   2. delete the four stub files entirely from OSS so the self-host
 *      bundle no longer transitively includes any cloud-half collaboration
 *      component code.
 *
 * Until that follow-up lands, importing from this file is preferred over
 * the bare `@/components/collaboration` path for these four components,
 * because the import path explicitly advertises cloud-only intent.
 */

export { OrganizationSwitcher } from "../OrganizationSwitcher";
export type { Organization } from "../OrganizationSwitcher";

export { CreateOrganizationDialog } from "../CreateOrganizationDialog";

export { TeamMemberList } from "../TeamMemberList";
export type { TeamMember, MemberRole } from "../TeamMemberList";

export { InviteMemberDialog } from "../InviteMemberDialog";
export type { PendingInvitation } from "../InviteMemberDialog";
