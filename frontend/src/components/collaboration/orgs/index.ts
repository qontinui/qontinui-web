/**
 * Cloud-only collaboration components — slot-registered surface.
 *
 * The four cloud-only components (`OrganizationSwitcher`,
 * `CreateOrganizationDialog`, `TeamMemberList`, `InviteMemberDialog`)
 * no longer have OSS-side stub files. They are React components
 * registered by `@qontinui/cloud-control` into the
 * `getComponent(name)` slot via `registerCloudExtensions({ components:
 * { ... } })`. OSS consumers retrieve them with `getComponent<P>(slot)`
 * and render conditionally — `undefined` means single-tenant deploy
 * with nothing to render.
 *
 * This module re-exports just the prop contracts (defined in
 * `lib/cloud-component-slots.ts`) so callers can type the slot lookup
 * without reaching into `@/lib/cloud-component-slots` directly.
 * Implementations live exclusively in cloud-control.
 */

export type {
  OrganizationRole,
  OrganizationSwitcherProps,
  SwitcherOrganization,
  CreateOrganizationDialogProps,
  TeamMemberListProps,
  InviteMemberDialogProps,
  PendingInvitation,
} from "@/lib/cloud-component-slots";
